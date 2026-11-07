from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Settings (and loading backend/.env) now live in config.py,
# so every module reads environment values from one place.
from backend.app.config import DATABASE_URL

db_url = DATABASE_URL
if db_url.startswith("postgresql://"):
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        try:
            import psycopg  # noqa: F401
            db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        except ImportError:
            pass

engine = create_engine(
    db_url,
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
