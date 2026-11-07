"""
Step 2 of reading a PDF: split each page into CHUNKS.

Why chunks at all? Search (Stage 6) and the chat (Stage 7) work on small
pieces, not whole files:
  * a question about "dirty reads" should find the ONE paragraph about
    dirty reads, not a 40-page PDF that mentions it somewhere;
  * the embedding model reads at most ~256-512 tokens at a time;
  * the chat model gets a few relevant chunks, not the whole book.

Rules used here (page-aware chunking):
  1. A chunk never crosses a page boundary, so every chunk has ONE exact
     page number for its citation ("DBMS Unit 3, p. 2").
  2. Aim for ~900 characters (~150-200 words): big enough to hold a whole
     idea, small enough to be specific.
  3. Start a new chunk at a heading when the current one already has
     enough text, so a chunk is usually about one topic.
  4. A table is ONE chunk, never split, with its section heading on top.
  5. Consecutive text chunks share one sentence (OVERLAP), so an idea
     that sits on a chunk boundary is still complete in at least one chunk.
"""

import re
from dataclasses import dataclass

TARGET_CHARS = 900    # start a new chunk once we'd go past this
MIN_CHARS = 200       # a heading only starts a new chunk if we have this much
OVERLAP_MAX = 250     # carry the last sentence over if it's at most this long

# Split after . ! ? when the next sentence starts with a capital/digit/quote.
SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")

TOKEN = re.compile(r"\w+|[^\w\s]")


@dataclass
class Chunk:
    chunk_type: str  # "text" | "table"
    content: str
    token_count: int


def estimate_tokens(text: str) -> int:
    # Approximate: words + punctuation marks. The real count depends on the
    # embedding model's tokenizer (Stage 6); this is close enough to compare
    # chunk sizes and spot outliers.
    return max(1, len(TOKEN.findall(text)))


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE_END.split(text) if s.strip()]


def _pieces(paragraph: str) -> list[str]:
    """A paragraph longer than the target is split into sentence groups."""
    if len(paragraph) <= TARGET_CHARS:
        return [paragraph]
    pieces, current = [], ""
    for sentence in split_sentences(paragraph):
        if current and len(current) + 1 + len(sentence) > TARGET_CHARS:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def chunk_page(items: list[tuple[str, str]], is_heading) -> list[Chunk]:
    """Turn one page's items (from extract.py) into chunks, in order."""
    chunks: list[Chunk] = []
    buffer: list[str] = []  # paragraphs collected for the current text chunk

    def size() -> int:
        return sum(len(p) for p in buffer) + max(0, len(buffer) - 1) * 2

    def flush(keep_overlap: bool) -> None:
        nonlocal buffer
        if not buffer:
            return
        content = "\n\n".join(buffer)
        chunks.append(Chunk("text", content, estimate_tokens(content)))
        last = split_sentences(buffer[-1])[-1:] if keep_overlap else []
        # Overlap: start the next chunk with the last sentence of this one.
        buffer = last if last and len(last[0]) <= OVERLAP_MAX and not is_heading(last[0]) else []

    for kind, text in items:
        if kind == "table":
            # A heading right above the table belongs to the table chunk
            # (extract.py already put it on top), not to the text before it.
            if buffer and is_heading(buffer[-1]):
                buffer.pop()
            flush(keep_overlap=False)
            chunks.append(Chunk("table", text, estimate_tokens(text)))
            continue

        if is_heading(text) and size() >= MIN_CHARS:
            flush(keep_overlap=False)  # new section -> new chunk, no overlap

        for piece in _pieces(text):
            if buffer and size() + len(piece) > TARGET_CHARS:
                flush(keep_overlap=True)
            buffer.append(piece)

    flush(keep_overlap=False)

    # A tiny leftover text chunk at the end of the page joins the one before
    # it (if that's text too), instead of becoming a near-empty search result.
    if (
        len(chunks) >= 2
        and chunks[-1].chunk_type == "text"
        and chunks[-2].chunk_type == "text"
        and len(chunks[-1].content) < MIN_CHARS
    ):
        tail = chunks.pop().content
        # If the tail starts with the overlap sentence, it's already at the
        # end of the previous chunk: don't repeat it.
        overlap = split_sentences(chunks[-1].content)[-1:]
        if overlap and tail.startswith(overlap[0]):
            tail = tail[len(overlap[0]):].lstrip()
        merged = f"{chunks[-1].content}\n\n{tail}".rstrip()
        chunks[-1] = Chunk("text", merged, estimate_tokens(merged))

    return chunks
