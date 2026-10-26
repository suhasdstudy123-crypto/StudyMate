"""
Stage 6 check: does HYBRID search beat meaning-only and keyword-only search?

Run from the studymate folder (venv active; the backend may keep running):
    python -m backend.scripts.check_search

READ-ONLY. For every test question it calls the real search function
(hybrid_search_chunks, migration 005) three ways:
    meaning only   : question vector, no keywords
    keywords only  : no vector (as when the model is still loading)
    hybrid         : both, merged with Reciprocal Rank Fusion
and prints where the first passage from a correct page lands (1 = top).

The model runs on the CPU here on purpose: the backend may already hold the
GPU, and CPU timing is what a server without a GPU will see.
"""

import time

from sqlalchemy import create_engine, text

from backend.app.config import DATABASE_URL
from backend.app.processing.embeddings import Embedder
from backend.scripts.check_embeddings import QUESTIONS

# Exact-term questions: the words only appear on one slide. This is where
# keyword search should help meaning search.
EXACT = [
    ("What does ERROR 1792 mean?", "acid", {24}),
    ("What is LRU?", "acid", {11}),
    ("What happens with autocommit=0?", "acid", {22}),
]

SEARCH = text("""
    SELECT material_id, page_number
    FROM hybrid_search_chunks(CAST(:v AS vector), :q, :user_id, :course_id, 20)
""")


def main() -> None:
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        course = conn.execute(text("""
            SELECT c.id, c.user_id
            FROM materials m
            JOIN courses c ON c.id = m.course_id
            JOIN document_chunks dc ON dc.material_id = m.id
            WHERE m.status = 'ready' AND dc.content ILIKE '%Execution Verification%'
            ORDER BY m.created_at DESC
            LIMIT 1
        """)).first()
        if course is None:
            raise SystemExit("No ready ACID deck found in the database.")
        # Short names for the files, so the questions can say which file.
        doc_of = {}
        for mid, joined in conn.execute(text("""
            SELECT m.id, string_agg(dc.content, ' ')
            FROM materials m JOIN document_chunks dc ON dc.material_id = m.id
            WHERE m.course_id = :c AND m.status = 'ready'
            GROUP BY m.id
        """), {"c": course.id}):
            doc_of[mid] = ("acid" if "Execution Verification" in joined
                           else "unit3" if "Lock compatibility" in joined else "other")
        missing = conn.execute(text("""
            SELECT count(*) FROM document_chunks dc JOIN materials m ON m.id = dc.material_id
            WHERE m.course_id = :c AND dc.embedding IS NULL
        """), {"c": course.id}).scalar_one()
    if missing:
        print(f"Note: {missing} passage(s) in this course have no vector yet; start the backend and let it finish.")

    questions = [q for q in QUESTIONS + EXACT if q[1] in set(doc_of.values())]
    embedder = Embedder(device="cpu")
    t0 = time.perf_counter()
    embedder.load()
    print(f"Model loaded on CPU in {time.perf_counter() - t0:.1f} s; {len(questions)} questions\n")

    modes = ("meaning only", "keywords only", "hybrid")
    ranks = {m: [] for m in modes}
    ms = []
    with engine.connect() as conn:
        for question, doc, pages in questions:
            t0 = time.perf_counter()
            vector = str(embedder.embed_query(question))
            ms.append((time.perf_counter() - t0) * 1000)
            for mode in modes:
                params = {
                    "v": None if mode == "keywords only" else vector,
                    "q": "" if mode == "meaning only" else question,
                    "user_id": course.user_id,
                    "course_id": course.id,
                }
                rows = conn.execute(SEARCH, params).all()
                rank = next((i for i, r in enumerate(rows, start=1)
                             if doc_of.get(r.material_id) == doc and r.page_number in pages), None)
                ranks[mode].append(rank)

    print(f"{'#':>2}  {'question':<58}" + "".join(f"{m:>15}" for m in modes))
    print("-" * (62 + 15 * len(modes)))
    for i, (question, _, _) in enumerate(questions):
        print(f"{i + 1:>2}  {question[:56]:<58}" + "".join(f"{(ranks[m][i] or '-'):>15}" for m in modes))
    print("-" * (62 + 15 * len(modes)))
    n = len(questions)
    for label, f in (("Hit@1", lambda r: r == 1), ("Hit@3", lambda r: r <= 3), ("Hit@5", lambda r: r <= 5)):
        print(f"{'':>2}  {label:<58}" + "".join(f"{sum(1 for r in ranks[m] if r and f(r)) / n:>15.2f}" for m in modes))
    print(f"{'':>2}  {'MRR':<58}" + "".join(f"{sum(1 / r for r in ranks[m] if r) / n:>15.2f}" for m in modes))
    print(f"\nEmbedding one question on CPU: {sum(ms) / len(ms):.0f} ms on average")


if __name__ == "__main__":
    main()
