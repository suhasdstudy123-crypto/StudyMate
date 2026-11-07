"""
Tests for embedding generation, validation, and batching in backend/app/services/embeddings.py.
"""

import math
import pytest
import numpy as np

from backend.app.services.embeddings import (
    embed_text,
    embed_texts,
    set_embedding_model,
    validate_embedding,
)


class DummyModel:
    def encode(self, texts, **kwargs):
        if isinstance(texts, str):
            return np.ones(384, dtype=np.float32) / math.sqrt(384)
        return [np.ones(384, dtype=np.float32) / math.sqrt(384) for _ in texts]


def test_validate_embedding_valid():
    vec = [0.1] * 384
    validated = validate_embedding(vec)
    assert len(validated) == 384
    assert isinstance(validated[0], float)


def test_validate_embedding_wrong_dimension():
    with pytest.raises(ValueError, match="Expected embedding dimension 384, got 10"):
        validate_embedding([0.1] * 10)


def test_validate_embedding_non_finite():
    vec = [0.1] * 384
    vec[5] = float("nan")
    with pytest.raises(ValueError, match="non-finite values"):
        validate_embedding(vec)

    vec[5] = float("inf")
    with pytest.raises(ValueError, match="non-finite values"):
        validate_embedding(vec)


def test_embed_text_empty():
    with pytest.raises(ValueError, match="Cannot embed empty text"):
        embed_text("   ")


def test_embed_text_and_batch_with_mock():
    set_embedding_model(DummyModel())

    single = embed_text("What is 3NF in DBMS?")
    assert len(single) == 384
    assert math.isclose(math.sqrt(sum(x * x for x in single)), 1.0, rel_tol=1e-4)

    batch = embed_texts(["Query one", "Query two", "Query three"])
    assert len(batch) == 3
    for vec in batch:
        assert len(vec) == 384
