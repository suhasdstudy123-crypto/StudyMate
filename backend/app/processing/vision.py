"""
The image reader: sends page pictures to Gemini and gets back passages.

    pictures of up to 5 pages + "text we already have" for each page
        -> Gemini (one request)
        -> JSON: for each page, a list of passages {type, content}
        -> Chunk objects, stored by vision_worker.py

Why tell Gemini what text we already have?
  The PDF's own text layer is exact and free (Stage 5a). Gemini should only
  ADD what's inside pictures: screenshots, diagrams, image tables, formulas,
  handwriting. Otherwise every slide title would be stored twice and show up
  twice in search.

Why ask for JSON with a fixed schema ("structured output")?
  Five pages go in one request, so the answer must say which page each
  passage belongs to. With a schema, Gemini is forced to answer in exactly
  this shape, and the SDK turns it into Python objects for us; no guessing
  where page 3's text ends in a long reply.
"""

import logging
import re
from dataclasses import dataclass
from typing import Literal

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

from backend.app.processing.chunking import TARGET_CHARS, Chunk, estimate_tokens

log = logging.getLogger("studymate.vision")


# ------------------------------------------------------------------
# The answer's shape (sent to Gemini as a JSON schema)
# ------------------------------------------------------------------

class VisionPassage(BaseModel):
    type: Literal["text", "table", "diagram"] = Field(
        description="text = transcribed words/code/formulas; table = one markdown table; diagram = a description of a diagram"
    )
    content: str


class VisionPage(BaseModel):
    page_number: int
    passages: list[VisionPassage] = Field(
        description="What the pictures on this page contain that is NOT in the already-extracted text. Empty if nothing new."
    )


class VisionResult(BaseModel):
    pages: list[VisionPage]


# ------------------------------------------------------------------
# The instructions
# ------------------------------------------------------------------

SYSTEM_PROMPT = """\
You read pages of a student's lecture notes (slides, PDFs, scans) for a study \
search engine. Students will ask questions that are answered ONLY from what you \
write, so be complete and exact, and never add anything that is not on the page.

For each page you get: the page number, the text that was already extracted from \
the PDF's text layer, and a picture of the whole page.

Write passages for everything on the picture that is NOT already in the extracted \
text: screenshots, diagrams, charts, tables drawn as images, formulas, handwriting, \
scanned text. If the extracted text is empty, the page is a scan: transcribe all of it.

Rules:
1. Copy text exactly: same words, numbers, symbols, capitalisation and spelling. \
Do not summarise, correct or translate.
2. Screenshots of code, SQL, terminals or program output: copy them exactly inside \
a ``` fenced block, keeping every line break and the ASCII table borders.
3. A table shown as a picture: type "table", as ONE markdown table with a header \
row; put the table's title, if any, on the line above it.
4. Formulas: LaTeX inside the text, $...$ inline or $$...$$ on their own line.
5. Diagrams (flowcharts, state diagrams, ER diagrams, trees, graphs): type \
"diagram". Start with one sentence saying what the diagram shows, using its \
caption if there is one. Then list every box or node with its exact label, and \
every arrow or line as a short sentence: "From <A> to <B>, labelled <label>." \
Keep the original labels word for word.
6. Handwriting: transcribe it; write [unreadable] for parts you cannot read. \
Never guess.
7. Ignore logos, decorative images, page numbers and headers or footers that \
repeat on every page.
8. If the picture adds nothing beyond the extracted text, return no passages for \
that page.
9. Start each passage with a short heading line naming what it is (for example \
"Screenshot: MySQL fund transfer" or "Figure 20.4: Transaction states"), so it \
makes sense when read on its own.

Answer for every page you were given, in the JSON format requested."""


@dataclass
class PageInput:
    page_number: int
    png: bytes
    known_text: str   # what the PDF text layer already gave us for this page


MAX_KNOWN_TEXT = 4000  # characters per page; enough to say "don't repeat this"


def build_contents(pages: list[PageInput]) -> list:
    """One request = for each page: a label, its known text, its picture.
    Labels right before each picture make the page numbers unambiguous."""
    parts: list = []
    for p in pages:
        known = p.known_text.strip()[:MAX_KNOWN_TEXT] or "(none: treat this page as a scan)"
        parts.append(
            types.Part.from_text(
                text=f"=== Page {p.page_number} ===\nAlready extracted text of page {p.page_number}:\n{known}\n\nPicture of page {p.page_number}:"
            )
        )
        # HIGH resolution: small screenshot text must stay readable.
        parts.append(
            types.Part.from_bytes(
                data=p.png, mime_type="image/png", media_resolution=types.PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH
            )
        )
    numbers = ", ".join(str(p.page_number) for p in pages)
    parts.append(types.Part.from_text(text=f"Return passages for pages {numbers}."))
    return parts


# ------------------------------------------------------------------
# Errors the worker reacts to differently
# ------------------------------------------------------------------

class QuotaExceeded(Exception):
    """429 from Google. daily=True: the day's quota is used up (switch model,
    don't retry). daily=False: too many per minute (wait retry_after seconds)."""

    def __init__(self, daily: bool, retry_after: float, message: str):
        super().__init__(message)
        self.daily = daily
        self.retry_after = retry_after


class VisionError(Exception):
    """Anything else (server error, unreadable answer): retry later, max 3 times."""


class ServerBusy(VisionError):
    """5xx from Google (503 = overloaded), or no answer within the timeout.
    Google's problem, not the page's: the attempt doesn't count; the reader
    waits, and if Google stays busy it rests this model and uses the fallback
    for a while. (In the first real run, an overloaded model answered some
    requests with 503 and simply never answered others: same cause.)"""


class ReaderConfigError(VisionError):
    """Our setup is wrong (key rejected, model name unknown). Not the page's
    fault: the pages stay in the queue and the reader pauses until fixed."""


def _parse_quota_error(err: errors.APIError) -> QuotaExceeded:
    """A 429 body looks like:
        {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "details": [
            {"@type": "...QuotaFailure", "violations": [
                {"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier", ...}]},
            {"@type": "...RetryInfo", "retryDelay": "31s"}]}}
    "PerDay" in the quota id = used up until tomorrow. Its retryDelay is
    misleading (often "1s"), so for a daily quota we ignore it."""
    details = (err.details or {}).get("error", {}).get("details", []) if isinstance(err.details, dict) else []
    quota_ids = [v.get("quotaId", "") for d in details for v in d.get("violations", []) or []]
    delay = 60.0
    for d in details:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay", "")))
        if match:
            delay = float(match.group(1))
    daily = any("PerDay" in q for q in quota_ids)
    return QuotaExceeded(daily=daily, retry_after=max(delay, 5.0), message=err.message or "quota exceeded")


# ------------------------------------------------------------------
# The reader
# ------------------------------------------------------------------

# Without a timeout the SDK waits for an answer FOREVER (httpx timeout=None):
# one stalled request froze the reader thread for 10+ minutes in the first
# real run. A normal 5-page request takes well under a minute.
REQUEST_TIMEOUT_MS = 180_000

# 5 slides need a few thousand tokens. A low cap means an answer that gets
# stuck repeating itself stops early (finish reason MAX_TOKENS) and is
# retried, instead of running for minutes.
MAX_OUTPUT_TOKENS = 12_288


class GeminiReader:
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))

    def read(self, model: str, pages: list[PageInput]) -> VisionResult:
        try:
            response = self.client.models.generate_content(
                model=model,
                contents=build_contents(pages),
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=VisionResult,
                    # Copying text needs little reasoning: low thinking = faster
                    # and fewer tokens. Temperature stays at Google's default (1.0):
                    # Google warns lower values can make Gemini 3 models loop.
                    thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
                    max_output_tokens=MAX_OUTPUT_TOKENS,
                ),
            )
        except errors.ClientError as err:
            if err.code == 429:
                raise _parse_quota_error(err) from err
            if err.code in (401, 403, 404):
                # 401/403: key missing, wrong or revoked; 404: model name unknown.
                raise ReaderConfigError(f"Gemini rejected our setup ({err.code}): {err.message}") from err
            # 400: something about this request (e.g. a picture it can't open).
            raise VisionError(f"Gemini refused the request ({err.code}): {err.message}") from err
        except errors.ServerError as err:
            raise ServerBusy(f"Gemini's servers are busy ({err.code})") from err
        except httpx.TimeoutException as err:
            raise ServerBusy(f"Gemini didn't answer within {REQUEST_TIMEOUT_MS // 1000} s") from err
        except httpx.TransportError as err:  # no internet, Wi-Fi dropped, DNS failed
            raise ServerBusy(f"Couldn't reach Gemini ({type(err).__name__})") from err
        except Exception as err:
            raise VisionError(f"Unexpected problem talking to Gemini ({type(err).__name__})") from err

        result = response.parsed
        if not isinstance(result, VisionResult):
            # Cut off (too long) or blocked: no usable JSON came back.
            reason = str(response.candidates[0].finish_reason) if response.candidates else ""
            # These reasons are shown to the student (the page's vision_error), so plain words.
            if "MAX_TOKENS" in reason:
                raise VisionError("Gemini's answer was too long and got cut off")
            if any(r in reason for r in ("SAFETY", "BLOCKLIST", "PROHIBITED", "RECITATION")):
                raise VisionError("Gemini refused to read this page")
            raise VisionError("Gemini's answer couldn't be understood")
        return result


# ------------------------------------------------------------------
# Passages -> chunks (same size rules as text chunks)
# ------------------------------------------------------------------

FENCE = re.compile(r"```.*?```", re.DOTALL)
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")  # PostgreSQL TEXT can't store \x00


def _blocks(text: str) -> list[str]:
    """Split into paragraphs, but a ``` fenced block is one unbreakable piece
    (half a SQL screenshot in one chunk and half in another helps nobody)."""
    blocks, last = [], 0
    for m in FENCE.finditer(text):
        blocks += [b for b in text[last:m.start()].split("\n\n") if b.strip()]
        blocks.append(m.group(0))
        last = m.end()
    blocks += [b for b in text[last:].split("\n\n") if b.strip()]
    return [b.strip() for b in blocks]


def passages_to_chunks(passages: list[VisionPassage]) -> list[Chunk]:
    """Tables and diagrams stay whole (like 5a tables). Long text is grouped
    into ~900-character chunks at paragraph boundaries; the passage's first
    line (its heading, rule 9) is repeated on every piece so each chunk still
    says what it is part of."""
    chunks: list[Chunk] = []
    for p in passages:
        content = CONTROL.sub("", p.content).strip()
        if not content:
            continue
        if p.type != "text" or len(content) <= TARGET_CHARS * 2:
            chunks.append(Chunk(p.type, content, estimate_tokens(content)))
            continue
        blocks = _blocks(content)
        heading = blocks[0].splitlines()[0] if blocks else ""
        current = ""
        for block in blocks:
            if current and len(current) + 2 + len(block) > TARGET_CHARS:
                chunks.append(Chunk("text", current, estimate_tokens(current)))
                current = heading if not block.startswith(heading) else ""
            current = f"{current}\n\n{block}" if current else block
        if current:
            chunks.append(Chunk("text", current, estimate_tokens(current)))
    return chunks
