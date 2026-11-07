"""
Tests for file storage operations, path traversal prevention, and cleanup in backend/app/storage.py.
"""

import uuid
import pytest
from pathlib import Path

from backend.app.storage import (
    absolute_path,
    delete_material_files,
    page_image_path,
    relative_path,
    save_bytes,
)


def test_relative_and_page_image_paths():
    user_id = uuid.uuid4()
    material_id = uuid.uuid4()

    rel = relative_path(user_id, material_id)
    assert rel == f"{user_id}/{material_id}.pdf"

    img_path = page_image_path(rel, 12)
    assert img_path == f"{user_id}/{material_id}/page-0012.png"


def test_path_traversal_prevention():
    with pytest.raises(ValueError, match="outside the upload folder"):
        absolute_path("../../etc/passwd")

    with pytest.raises(ValueError, match="outside the upload folder"):
        absolute_path("..\\..\\Windows\\System32\\cmd.exe")


def test_save_and_delete_material_files(tmp_path, monkeypatch):
    from backend.app import storage
    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)

    user_id = uuid.uuid4()
    mat_id = uuid.uuid4()
    rel = f"{user_id}/{mat_id}.pdf"
    img_rel = f"{user_id}/{mat_id}/page-0001.png"

    # Save PDF and image
    save_bytes(rel, b"%PDF-dummy-content")
    save_bytes(img_rel, b"fake-png-bytes")

    pdf_file = tmp_path / rel
    img_file = tmp_path / img_rel
    assert pdf_file.is_file()
    assert img_file.is_file()

    # Delete material files
    delete_material_files([rel])
    assert not pdf_file.exists()
    assert not img_file.exists()
    assert not (tmp_path / f"{user_id}/{mat_id}").exists()
