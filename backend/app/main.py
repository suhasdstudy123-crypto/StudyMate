import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.config import UPLOAD_DIR
from backend.app.database import get_db
from backend.app.processing import vision_worker, worker
from backend.app.routers.admin import router as admin_router
from backend.app.routers.auth import router as auth_router
from backend.app.routers.courses import router as courses_router
from backend.app.routers.materials import router as materials_router
from backend.app.routers.vision import router as vision_router

# Our own log lines ("Processed material ...") in the server terminal.
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
_log = logging.getLogger("studymate")
_log.setLevel(logging.INFO)
_log.addHandler(_handler)
_log.propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- runs once when the server STARTS --------------------------------
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    # Half-received uploads from a previous run are useless: remove them.
    for leftover in (UPLOAD_DIR / "tmp").glob("*.part"):
        leftover.unlink(missing_ok=True)
    # Files that were waiting or being read when the server stopped go
    # back into the queue (the background queue lives in memory only).
    requeued = worker.requeue_unfinished()
    if requeued:
        _log.info("Re-queued %d unfinished file(s)", requeued)
    # The image reader (Stage 5b): one thread reading picture pages via Gemini.
    vision_worker.start()

    yield  # the server runs and answers requests here

    # ---- runs once when the server STOPS ---------------------------------
    vision_worker.stop()
    worker.shutdown()


app = FastAPI(
    title="StudyMate API",
    description="Backend API for StudyMate: upload study material, ask questions, get answers from your own notes.",
    version="0.5.0",
    lifespan=lifespan,
)

app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(materials_router)
app.include_router(vision_router)
app.include_router(admin_router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "StudyMate API"}


@app.get("/health/db")
def database_health_check(db: Session = Depends(get_db)):
    database_name = db.execute(text("SELECT current_database()")).scalar_one()
    return {"status": "ok", "database": database_name}
