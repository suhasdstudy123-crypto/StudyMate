-- ============================================================
-- Migration 003: reading pages as images (Stage 5b)
--
-- What this adds and why:
--   * materials.processing_mode  -> 'smart' (only pages with pictures go to
--                                   the image reader) or 'thorough' (every page)
--   * document_pages.vision_*    -> each page's own image-reading status, so
--                                   one failed page can be retried alone
--                                   instead of re-reading the whole PDF
--   * document_pages.image_path  -> where the page's picture is saved, so a
--                                   citation can show the original slide
--   * document_chunks.source     -> HOW a passage was read: 'pdf_text' (exact,
--                                   from the PDF's text layer) or 'vision'
--                                   (written by the image reader: check it)
--   * chunk_type 'diagram'       -> WHAT a passage is: text, table, or a
--                                   description of a diagram
--   * material_overview VIEW     -> + mode and image-reading counts
--
-- Existing files: their picture pages are queued ('pending'), so the image
-- reader will pick them up once it exists. Nothing is deleted.
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/003_vision_reading.sql
-- One transaction: if any step fails, nothing is changed.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Smart or Thorough, chosen per upload
-- ------------------------------------------------------------
ALTER TABLE materials
    ADD COLUMN processing_mode VARCHAR(10) NOT NULL DEFAULT 'smart';

ALTER TABLE materials
    ADD CONSTRAINT materials_mode_check CHECK (processing_mode IN ('smart', 'thorough'));


-- ------------------------------------------------------------
-- 2. Image reading, page by page
--
-- vision_status is a small state machine:
--     none        the page doesn't need the image reader
--     pending     waiting in the queue
--     processing  being read right now
--     done        read; its passages are stored
--     failed      gave up after retries; vision_error says why
--
-- needs_vision (from 5a) says "this page HAS pictures".
-- vision_status says "what the image reader has DONE with it".
-- They are different facts: in Thorough mode a plain-text page also gets
-- read (needs_vision = false, vision_status = 'done').
-- ------------------------------------------------------------
ALTER TABLE document_pages
    ADD COLUMN vision_status   VARCHAR(10)  NOT NULL DEFAULT 'none',
    ADD COLUMN vision_attempts INTEGER      NOT NULL DEFAULT 0,  -- for retrying with a limit
    ADD COLUMN vision_error    TEXT,
    ADD COLUMN vision_model    VARCHAR(100),  -- which model read it (e.g. gemini-3.8-flash)
    ADD COLUMN image_path      TEXT;          -- relative path of the saved page picture

ALTER TABLE document_pages
    ADD CONSTRAINT document_pages_vision_status_check
        CHECK (vision_status IN ('none', 'pending', 'processing', 'done', 'failed')),
    ADD CONSTRAINT document_pages_vision_attempts_check
        CHECK (vision_attempts >= 0),
    -- Same rule as materials: a failure must say why, so the UI can show it.
    ADD CONSTRAINT document_pages_vision_failed_has_error
        CHECK (vision_status <> 'failed' OR vision_error IS NOT NULL);

-- The worker's question: "which pages are waiting to be read?"
-- A PARTIAL index holds only the waiting/active pages, so it stays tiny
-- even when thousands of pages are done.
CREATE INDEX idx_pages_vision_queue
    ON document_pages (material_id, page_number)
    WHERE vision_status IN ('pending', 'processing');

-- Queue the picture pages of files that were already read in Stage 5a.
UPDATE document_pages
   SET vision_status = 'pending'
 WHERE needs_vision;


-- ------------------------------------------------------------
-- 3. What a passage is, and how it was read
--
-- Two separate columns because they are two separate facts:
--     chunk_type = WHAT it is   (text / table / diagram)
--     source     = HOW we got it (pdf_text = exact / vision = written by AI)
-- A table can come from either reader, so one combined column
-- ('vision_table', 'pdf_table', ...) would repeat itself.
-- The UI uses source to label "Read from an image - check it".
-- ------------------------------------------------------------
ALTER TABLE document_chunks
    DROP CONSTRAINT document_chunks_type_check;

ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_type_check CHECK (chunk_type IN ('text', 'table', 'diagram'));

ALTER TABLE document_chunks
    ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'pdf_text';

ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_source_check CHECK (source IN ('pdf_text', 'vision'));


-- ------------------------------------------------------------
-- 4. material_overview: + mode and image-reading progress
-- CREATE OR REPLACE VIEW may only ADD columns at the END of a view,
-- so the new ones go after vision_page_count.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW material_overview AS
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
      WHERE dp.material_id = m.id AND dp.needs_vision)         AS vision_page_count,
    m.processing_mode,
    v.vision_waiting_count,
    v.vision_done_count,
    v.vision_failed_count
FROM materials m
JOIN courses c ON c.id = m.course_id
-- LATERAL = a subquery that runs once per material row and can use m.id.
-- It reads the file's pages ONCE and counts them three ways with FILTER.
-- An aggregate with no GROUP BY always returns exactly one row (zeros
-- for a file with no pages yet), so no material is lost by the join.
CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE dp.vision_status IN ('pending', 'processing')) AS vision_waiting_count,
           count(*) FILTER (WHERE dp.vision_status = 'done')                     AS vision_done_count,
           count(*) FILTER (WHERE dp.vision_status = 'failed')                   AS vision_failed_count
      FROM document_pages dp
     WHERE dp.material_id = m.id
) v;

COMMIT;
