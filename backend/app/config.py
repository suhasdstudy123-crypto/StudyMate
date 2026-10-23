"""
Central settings: every value that changes between machines or between
development and production is read from environment variables here,
so no secret is ever written in the code.

backend/.env (gitignored) provides the values on your machine.
In production the hosting platform provides them instead.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env by its exact location.
# load_dotenv() with no path guesses where to look, and under
# "uvicorn --reload" it guesses the terminal's folder (repo root),
# so backend/.env was never found. An explicit path removes the guess.
# __file__ = backend/app/config.py -> parents[1] = backend/
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_PATH)


def _required(name: str) -> str:
    # Fail at startup, loudly, instead of failing later on the first request.
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set (looked in {ENV_PATH})")
    return value


# --- Database ---------------------------------------------------------
DATABASE_URL = _required("DATABASE_URL")

# --- Authentication (JWT) ---------------------------------------------
# The secret signs every login token. Anyone who knows it can forge a
# token for any user, so it must be long, random and never committed.
JWT_SECRET_KEY = _required("JWT_SECRET_KEY")
if len(JWT_SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET_KEY is too short: use at least 32 random characters")

# HS256 = HMAC with SHA-256: one shared secret both signs and verifies.
# Fine here because only our backend ever creates or checks tokens.
JWT_ALGORITHM = "HS256"

# How long a login lasts before the user must log in again (default 1 day).
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# Name of the browser cookie that carries the token.
AUTH_COOKIE_NAME = "studymate_token"

# Secure cookies are only sent over HTTPS. Local development runs on
# plain http://localhost, so this is false locally and true in production.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# --- Uploaded files (Stage 5) ------------------------------------------
# Where uploaded PDFs are kept. Default: backend/uploads (gitignored).
# Only RELATIVE paths ("<user id>/<material id>.pdf") go into the database,
# so this folder can move (e.g. to a disk on the server) without breaking rows.
BACKEND_DIR = Path(__file__).resolve().parents[1]
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BACKEND_DIR / "uploads"))).resolve()

# Bigger uploads are refused (413). Lecture-note PDFs are usually < 20 MB.
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

# Longer PDFs are refused: a 2,000-page book would block processing for long.
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "500"))

# How many PDFs are read at the same time (each uses one CPU core).
PROCESSING_WORKERS = int(os.getenv("PROCESSING_WORKERS", "2"))
