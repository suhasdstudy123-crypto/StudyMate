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

# Page pictures (Stage 5b): pages the image reader reads are saved as PNG,
# this many pixels on the long side. 2000 px keeps the small text in
# terminal screenshots sharp (about 210 KB per slide).
PAGE_IMAGE_LONG_SIDE = int(os.getenv("PAGE_IMAGE_LONG_SIDE", "2000"))

# --- Image reader: Google Gemini (Stage 5b) -----------------------------
# Optional: without a key the app still works, picture pages just wait.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or None

# Exact model names, never "-latest" aliases: an alias can switch to a new
# model overnight and change the results without any change in our code.
VISION_MODEL = os.getenv("VISION_MODEL", "gemini-3.8-flash")
# Used when the main model's DAILY quota is used up (free tier: separate quota).
VISION_FALLBACK_MODEL = os.getenv("VISION_FALLBACK_MODEL", "gemini-3.5-flash-lite") or None

# Free-tier limits from AI Studio > Rate limit (per project, per model).
# Requests are the bottleneck, not tokens, so several pages go in one request.
VISION_MODEL_RPM = int(os.getenv("VISION_MODEL_RPM", "5"))
VISION_MODEL_RPD = int(os.getenv("VISION_MODEL_RPD", "20"))
VISION_FALLBACK_RPM = int(os.getenv("VISION_FALLBACK_RPM", "15"))
VISION_FALLBACK_RPD = int(os.getenv("VISION_FALLBACK_RPD", "500"))
VISION_PAGES_PER_REQUEST = int(os.getenv("VISION_PAGES_PER_REQUEST", "5"))

# A page that fails this many times is marked failed (the student can retry it).
VISION_MAX_ATTEMPTS = int(os.getenv("VISION_MAX_ATTEMPTS", "3"))

# --- Embeddings: local model (Stage 6) ----------------------------------
# Turns every passage (and every question) into 1024 numbers for meaning
# search. Runs inside the backend, on the GPU if there is one, else the CPU.
# Must output EMBEDDING_DIM numbers (models.py / VECTOR(1024) in schema.sql).
# Changing the model: every vector made by the old one is redone on startup.
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
# "auto" = GPU (cuda) if PyTorch sees one, otherwise CPU. Or force "cpu" / "cuda".
EMBEDDING_DEVICE = os.getenv("EMBEDDING_DEVICE", "auto").lower()
# Passages embedded per step. Lower it if the GPU runs out of memory.
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "16"))
# "false" = don't load the model (saves ~2.5 GB memory; meaning search is off).
EMBEDDING_ENABLED = os.getenv("EMBEDDING_ENABLED", "true").lower() == "true"
