"""
Where uploaded PDFs live on disk, and the only code that touches them.

Layout:   UPLOAD_DIR/<user id>/<material id>.pdf
          UPLOAD_DIR/tmp/<random>.part      (uploads still arriving)

Security rules:
  * The student's file name is NEVER used in a path. A name like
    "../../backend/.env" could otherwise write outside the folder
    (a "path traversal" attack). We name files by their database id.
  * The database stores only the RELATIVE path, and every path is checked
    to really be inside UPLOAD_DIR before it's used.
"""

import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import BinaryIO

from backend.app.config import MAX_UPLOAD_BYTES, UPLOAD_DIR

log = logging.getLogger("studymate.storage")

READ_SIZE = 1024 * 1024  # copy 1 MB at a time, never the whole file in memory


class FileTooLarge(Exception):
    pass


def relative_path(user_id: uuid.UUID, material_id: uuid.UUID) -> str:
    # Forward slashes work on Windows and Linux alike.
    return f"{user_id}/{material_id}.pdf"


def absolute_path(rel: str) -> Path:
    path = (UPLOAD_DIR / rel).resolve()
    if not path.is_relative_to(UPLOAD_DIR):
        raise ValueError("Path is outside the upload folder")
    return path


def save_to_temp(source: BinaryIO) -> tuple[Path, int, str, bytes]:
    """Copy an upload into a temporary file while measuring and hashing it.

    Returns (temp path, size in bytes, SHA-256 hex, first 1 KB).
    SHA-256 turns the file's bytes into a 64-character fingerprint: the same
    file always gives the same fingerprint, so a re-upload is detected even
    if the file was renamed."""
    tmp_dir = UPLOAD_DIR / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    temp = tmp_dir / f"{uuid.uuid4()}.part"
    sha = hashlib.sha256()
    size = 0
    head = b""
    try:
        with temp.open("wb") as out:
            while block := source.read(READ_SIZE):
                size += len(block)
                if size > MAX_UPLOAD_BYTES:
                    raise FileTooLarge()
                if len(head) < 1024:
                    head += block[: 1024 - len(head)]
                sha.update(block)
                out.write(block)
    except BaseException:
        temp.unlink(missing_ok=True)  # never leave half-written files behind
        raise
    return temp, size, sha.hexdigest(), head


def move_into_place(temp: Path, rel: str) -> Path:
    final = absolute_path(rel)
    final.parent.mkdir(parents=True, exist_ok=True)
    # os.replace = a rename: instant and all-or-nothing on the same disk.
    os.replace(temp, final)
    return final


def delete_files(rel_paths: list[str]) -> None:
    """Remove stored PDFs AFTER their database rows were deleted.
    A file that can't be removed (already gone, or open in another program
    on Windows) is logged, not fatal: the rows are already gone."""
    for rel in rel_paths:
        try:
            absolute_path(rel).unlink(missing_ok=True)
        except (OSError, ValueError):
            log.warning("Could not delete stored file %s", rel, exc_info=True)
