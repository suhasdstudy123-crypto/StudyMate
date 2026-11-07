"""
Turning a PDF page into a picture (Stage 5b).

Why a picture of the WHOLE page, not just the images inside it?
  * Many diagrams aren't images at all: they are drawn with lines and
    boxes (vector drawings), so there is no picture file to pull out.
  * A slide's title, labels and arrows give the picture its meaning;
    the image reader understands a screenshot better with its slide around it.
  * The same picture is shown to the student when a citation points at an
    image-based passage, so they can check what the reader saw.

PNG instead of JPEG: PNG is lossless (letters stay sharp, no blurry
"JPEG artifacts" around text), and for slides it's about the same size
(measured on the ACID deck: ~210 KB per page either way).
"""

import pymupdf

from backend.app.config import PAGE_IMAGE_LONG_SIDE


def render_page_png(page: pymupdf.Page, long_side: int = PAGE_IMAGE_LONG_SIDE) -> bytes:
    # PDF sizes are in points (1/72 inch); a 16:9 slide is 960 x 540 points.
    # zoom = how many pixels per point, chosen so the LONG side is exactly
    # `long_side` pixels, whatever the page's shape (slide, A4, portrait...).
    zoom = long_side / max(page.rect.width, page.rect.height)
    # alpha=False: a white background instead of transparency. Some PDFs have
    # no page background, and transparent + black text looks black-on-black
    # in some viewers. Annotations (handwritten notes on the PDF) are included.
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")
