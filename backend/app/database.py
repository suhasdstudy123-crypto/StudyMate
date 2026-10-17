import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


# Load backend/.env by its exact location.
# load_dotenv() with no path guesses where to look, and under
# "uvicorn --reload" it guesses the terminal's folder (repo root),
# so backend/.env was never found. An explicit path removes the guess.
# __file__ = backend/app/database.py -> parents[1] = backend/
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_PATH)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(f"DATABASE_URL is not set (looked in {ENV_PATH})")


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db():
    db: Session = SessionLocal()

    try:
        yield db
    finally:
        db.close()
