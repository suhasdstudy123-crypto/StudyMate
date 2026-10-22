from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.routers.admin import router as admin_router
from backend.app.routers.auth import router as auth_router
from backend.app.routers.courses import router as courses_router

# Routers for materials/upload (Stage 5) and RAG chat (Stage 7)
# are added here as each stage is built.

app = FastAPI(
    title="StudyMate API",
    description="Backend API for StudyMate: upload study material, ask questions, get answers from your own notes.",
    version="0.4.0",
)

app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(admin_router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "StudyMate API"}


@app.get("/health/db")
def database_health_check(db: Session = Depends(get_db)):
    database_name = db.execute(text("SELECT current_database()")).scalar_one()
    return {"status": "ok", "database": database_name}
