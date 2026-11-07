"""
Tests for configuration loading and validation in backend/app/config.py.
"""

import os
import pytest
from unittest.mock import patch


def test_config_defaults():
    from backend.app.config import (
        EMBEDDING_DEVICE,
        EMBEDDING_MODEL_NAME,
        PAGE_IMAGE_LONG_SIDE,
        RAG_SIMILARITY_THRESHOLD,
        RAG_TOP_K,
        VISION_MAX_ATTEMPTS,
        VISION_MODEL,
    )

    assert EMBEDDING_MODEL_NAME == "sentence-transformers/all-MiniLM-L6-v2"
    assert EMBEDDING_DEVICE == "cpu"
    assert RAG_TOP_K == 5
    assert RAG_SIMILARITY_THRESHOLD == 0.0
    assert VISION_MAX_ATTEMPTS == 3
    assert VISION_MODEL == "gemini-3.8-flash"
    assert PAGE_IMAGE_LONG_SIDE == 2000


def test_jwt_secret_validation():
    from backend.app.config import _required

    with pytest.raises(RuntimeError, match="NON_EXISTENT_VAR is not set"):
        _required("NON_EXISTENT_VAR")
