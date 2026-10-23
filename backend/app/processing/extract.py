"""
Step 1 of reading a PDF: EXTRACT what is on each page.

Pure functions: a PyMuPDF page goes in, plain Python data comes out.
No database, no files, so they're easy to test on their own.

For each page we produce
  * items: the page's content in reading order, each either
      ("text",  "A transaction is a logical unit of work ...")
      ("table", "3.2 ACID properties\\n\\n|Property|Meaning|...|")
  * counts: characters, tables, images, drawings, maths symbols
  * needs_vision: True if text extraction alone can't capture the page
    (pictures, screenshots, diagrams, formulas, scanned pages). Stage 5b
    sends those pages to an image-reading model; 5a only detects them.

Two passes:
  1. analyse_document(): look at ALL pages once to find what REPEATS on
     many pages: a header like "Database Management Systems", the
     university logo, a decorative line under every slide title. That is
     page decoration, not content.
  2. extract_page(): read one page, ignoring that decoration.

PyMuPDF ("import pymupdf") is the library that opens the PDF. A PDF page
stores text as positioned pieces, not paragraphs; PyMuPDF groups them into
"blocks" (roughly paragraphs) with their position on the page.
"""

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

# PyMuPDF prints an advert for its extra "layout" package once per run;
# we don't use it, so switch the message off.
pymupdf.no_recommend_layout()

# Text options: join words split with a hyphen at a line end
# ("trans-\naction" -> "transaction"), and ignore text outside the page.
TEXT_FLAGS = pymupdf.TEXT_DEHYPHENATE | pymupdf.TEXT_MEDIABOX_CLIP

# Header/footer band: the top and bottom 12% of a page. Text there is only
# removed if it ALSO repeats on many pages (slide titles differ per page
# and stay). 12%, not 8%: slide headers often sit at ~5-10% of the height.
MARGIN_BAND = 0.12

# Something on at least this share of pages is decoration (logo, header).
REPEAT_SHARE = 0.4

# "8", "Page 8", "8 of 41", "8/41": a bare page number.
PAGE_NUMBER = re.compile(r"^(page\s*)?\d{1,4}(\s*(of|/)\s*\d{1,4})?$", re.IGNORECASE)

# Bullet symbols from slides, all written the same way.
BULLETS = re.compile(r"[●❏❑■□▪▫◦○◆◇❖►▶➢➤➔✓✔✦✧]\s*")

# Symbols that usually mean a formula is on the page. Text extraction
# turns formulas into a jumble ("x2 + y2" for x² + y²), so these pages
# are re-read by the image reader in 5b to get proper LaTeX.
MATH_SYMBOLS = set("∑∏∫∮√∞≈≠≤≥±∓×÷∂∇∈∉⊂⊆⊃⊇∪∩∀∃¬∧∨⇒⇔→←↔αβγδεζηθλμπρστφχψωΓΔΘΛΠΣΦΨΩ")

# needs_vision rules (Stage 9 tunes these on more real notes)
MIN_DRAWINGS_FOR_DIAGRAM = 3   # a few visible lines/shapes outside any table
MIN_MATH_SYMBOLS = 3
LOW_TEXT_CHARS = 100           # less text than this + a drawing = probably a figure
MIN_IMAGE_AREA = 0.005         # images under 0.5% of the page are icons
MIN_IMAGE_SIDE = 24            # ... or thinner than 24 points (1/3 inch)


@dataclass
class DocumentProfile:
    """What repeats across the document (found in pass 1)."""
    margin_texts: set[str] = field(default_factory=set)  # headers/footers
    image_digests: set[bytes] = field(default_factory=set)  # logos (same picture)
    image_boxes: set[tuple] = field(default_factory=set)  # logo spots (same place)
    drawing_keys: set[tuple] = field(default_factory=set)  # decorative lines/boxes


@dataclass
class PageContent:
    page_number: int  # 1-based, like the number printed on the page
    items: list[tuple[str, str]] = field(default_factory=list)
    char_count: int = 0
    table_count: int = 0
    image_count: int = 0
    drawing_count: int = 0
    math_symbol_count: int = 0
    needs_vision: bool = False


# ------------------------------------------------------------------
# Small helpers
# ------------------------------------------------------------------

def clean_text(text: str) -> str:
    # NFC: one standard form for accented letters. Remove control
    # characters: PostgreSQL TEXT can't store the NUL byte (\x00) at all.
    text = unicodedata.normalize("NFC", text)
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    text = BULLETS.sub("• ", text)
    # Lines inside one block are just line wraps -> join with spaces.
    return re.sub(r"\s+", " ", text).strip()


def margin_key(text: str) -> str:
    # "Page 3 of 40" and "Page 4 of 40" must count as the SAME footer:
    # replace every number with #, ignore case and spacing.
    return re.sub(r"\d+", "#", clean_text(text).lower())


def is_heading(text: str) -> bool:
    # A short line that isn't a sentence: "3.2 ACID properties".
    # (Good enough for lecture notes; real font sizes would be the next step.)
    return 0 < len(text) <= 80 and len(text.split()) <= 12 and not text.endswith((".", ",", ";", ":"))


def _inside(rect: pymupdf.Rect, areas: list[pymupdf.Rect]) -> bool:
    # Is the CENTRE of rect inside one of the areas (e.g. a table)?
    centre = pymupdf.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    return any(centre in area for area in areas)


def _in_margin(y0: float, y1: float, height: float) -> bool:
    return y1 <= height * MARGIN_BAND or y0 >= height * (1 - MARGIN_BAND)


def _drawing_key(d: dict) -> tuple:
    # Same shape at the same place (rounded to 2 points) = the same decoration.
    r = d["rect"]
    return (d["type"], round(r.x0 / 2), round(r.y0 / 2), round(r.x1 / 2), round(r.y1 / 2))


def _box_key(rect) -> tuple:
    r = pymupdf.Rect(rect)
    return (round(r.x0 / 4), round(r.y0 / 4), round(r.x1 / 4), round(r.y1 / 4))


def _is_invisible(d: dict) -> bool:
    # No outline and no fill, or a white fill: invisible on a white page.
    # Slide tools put such boxes behind every text box.
    if d.get("color") is not None:  # has a visible outline (stroke)
        return False
    fill = d.get("fill")
    return fill is None or all(c >= 0.95 for c in fill)


def _strip_page_number_lines(raw: str) -> str:
    # The page number is sometimes the LAST LINE of the bottom text block,
    # not a block of its own ("...multiple transactions\n8").
    lines = [line for line in raw.splitlines() if line.strip()]
    while lines and PAGE_NUMBER.match(lines[-1].strip()):
        lines.pop()
    return "\n".join(lines)


def _visible_images(page: pymupdf.Page) -> list[dict]:
    # get_image_info = images actually DRAWN on this page, with position and
    # a content fingerprint (digest). (get_images() lists every image the
    # page could reference; some PDF tools attach 100+ to every page.)
    return page.get_image_info(hashes=True)


# ------------------------------------------------------------------
# Pass 1 (whole document): what repeats on many pages?
# ------------------------------------------------------------------

def analyse_document(doc: pymupdf.Document) -> DocumentProfile:
    texts: Counter[str] = Counter()
    images: Counter[bytes] = Counter()
    image_boxes: Counter[tuple] = Counter()
    drawings: Counter[tuple] = Counter()

    for page in doc:
        h = page.rect.height
        # A set per page, so something drawn twice on one page counts once.
        texts.update({
            margin_key(text)
            for x0, y0, x1, y1, text, *_ in page.get_text("blocks", flags=TEXT_FLAGS)
            if _in_margin(y0, y1, h)
        })
        shown = _visible_images(page)
        images.update({info["digest"] for info in shown if info.get("digest")})
        image_boxes.update({_box_key(info["bbox"]) for info in shown})
        drawings.update({_drawing_key(d) for d in page.get_drawings()})

    threshold = max(2, round(len(doc) * REPEAT_SHARE))  # on 40%+ of pages (and at least 2)
    return DocumentProfile(
        margin_texts={key for key, n in texts.items() if n >= threshold and key},
        image_digests={key for key, n in images.items() if n >= threshold},
        # A spot where an image sits on 40%+ of pages is the logo's place,
        # even if a slightly different logo file is drawn there sometimes.
        image_boxes={key for key, n in image_boxes.items() if n >= threshold},
        drawing_keys={key for key, n in drawings.items() if n >= threshold},
    )


# ------------------------------------------------------------------
# Pass 2 (one page): text, tables and what can't be read as text
# ------------------------------------------------------------------

def extract_page(page: pymupdf.Page, profile: DocumentProfile, last_heading: str | None) -> tuple[PageContent, str | None]:
    """Read one page. `last_heading` carries the most recent heading from
    earlier pages, so a table at the top of a page still gets its section
    title. Returns the page content and the heading to carry forward."""
    result = PageContent(page_number=page.number + 1)
    h = page.rect.height
    page_area = page.rect.width * h

    # ---- Tables: kept WHOLE, as markdown --------------------------------
    # find_tables() looks for ruled lines and aligned text. Each table
    # becomes one chunk later: splitting a table in half would separate
    # values from their column headers and make both halves useless.
    tables = [t for t in page.find_tables().tables if t.row_count >= 2 and t.col_count >= 2]
    table_areas = [pymupdf.Rect(t.bbox) + (-2, -2, 2, 2) for t in tables]  # small margin
    positioned: list[tuple[float, str, str]] = []  # (y position, kind, text)
    for table, area in zip(tables, table_areas):
        markdown = clean_markdown(table.to_markdown())
        if markdown:
            positioned.append((area.y0, "table", markdown))
    result.table_count = len(positioned)

    # ---- Text blocks, in reading order (top to bottom, left to right) ---
    for x0, y0, x1, y1, raw, _block_no, block_type in page.get_text("blocks", flags=TEXT_FLAGS, sort=True):
        if block_type != 0:  # 1 = image block, not text
            continue
        rect = pymupdf.Rect(x0, y0, x1, y1)
        if _in_margin(y0, y1, h):
            key = margin_key(raw)
            if key in profile.margin_texts or PAGE_NUMBER.match(key.replace("#", "1")):
                continue  # repeated header/footer or a bare page number
        if y1 >= h * (1 - MARGIN_BAND):
            raw = _strip_page_number_lines(raw)
        if _inside(rect, table_areas):
            continue  # already part of a table chunk; don't read it twice
        text = clean_text(raw)
        if text:
            positioned.append((y0, "text", text))

    # Tables and text merged by their height on the page.
    positioned.sort(key=lambda item: item[0])

    # ---- Build items: attach headings to tables, rejoin broken lines ----
    heading = last_heading
    heading_before = last_heading  # to undo a "heading" that turns out to be a broken line
    for _, kind, text in positioned:
        if kind == "table":
            result.items.append(("table", f"{heading}\n\n{text}" if heading else text))
            continue
        previous = result.items[-1] if result.items else None
        if (
            previous
            and previous[0] == "text"
            and not previous[1].endswith((".", ":", "!", "?"))
            and text[:1].islower()
        ):
            # Justified slide text is sometimes one block per LINE:
            # "...allow multiple transactions to run" + "concurrently. ..."
            # A line that doesn't end a sentence followed by one starting
            # in lowercase is the same paragraph: join them. (A short first
            # line can look like a heading; a real heading is never
            # continued in lowercase, so undo that guess.)
            if heading == previous[1]:
                heading = heading_before
            result.items[-1] = ("text", f"{previous[1]} {text}")
            continue
        if is_heading(text):
            heading_before, heading = heading, text
        result.items.append(("text", text))

    # ---- What text extraction CAN'T capture ----------------------------
    result.char_count = sum(len(text) for kind, text in result.items if kind == "text")

    for info in _visible_images(page):
        box = pymupdf.Rect(info["bbox"]) & page.rect  # the part on the page
        if info.get("digest") in profile.image_digests or _box_key(info["bbox"]) in profile.image_boxes:
            continue  # the logo on every slide (same picture, or same place)
        if box.width * box.height < page_area * MIN_IMAGE_AREA or min(box.width, box.height) < MIN_IMAGE_SIDE:
            continue  # icons, bullets, tiny marks
        result.image_count += 1

    for d in page.get_drawings():
        r = d["rect"]
        if (
            _is_invisible(d)                                   # white/empty boxes behind text
            or r.width * r.height >= page_area * 0.9           # page background
            or _drawing_key(d) in profile.drawing_keys         # the line under every slide title
            or _inside(r, table_areas)                         # table borders
            or max(r.width, r.height) < 15                     # tiny marks / underlines
        ):
            continue
        result.drawing_count += 1

    all_text = " ".join(text for _, text in result.items)
    result.math_symbol_count = sum(1 for ch in all_text if ch in MATH_SYMBOLS)

    result.needs_vision = (
        result.image_count > 0
        or result.drawing_count >= MIN_DRAWINGS_FOR_DIAGRAM
        or result.math_symbol_count >= MIN_MATH_SYMBOLS
        # almost no text but something drawn: probably a full-page figure
        or (result.char_count < LOW_TEXT_CHARS and result.drawing_count > 0)
    )
    return result, heading


def clean_markdown(markdown: str) -> str:
    # Keep table rows, drop blank lines; control characters removed.
    lines = []
    for line in markdown.splitlines():
        line = "".join(ch for ch in line if unicodedata.category(ch)[0] != "C").strip()
        if line:
            lines.append(line)
    # A table whose cells are all empty is just a box drawn on the page.
    has_content = any(re.sub(r"[|\-\s:]", "", line) for line in lines[2:])
    return "\n".join(lines) if has_content else ""
