from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Settings (and loading backend/.env) now live in config.py,
# so every module reads environment values from one place.
from backend.app.config import DATABASE_URL

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
