-- ============================================================
-- Migration 002: pages, chunk types and processing progress (Stage 5a)
--
-- What this adds and why:
--   * materials.pages_processed  -> a progress bar while a PDF is read
--                                   ("page 12 of 40")
--   * document_pages             -> one row per PDF page: what was found
--                                   on it (text, tables, images, diagrams)
--                                   and whether it needs the image reader
--                                   (Stage 5b) because text extraction
--                                   alone can't capture it
--   * document_chunks.chunk_type -> 'text' or 'table' (tables are kept whole)
--   * chunk -> page foreign key  -> every chunk must belong to a real page
--   * material_overview VIEW     -> one row per file with its counts, for
--                                   the course page (like course_overview)
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/002_document_pages_and_progress.sql
-- One transaction: if any step fails, nothing is changed.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Progress counter on materials
-- ------------------------------------------------------------
ALTER TABLE materials
    ADD COLUMN pages_processed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE materials
    ADD CONSTRAINT materials_pages_processed_check
    CHECK (pages_processed >= 0 AND (page_count IS NULL OR pages_processed <= page_count));


-- ------------------------------------------------------------
-- 2. One row per page
-- The primary key is the PAIR (material_id, page_number): page 3 exists
-- once per file, and "page 3" alone means nothing without the file.
-- ------------------------------------------------------------
CREATE TABLE document_pages (
    material_id        UUID        NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    page_number        INTEGER     NOT NULL,
    char_count         INTEGER     NOT NULL DEFAULT 0,  -- characters of real text found
    table_count        INTEGER     NOT NULL DEFAULT 0,
    image_count        INTEGER     NOT NULL DEFAULT 0,  -- embedded pictures / scans
    drawing_count      INTEGER     NOT NULL DEFAULT 0,  -- vector shapes outside tables (diagrams)
    math_symbol_count  INTEGER     NOT NULL DEFAULT 0,  -- symbols like ∑ ∫ ≤ θ (formulas)
    -- true = text extraction can't capture everything on this page;
    -- Stage 5b sends these pages to the image reader.
    needs_vision       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (material_id, page_number),
    CONSTRAINT document_pages_page_check   CHECK (page_number > 0),
    CONSTRAINT document_pages_counts_check CHECK (
        char_count >= 0 AND table_count >= 0 AND image_count >= 0
        AND drawing_count >= 0 AND math_symbol_count >= 0
    )
);

-- 5b will ask "which pages of this file need the image reader?"
-- A PARTIAL index only contains the rows matching its WHERE, so it stays
-- tiny (most pages are plain text) and that question is answered fast.
CREATE INDEX idx_pages_needs_vision ON document_pages(material_id) WHERE needs_vision;


-- ------------------------------------------------------------
-- 3. Chunk type + every chunk points at its page
-- ------------------------------------------------------------
ALTER TABLE document_chunks
    ADD COLUMN chunk_type VARCHAR(10) NOT NULL DEFAULT 'text';

ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_type_check CHECK (chunk_type IN ('text', 'table'));

-- A COMPOSITE foreign key: the pair (material_id, page_number) must exist
-- in document_pages. A chunk can't claim to be on page 99 of a 40-page file.
ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_page_fk
    FOREIGN KEY (material_id, page_number)
    REFERENCES document_pages(material_id, page_number) ON DELETE CASCADE;

-- Supports that foreign key and "show me the chunks of page N".
CREATE INDEX idx_chunks_material_page ON document_chunks(material_id, page_number);


-- ------------------------------------------------------------
-- 4. Per-file overview for the course page
-- Each count is its own subquery, so counting chunks and pages together
-- doesn't multiply the numbers (the same reason as user_overview).
-- user_id comes from the course, so the API can filter "my files only".
-- ------------------------------------------------------------
CREATE VIEW material_overview AS
SELECT
    m.id,
    m.course_id,
    c.user_id,
    m.title,
    m.original_filename,
    m.file_size,
    m.page_count,
    m.pages_processed,
    m.status,
    m.error_message,
    m.created_at,
    m.updated_at,
    (SELECT count(*) FROM document_chunks dc
      WHERE dc.material_id = m.id)                             AS chunk_count,
    (SELECT count(*) FROM document_chunks dc
      WHERE dc.material_id = m.id AND dc.chunk_type = 'table') AS table_count,
    (SELECT count(*) FROM document_pages dp
      WHERE dp.material_id = m.id AND dp.needs_vision)         AS vision_page_count
FROM materials m
JOIN courses c ON c.id = m.course_id;

COMMIT;
