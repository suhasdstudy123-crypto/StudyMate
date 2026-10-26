"""
The embedding model: text in -> 1024 numbers out (Stage 6).

    passage  "Atomicity. Either all operations ..."  -> [0.021, -0.113, ...]
    question "what does all-or-nothing mean?"         -> [0.034, -0.098, ...]
    similar meaning  ->  vectors pointing in a similar direction

Why local and not a cloud API? Every search embeds the student's question,
so a cloud call would add network delay, rate limits and a failure point to
every search, and send all of a student's notes out. See docs/backend-notes.md.

The model (Qwen/Qwen3-Embedding-0.6B) is loaded ONCE per backend process and
shared by the background worker (passages) and search (questions). Loading
takes a few seconds and ~2.4 GB of memory, so it happens in the worker's
thread, never while the server starts up or answers a request.

torch and sentence_transformers are imported inside load(): importing them
takes seconds, and the rest of the backend (and its tests) doesn't need them.
"""

import logging
import threading
import time

from backend.app.config import EMBEDDING_BATCH_SIZE, EMBEDDING_DEVICE, EMBEDDING_MODEL
from backend.app.models import EMBEDDING_DIM

log = logging.getLogger("studymate.embeddings")

# Qwen3 is "instruction-aware": a QUESTION gets this task line in front, a
# PASSAGE gets nothing. It tells the model "find text that ANSWERS this",
# not "find text that looks like this". Changing it changes question vectors
# only (passages stay valid), so it can be tuned without re-embedding.
QUERY_INSTRUCTION = (
    "Instruct: Given a student's question, retrieve passages from their "
    "course notes that answer the question\nQuery:"
)

# Longest input the model reads, in tokens. Our passages are ~900 characters
# (~160 tokens, longest seen 522); whole tables can be longer. A cap keeps
# GPU memory predictable; longer text is cut, and the worker logs it.
MAX_TOKENS = 2048


class Embedder:
    def __init__(self, model_name: str = EMBEDDING_MODEL, device: str = EMBEDDING_DEVICE,
                 batch_size: int = EMBEDDING_BATCH_SIZE):
        self.model_name = model_name
        self.device_setting = device
        self.batch_size = batch_size
        self.device: str | None = None
        self._model = None
        # One lock: the worker (passages) and search requests (questions) take
        # turns. A question waits at most for one batch (about a second).
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            import torch
            from sentence_transformers import SentenceTransformer

            if self.device_setting == "auto":
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
            else:
                self.device = self.device_setting
            started = time.perf_counter()
            # float32 on purpose: transformers 5 would load Qwen3 in bfloat16
            # (how it is stored), which e.g. a GTX 1650 has no hardware
            # support for. 0.6B parameters x 4 bytes = 2.4 GB.
            model = SentenceTransformer(
                self.model_name, device=self.device, model_kwargs={"dtype": torch.float32}
            )
            model.max_seq_length = MAX_TOKENS
            dim = model.get_embedding_dimension()
            if dim != EMBEDDING_DIM:
                # Fail loudly: the database column holds exactly EMBEDDING_DIM numbers.
                raise RuntimeError(
                    f"{self.model_name} makes {dim} numbers per text, but the database "
                    f"column is VECTOR({EMBEDDING_DIM}). Pick a {EMBEDDING_DIM}-number "
                    f"model or change the column with a migration."
                )
            self._model = model
            log.info("Embedding model %s loaded on %s in %.1f s",
                     self.model_name, self.device, time.perf_counter() - started)

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        """Vectors for passages of notes (no instruction)."""
        return self._encode(texts, prompt=None)

    def embed_query(self, question: str) -> list[float]:
        """Vector for a student's question (with the instruction line)."""
        return self._encode([question], prompt=QUERY_INSTRUCTION)[0]

    def count_tokens(self, texts: list[str]) -> list[int]:
        """Real token counts with the model's own tokenizer (replaces the
        rough estimate from chunking.py)."""
        self.load()
        tokenizer = self._model.tokenizer
        return [max(1, len(tokenizer(t, add_special_tokens=False)["input_ids"])) for t in texts]

    def _encode(self, texts: list[str], prompt: str | None) -> list[list[float]]:
        self.load()
        with self._lock:
            vectors = self._model.encode(
                texts,
                prompt=prompt,
                batch_size=self.batch_size,
                # Length 1, so cosine similarity = dot product, and pgvector's
                # cosine distance (<=>) behaves exactly as in our tests.
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        return [v.tolist() for v in vectors]


# The one shared instance for this backend process.
embedder = Embedder()
