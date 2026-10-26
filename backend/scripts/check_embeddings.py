"""
Stage 6 check: does the embedding model find the right slide for a question?

Run from the studymate folder (venv active):
    python -m backend.scripts.check_embeddings

What it does (READ-ONLY: nothing is written to the database):
  1. Finds the course that contains the ACID deck and loads every passage
     (text, tables, diagram descriptions) of its ready files.
  2. Embeds all passages and a set of test questions with each model setup.
  3. For every question, ranks all passages by cosine similarity and records
     where the first passage from a correct page lands (1 = top result).
  4. Prints the rank per question, Hit@1 / Hit@3 / Hit@5, MRR and timings.

Models are downloaded from Hugging Face on the first run and cached in
C:\\Users\\<you>\\.cache\\huggingface (Qwen3 ~1.2 GB, granite ~0.1 GB).
"""

import time

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from sqlalchemy import create_engine, text

from backend.app.config import DATABASE_URL

QWEN = "Qwen/Qwen3-Embedding-0.6B"
GRANITE = "ibm-granite/granite-embedding-small-english-r2"

# Qwen3 is "instruction-aware": a QUESTION gets a one-line task description in
# front, a PASSAGE gets nothing. The model was trained this way, so the
# instruction tells it "find text that ANSWERS this", not "find similar text".
QWEN_QUERY_PROMPT = (
    "Instruct: Given a student's question, retrieve passages from their "
    "course notes that answer the question\nQuery:"
)

# Test questions. "pages" = pages of the ACID deck (key "acid") or of the
# Unit 3 notes (key "unit3") that contain the answer. Some are worded like
# the slides, some are paraphrased, some are answered only by a picture.
QUESTIONS = [
    ("What does the all-or-nothing property of a transaction mean?", "acid", {25, 30, 31}),
    ("Why could money disappear if the system crashes halfway through a bank transfer?", "acid", {30, 31}),
    ("Once the user is told the transfer is done, why must the change survive a power cut?", "acid", {32, 33}),
    ("What can the system do after a transaction is aborted? Can it be restarted?", "acid", {15, 17, 18}),
    ("Which states does a transaction pass through from start to finish?", "acid", {13, 14, 15}),
    ("How does the DBMS decide which buffer to throw out when memory is full?", "acid", {11}),
    ("What steps are needed to read a data item from disk into memory?", "acid", {10}),
    ("Which SQL statements end a transaction?", "acid", {19, 20, 21, 22}),
    ("Can a READ ONLY transaction run an UPDATE statement?", "acid", {23, 24}),
    ("What does a second transaction see in the middle of a transfer under READ UNCOMMITTED?", "acid", {34, 35}),
    ("What is the difference between a single-user and a multi-user DBMS?", "acid", {3}),
    ("Why do databases run transactions concurrently even though it causes problems?", "acid", {12, 36}),
    # answered by pictures (passages written by the image reader)
    ("Which ACID property is shown with the data being replicated to replica a and replica b?", "acid", {26}),
    ("What was the balance of A after step 3 of the fund transfer in the MySQL run?", "acid", {28, 29}),
    # Unit 3 notes (only used if that file is in the same course)
    ("Which lock conflicts with a shared lock?", "unit3", {3}),
    ("Does PostgreSQL allow dirty reads?", "unit3", {2}),
]


def device() -> str:
    # GPU if PyTorch can see one, otherwise CPU (e.g. on the server).
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_passages(engine) -> list[dict]:
    """Every passage of the ready files in the course that holds the ACID deck."""
    with engine.connect() as conn:
        course_id = conn.execute(text("""
            SELECT m.course_id
            FROM materials m
            JOIN document_chunks dc ON dc.material_id = m.id
            WHERE m.status = 'ready'
              AND dc.content ILIKE '%Execution Verification%'
            ORDER BY m.created_at DESC
            LIMIT 1
        """)).scalar()
        if course_id is None:
            raise SystemExit("No ready ACID deck found in the database.")

        rows = conn.execute(text("""
            SELECT dc.material_id, m.title, dc.page_number, dc.chunk_type,
                   dc.source, dc.content
            FROM document_chunks dc
            JOIN materials m ON m.id = dc.material_id
            WHERE m.course_id = :course_id AND m.status = 'ready'
            ORDER BY m.created_at, dc.chunk_index
        """), {"course_id": course_id}).mappings().all()

    # Give each file a short key so the questions can name it.
    text_by_material: dict = {}
    for r in rows:
        text_by_material.setdefault(r["material_id"], []).append(r["content"])
    key_of = {}
    for mid, parts in text_by_material.items():
        joined = " ".join(parts)
        if "Execution Verification" in joined:
            key_of[mid] = "acid"
        elif "Lock compatibility" in joined or "UE24CS301" in joined:
            key_of[mid] = "unit3"
        else:
            key_of[mid] = "other"

    return [dict(r) | {"doc": key_of[r["material_id"]]} for r in rows]


def normalize(vectors: np.ndarray) -> np.ndarray:
    # Unit length, so a dot product IS the cosine similarity.
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def evaluate(name: str, passage_vecs: np.ndarray, question_vecs: np.ndarray,
             passages: list[dict], questions: list) -> dict:
    """Rank all passages for every question; return the rank of the first correct one."""
    sims = question_vecs @ passage_vecs.T          # (questions x passages) cosine scores
    ranks = []
    for qi, (_, doc, pages) in enumerate(questions):
        order = np.argsort(-sims[qi])              # best passage first
        rank = None
        for position, pi in enumerate(order, start=1):
            p = passages[pi]
            if p["doc"] == doc and p["page_number"] in pages:
                rank = position
                break
        ranks.append(rank)
    found = [r for r in ranks if r is not None]
    n = len(ranks)
    return {
        "name": name,
        "ranks": ranks,
        "hit1": sum(r <= 1 for r in found) / n,
        "hit3": sum(r <= 3 for r in found) / n,
        "hit5": sum(r <= 5 for r in found) / n,
        "mrr": sum(1 / r for r in found) / n,   # mean reciprocal rank: 1.0 = always first
    }


def time_queries(model: SentenceTransformer, questions: list[str], **kwargs) -> float:
    """Average milliseconds to embed ONE question (what every search pays)."""
    model.encode(questions[:1], **kwargs)          # warm-up (first call is slower)
    start = time.perf_counter()
    for q in questions:
        model.encode([q], **kwargs)
    return (time.perf_counter() - start) / len(questions) * 1000


def main() -> None:
    engine = create_engine(DATABASE_URL)
    passages = load_passages(engine)
    docs = sorted({p["doc"] for p in passages})
    questions = [q for q in QUESTIONS if q[1] in docs]
    q_texts = [q[0] for q in questions]
    p_texts = [p["content"] for p in passages]
    kinds = {}
    for p in passages:
        kinds[(p["source"], p["chunk_type"])] = kinds.get((p["source"], p["chunk_type"]), 0) + 1
    print(f"Device: {device()}  |  passages: {len(passages)} from files {docs}  |  questions: {len(questions)}")
    print("Passage kinds:", ", ".join(f"{s}/{t}: {c}" for (s, t), c in sorted(kinds.items())))

    results, timings = [], []

    # --- Qwen3-Embedding-0.6B: embed once at full size (1024), then also
    #     test the first 384 numbers (Matryoshka) re-normalised. -------------
    # float32 on purpose: transformers 5 would load Qwen3 in bfloat16 (how it
    # is stored), which a GTX 1650 has no hardware support for, and GTX 16-series
    # cards are known to give wrong results in float16 with some models.
    # 0.6B parameters x 4 bytes = 2.4 GB, which fits in the 4 GB card.
    t0 = time.perf_counter()
    qwen = SentenceTransformer(QWEN, device=device(), model_kwargs={"dtype": torch.float32})
    load_s = time.perf_counter() - t0
    tok = qwen.tokenizer
    lengths = [len(tok(t)["input_ids"]) for t in p_texts]
    print(f"Passage length in Qwen3 tokens: max {max(lengths)}, average {sum(lengths) / len(lengths):.0f}")

    t0 = time.perf_counter()
    p_full = qwen.encode(p_texts, batch_size=8, convert_to_numpy=True)
    embed_s = time.perf_counter() - t0
    q_full = qwen.encode(q_texts, prompt=QWEN_QUERY_PROMPT, convert_to_numpy=True)
    q_ms = time_queries(qwen, q_texts, prompt=QWEN_QUERY_PROMPT)

    for dim in (1024, 384):
        results.append(evaluate(
            f"Qwen3-0.6B @{dim}",
            normalize(p_full[:, :dim]), normalize(q_full[:, :dim]),
            passages, questions,
        ))
    timings.append(("Qwen3-0.6B", load_s, embed_s, q_ms))

    # Same model on the CPU = roughly what the server will pay per question.
    if device() == "cuda":
        del qwen
        torch.cuda.empty_cache()
        qwen_cpu = SentenceTransformer(QWEN, device="cpu", model_kwargs={"dtype": torch.float32})
        cpu_ms = time_queries(qwen_cpu, q_texts, prompt=QWEN_QUERY_PROMPT)
        timings.append(("Qwen3-0.6B on CPU (server-like)", None, None, cpu_ms))
        del qwen_cpu

    # --- granite-small-r2: the small 384-dim baseline ------------------------
    t0 = time.perf_counter()
    granite = SentenceTransformer(GRANITE, device=device(), model_kwargs={"dtype": torch.float32})
    load_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    p_g = granite.encode(p_texts, batch_size=16, convert_to_numpy=True)
    embed_s = time.perf_counter() - t0
    q_g = granite.encode(q_texts, convert_to_numpy=True)
    q_ms = time_queries(granite, q_texts)
    results.append(evaluate("granite-small @384", normalize(p_g), normalize(q_g), passages, questions))
    timings.append(("granite-small", load_s, embed_s, q_ms))

    # --- Report ---------------------------------------------------------------
    print("\nRank of the first passage from a correct page (1 = top result, - = not found):")
    header = f"{'#':>2}  {'question':<60}" + "".join(f"{r['name']:>20}" for r in results)
    print(header)
    print("-" * len(header))
    for i, (q, _, _) in enumerate(questions):
        cells = "".join(f"{(r['ranks'][i] or '-'):>20}" for r in results)
        print(f"{i + 1:>2}  {q[:58]:<60}{cells}")
    print("-" * len(header))
    for metric in ("hit1", "hit3", "hit5", "mrr"):
        label = {"hit1": "Hit@1", "hit3": "Hit@3", "hit5": "Hit@5", "mrr": "MRR"}[metric]
        print(f"{'':>2}  {label:<60}" + "".join(f"{r[metric]:>20.2f}" for r in results))

    print("\nTimings:")
    for name, load_s, embed_s, q_ms in timings:
        parts = []
        if load_s is not None:
            parts.append(f"load {load_s:.1f} s")
        if embed_s is not None:
            parts.append(f"all {len(passages)} passages {embed_s:.1f} s")
        parts.append(f"one question {q_ms:.0f} ms")
        print(f"  {name:<34} " + " | ".join(parts))


if __name__ == "__main__":
    main()
