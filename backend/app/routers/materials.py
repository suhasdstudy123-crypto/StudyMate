"""
Materials = uploaded PDFs inside a course.

  POST   /courses/{course_id}/materials        upload a PDF (multipart form)
  GET    /courses/{course_id}/materials        files in a course (+ progress)
  GET    /materials/{id}                       one file (the browser polls this)
  GET    /materials/{id}/file                  the PDF itself, to view it
  GET    /materials/{id}/pages                 what was found on each page
  GET    /materials/{id}/pages/{n}             the chunks of page n
  GET    /materials/{id}/pages/{n}/image       the page's picture (pages the image reader reads)
  PATCH  /materials/{id}                       rename (title)
  POST   /materials/{id}/retry                 try a failed file again
  POST   /materials/{id}/vision/retry          read this file's failed picture pages again
  DELETE /materials/{id}                       delete file + its chunks

Same ownership rule as courses: every query joins to courses and checks
user_id = the logged-in user, and someone else's file is a 404.
"""

import logging
from pathlib import PureWindowsPath
from typing import Literal
from uuid import UUID, uuid4

import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.config import MAX_PDF_PAGES, MAX_UPLOAD_MB
from backend.app.database import get_db
from backend.app.deps import get_current_user
from backend.app.models import Course, DocumentChunk, DocumentPage, Material, User
from backend.app.processing import vision_worker
from backend.app.processing.worker import enqueue
from backend.app.routers.courses import get_owned_course_or_404
from backend.app.schemas import ChunkResponse, MaterialSummary, MaterialUpdate, PageDetail, PageSummary
from backend.app.storage import (
    FileTooLarge,
    absolute_path,
    delete_material_files,
    move_into_place,
    relative_path,
    save_to_temp,
)

log = logging.getLogger("studymate.materials")

router = APIRouter(tags=["Materials"])


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

SUMMARY_SQL = """
    SELECT id, course_id, title, original_filename, file_size, page_count,
           pages_processed, status, error_message, chunk_count, table_count,
           vision_page_count, created_at, updated_at, processing_mode,
           vision_waiting_count, vision_done_count, vision_failed_count
    FROM material_overview
    WHERE user_id = :user_id
"""


def get_summary(db: Session, material_id: UUID, user: User) -> MaterialSummary:
    row = db.execute(
        text(SUMMARY_SQL + " AND id = :id"), {"user_id": user.id, "id": material_id}
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return MaterialSummary(**row)


def get_owned_material_or_404(db: Session, material_id: UUID, user: User) -> Material:
    #   SELECT m.* FROM materials m JOIN courses c ON c.id = m.course_id
    #   WHERE m.id = :id AND c.user_id = :me
    material = (
        db.query(Material)
        .join(Course, Course.id == Material.course_id)
        .filter(Material.id == material_id, Course.user_id == user.id)
        .first()
    )
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return material


def title_from_filename(filename: str) -> str:
    # Some browsers send "C:\fakepath\notes.pdf"; keep only "notes".
    name = PureWindowsPath(filename).name
    if name.lower().endswith(".pdf"):
        name = name[:-4]
    name = " ".join(name.replace("_", " ").split())
    return (name or "Untitled PDF")[:255]


# ------------------------------------------------------------------
# Upload
# ------------------------------------------------------------------

@router.post(
    "/courses/{course_id}/materials",
    response_model=MaterialSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_material(
    course_id: UUID,
    file: UploadFile = File(..., description="A PDF file"),
    # A second form field next to the file. Literal = only these two values
    # are accepted; anything else is a 422 before our code runs.
    mode: Literal["smart", "thorough"] = Form(
        "smart",
        description="smart: only pages with pictures are read as images; thorough: every page is",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """202 Accepted = "received, the work happens later". The PDF is stored
    now; reading it happens in the background and the client polls
    GET /materials/{id} for progress."""
    course = get_owned_course_or_404(db, course_id, current_user)
    filename = file.filename or "upload.pdf"

    # 1. Copy to a temporary file, measuring size and computing the fingerprint.
    try:
        temp, size, content_hash, head = save_to_temp(file.file)
    except FileTooLarge:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f"This file is bigger than {MAX_UPLOAD_MB} MB."
        )

    final_rel: str | None = None
    try:
        # 2. Is it REALLY a PDF? The file name and the browser's "type" can
        #    say anything. Every PDF starts with the bytes "%PDF-".
        if size == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This file is empty.")
        if b"%PDF-" not in head:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only PDF files can be uploaded."
            )

        # 3. Can we open it? (damaged, password-protected, too long?)
        try:
            with pymupdf.open(temp, filetype="pdf") as pdf:
                encrypted = pdf.needs_pass
                page_count = pdf.page_count
        except Exception:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "This PDF is damaged and can't be opened."
            )
        if encrypted:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "This PDF is password-protected. Remove the password and upload it again.",
            )
        if page_count == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This PDF has no pages.")
        if page_count > MAX_PDF_PAGES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"This PDF has {page_count} pages; the limit is {MAX_PDF_PAGES}. Split it into parts.",
            )

        # 4. Same file already in this course? (friendly message; the UNIQUE
        #    (course_id, content_hash) constraint is the real guarantee)
        existing = db.query(Material.title).filter(
            Material.course_id == course.id, Material.content_hash == content_hash
        ).scalar()
        if existing:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f'This file is already in this course as "{existing}".'
            )

        # 5. File first, then the database row.
        #    A database transaction can't undo a file on disk. So: put the
        #    file in place, then COMMIT the row. If the commit fails, delete
        #    the file ourselves (a "compensating action"). Either both exist
        #    or neither does.
        material_id = uuid4()
        final_rel = relative_path(current_user.id, material_id)
        move_into_place(temp, final_rel)

        db.add(
            Material(
                id=material_id,
                course_id=course.id,
                title=title_from_filename(filename),
                original_filename=PureWindowsPath(filename).name[:255] or "upload.pdf",
                stored_path=final_rel,
                mime_type="application/pdf",
                file_size=size,
                content_hash=content_hash,
                page_count=page_count,
                status="pending",
                processing_mode=mode,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "This file is already in this course.")
    except BaseException:
        temp.unlink(missing_ok=True)
        if final_rel:
            delete_material_files([final_rel])
        raise

    # 6. Only AFTER the commit: a worker thread uses its own connection, and
    #    it can't see a row that isn't committed yet.
    enqueue(material_id)
    return get_summary(db, material_id, current_user)


# ------------------------------------------------------------------
# Reading
# ------------------------------------------------------------------

@router.get("/courses/{course_id}/materials", response_model=list[MaterialSummary])
def list_course_materials(
    course_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_owned_course_or_404(db, course_id, current_user)
    rows = db.execute(
        text(SUMMARY_SQL + " AND course_id = :course_id ORDER BY created_at DESC"),
        {"user_id": current_user.id, "course_id": course_id},
    ).mappings()
    return [MaterialSummary(**row) for row in rows]


@router.get("/materials/{material_id}", response_model=MaterialSummary)
def get_material(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_summary(db, material_id, current_user)


@router.get("/materials/{material_id}/file")
def download_material(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = get_owned_material_or_404(db, material_id, current_user)
    path = absolute_path(material.stored_path)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The stored file is missing.")
    # inline = open in the browser's PDF viewer instead of downloading
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=material.original_filename,
        content_disposition_type="inline",
    )


PAGES_SQL = """
    SELECT p.page_number, p.char_count, p.table_count, p.image_count,
           p.drawing_count, p.math_symbol_count, p.needs_vision,
           p.vision_status, p.vision_error, (p.image_path IS NOT NULL) AS has_image,
           count(dc.id) AS chunk_count
    FROM document_pages p
    LEFT JOIN document_chunks dc
           ON dc.material_id = p.material_id AND dc.page_number = p.page_number
    WHERE p.material_id = :id
    GROUP BY p.material_id, p.page_number
    ORDER BY p.page_number
"""
# GROUP BY the primary key (material_id, page_number) lets us SELECT the
# page's other columns too: PostgreSQL knows they have one value per group.


@router.get("/materials/{material_id}/pages", response_model=list[PageSummary])
def list_pages(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_owned_material_or_404(db, material_id, current_user)
    rows = db.execute(text(PAGES_SQL), {"id": material_id}).mappings()
    return [PageSummary(**row) for row in rows]


@router.get("/materials/{material_id}/pages/{page_number}", response_model=PageDetail)
def get_page(
    material_id: UUID,
    page_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_owned_material_or_404(db, material_id, current_user)
    page = db.get(DocumentPage, (material_id, page_number))  # composite primary key
    if page is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page not found")
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.material_id == material_id, DocumentChunk.page_number == page_number)
        .order_by(DocumentChunk.chunk_index)
        .all()
    )
    summary = PageSummary.model_validate(page)
    summary.chunk_count = len(chunks)
    summary.has_image = page.image_path is not None
    return PageDetail(page=summary, chunks=[ChunkResponse.model_validate(c) for c in chunks])


@router.get("/materials/{material_id}/pages/{page_number}/image")
def get_page_image(
    material_id: UUID,
    page_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The saved picture of a page. Same ownership check as everything else:
    someone else's page picture is a 404, like their file."""
    get_owned_material_or_404(db, material_id, current_user)
    page = db.get(DocumentPage, (material_id, page_number))
    if page is None or page.image_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This page has no picture.")
    path = absolute_path(page.image_path)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The page picture is missing.")
    # "private": only the student's own browser may cache it, never a shared
    # proxy (it's their notes). One hour: switching between pages in the
    # viewer doesn't download the same picture again.
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


# ------------------------------------------------------------------
# Changing
# ------------------------------------------------------------------

@router.patch("/materials/{material_id}", response_model=MaterialSummary)
def rename_material(
    material_id: UUID,
    data: MaterialUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = get_owned_material_or_404(db, material_id, current_user)
    material.title = data.title  # only the display name; the stored file is untouched
    db.commit()
    return get_summary(db, material.id, current_user)


@router.post(
    "/materials/{material_id}/retry",
    response_model=MaterialSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_material(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = get_owned_material_or_404(db, material_id, current_user)
    if material.status != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a file that failed can be retried.")
    material.status = "pending"
    material.pages_processed = 0
    material.error_message = None
    db.commit()
    enqueue(material.id)
    return get_summary(db, material.id, current_user)


@router.post(
    "/materials/{material_id}/vision/retry",
    response_model=MaterialSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_failed_pages(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pages the image reader gave up on (failed) go back in its queue with a
    fresh set of attempts. Only failed pages: pages already read keep their passages."""
    get_owned_material_or_404(db, material_id, current_user)
    count = db.execute(
        text(
            "UPDATE document_pages SET vision_status = 'pending', vision_attempts = 0, vision_error = NULL "
            "WHERE material_id = :id AND vision_status = 'failed'"
        ),
        {"id": material_id},
    ).rowcount
    if count == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "This file has no failed pages to retry.")
    db.commit()
    vision_worker.wake()
    return get_summary(db, material_id, current_user)


@router.delete("/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = get_owned_material_or_404(db, material_id, current_user)
    if material.status == "processing":
        # The worker's open transaction holds this row; deleting now would
        # have to wait for it. Let the client try again when it's done.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This file is being read right now. Try again when it's done."
        )
    stored = material.stored_path
    db.delete(material)  # ON DELETE CASCADE removes its pages and chunks
    db.commit()
    delete_material_files([stored])  # the row is gone for sure; now remove the file
