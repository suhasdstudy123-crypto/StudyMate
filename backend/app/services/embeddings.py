"""
Service for generating dense vector embeddings from text passages and queries.
Uses sentence-transformers (default: all-MiniLM-L6-v2) producing 384-dimensional vectors.
Compatible with VECTOR(384) in database/schema.sql and backend/app/models.py.
"""

import logging
import math
import threading
from typing import Any, Sequence

from backend.app.config import EMBEDDING_BATCH_SIZE, EMBEDDING_DEVICE, EMBEDDING_MODEL_NAME
from backend.app.models import EMBEDDING_DIM

log = logging.getLogger("studymate.embeddings")

_model: Any = None
_model_lock = threading.Lock()


def set_embedding_model(model: Any) -> None:
    """Explicitly inject an embedding model instance (useful for unit testing)."""
    global _model
    with _model_lock:
        _model = model


def get_embedding_model() -> Any:
    """Load the sentence-transformers embedding model once per process."""
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is None:
            log.info(
                "Loading embedding model '%s' on %s...",
                EMBEDDING_MODEL_NAME,
                EMBEDDING_DEVICE,
            )
            from sentence_transformers import SentenceTransformer

            # Prefer locally cached model first to avoid network latency and SSL retries
            try:
                loaded = SentenceTransformer(
                    EMBEDDING_MODEL_NAME,
                    device=EMBEDDING_DEVICE,
                    local_files_only=True,
                )
            except Exception as err:
                log.info(
                    "Local model cache check raised %s. Attempting standard load...",
                    err,
                )
                loaded = SentenceTransformer(
                    EMBEDDING_MODEL_NAME,
                    device=EMBEDDING_DEVICE,
                )
            _model = loaded
            log.info("Embedding model loaded successfully.")
    return _model


def validate_embedding(vec: Sequence[float]) -> list[float]:
    """Validate embedding length and finite float values."""
    if len(vec) != EMBEDDING_DIM:
        raise ValueError(
            f"Expected embedding dimension {EMBEDDING_DIM}, got {len(vec)}"
        )
    result: list[float] = []
    for val in vec:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            raise ValueError("Embedding vector contains non-finite values (NaN or Inf)")
        result.append(f)
    return result


def embed_text(text: str) -> list[float]:
    """Generate a single 384-dim normalized embedding for a query or passage."""
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Cannot embed empty text")
    model = get_embedding_model()
    raw = model.encode(cleaned, normalize_embeddings=True, show_progress_bar=False)
    vec = raw.tolist() if hasattr(raw, "tolist") else list(raw)
    return validate_embedding(vec)


def embed_texts(
    texts: Sequence[str], batch_size: int = EMBEDDING_BATCH_SIZE
) -> list[list[float]]:
    """Generate normalized embeddings for a batch of strings."""
    if not texts:
        return []
    cleaned_texts = [t.strip() if t.strip() else " " for t in texts]
    model = get_embedding_model()
    raw_embeddings = model.encode(
        cleaned_texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    results: list[list[float]] = []
    for raw in raw_embeddings:
        vec = raw.tolist() if hasattr(raw, "tolist") else list(raw)
        results.append(validate_embedding(vec))
    return results
