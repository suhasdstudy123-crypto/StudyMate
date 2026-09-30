from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.database import get_db

from backend.app.routers.users import router as users_router

from backend.app.routers.courses import router as courses_router

from backend.app.routers.materials import router as materials_router

from backend.app.routers.chat_sessions import router as chat_sessions_router

from backend.app.routers.chat_messages import router as chat_messages_router

from backend.app.routers.message_sources import router as message_sources_router

app = FastAPI(
    title="StudyMate API",
    description="Backend API for the StudyMate project",
    version="0.1.0",
)

app.include_router(users_router)
app.include_router(courses_router)
app.include_router(materials_router)
app.include_router(chat_sessions_router)
app.include_router(chat_messages_router)
app.include_router(message_sources_router)

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "StudyMate API",
    }


@app.get("/health/db")
def database_health_check(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT current_database()"))
    database_name = result.scalar_one()

    return {
        "status": "ok",
        "database": database_name,
    }