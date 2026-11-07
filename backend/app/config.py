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

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = Path(__file__).resolve().parents[2]

# Load backend/.env by its exact location, with fallback to root .env
ENV_PATH = BACKEND_DIR / ".env"
if not ENV_PATH.exists() and (ROOT_DIR / ".env").exists():
    ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)


def _required(name: str, fallback_names: list[str] | None = None) -> str:
    # Fail at startup, loudly, instead of failing later on the first request.
    value = os.getenv(name)
    if not value and fallback_names:
        for fb in fallback_names:
            value = os.getenv(fb)
            if value:
                break
    if not value:
        looked = f"{name}" + (f" (or {', '.join(fallback_names)})" if fallback_names else "")
        raise RuntimeError(f"{looked} is not set (looked in {ENV_PATH})")
    return value


# --- Database ---------------------------------------------------------
DATABASE_URL = _required("DATABASE_URL")

# --- Authentication (JWT) ---------------------------------------------
# The secret signs every login token. Anyone who knows it can forge a
# token for any user, so it must be long, random and never committed.
JWT_SECRET_KEY = _required("JWT_SECRET_KEY", ["SECRET_KEY", "JWT_SECRET"])
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

# --- Embedding Model (Stage 6) ------------------------------------------
# sentence-transformers model generating 384-dim vectors matching VECTOR(384)
EMBEDDING_MODEL_NAME = (
    os.getenv("EMBEDDING_MODEL_NAME")
    or os.getenv("EMBEDDING_MODEL")
    or "sentence-transformers/all-MiniLM-L6-v2"
)
EMBEDDING_DEVICE = os.getenv("EMBEDDING_DEVICE", "cpu")
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))

# --- Chat & RAG (Stage 7) ------------------------------------------------
# Model used to answer student questions from retrieved passages.
CHAT_MODEL = (
    os.getenv("CHAT_MODEL")
    or os.getenv("LLM_MODEL")
    or "gemini-3.8-flash"
)
CHAT_TEMPERATURE = float(
    os.getenv("CHAT_TEMPERATURE")
    or os.getenv("LLM_TEMPERATURE")
    or "0.2"
)
RAG_TOP_K = int(
    os.getenv("RAG_TOP_K")
    or os.getenv("TOP_K")
    or "5"
)
RAG_SIMILARITY_THRESHOLD = float(os.getenv("RAG_SIMILARITY_THRESHOLD", "0.0"))
RAG_MAX_CONTEXT_TOKENS = int(os.getenv("RAG_MAX_CONTEXT_TOKENS", "3000"))
