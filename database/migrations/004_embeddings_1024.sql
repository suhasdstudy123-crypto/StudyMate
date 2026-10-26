-- ============================================================
-- Migration 004: embeddings with Qwen3-Embedding-0.6B (Stage 6)
--
-- What this changes and why:
--   * document_chunks.embedding   VECTOR(384) -> VECTOR(1024)
--       The chosen model (Qwen/Qwen3-Embedding-0.6B) outputs 1024 numbers
--       per passage. A VECTOR column has ONE fixed size, so it must match.
--   * document_chunks.embedding_model (new)
--       Which model made each vector. Vectors from different models live in
--       different "meaning spaces" and must never be compared, so if the
--       model ever changes, the backend re-embeds exactly the rows made by
--       the old one.
--   * CHECK: a vector and its model name are set together or not at all.
--   * idx_chunks_needs_embedding (new, partial index)
--       The embedding worker's to-do list: only passages without a vector.
--   * idx_chunks_embedding (HNSW) rebuilt for the new size.
--   * search_chunks() now documents a 1024-number question vector.
--
-- Existing passages keep their text; their (still empty) vectors are
-- reset to NULL and get filled by the backend's embedding step.
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/004_embeddings_1024.sql
-- One transaction: if any step fails, nothing is changed.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Drop the old HNSW index: an index is built for ONE vector size.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_chunks_embedding;

-- ------------------------------------------------------------
-- 2. New vector size. USING NULL: a 384-number vector can't be turned into
--    a 1024-number one (and it would come from a different model anyway),
--    so any old value is cleared. Today every value is NULL already.
-- ------------------------------------------------------------
ALTER TABLE document_chunks
    ALTER COLUMN embedding TYPE VECTOR(1024) USING NULL;

-- ------------------------------------------------------------
-- 3. Which model made the vector, e.g. 'Qwen/Qwen3-Embedding-0.6B'.
-- ------------------------------------------------------------
ALTER TABLE document_chunks
    ADD COLUMN embedding_model VARCHAR(100);

ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_embedding_model_check
    CHECK ((embedding IS NULL) = (embedding_model IS NULL));

-- ------------------------------------------------------------
-- 4. Indexes
-- ------------------------------------------------------------
-- Semantic search: HNSW graph over the new 1024-number vectors.
CREATE INDEX idx_chunks_embedding ON document_chunks
    USING hnsw (embedding vector_cosine_ops);

-- The embedding worker's to-do list. Partial index = only rows still
-- WITHOUT a vector are in it, so it stays tiny once everything is embedded.
CREATE INDEX idx_chunks_needs_embedding ON document_chunks (material_id)
    WHERE embedding IS NULL;

-- ------------------------------------------------------------
-- 5. search_chunks(): same logic, question vector now 1024 numbers.
--    (PostgreSQL ignores the size inside a function's parameter type,
--    so this is documentation; a wrong-size vector still fails loudly
--    with "different vector dimensions" when compared.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_chunks(
    p_query     VECTOR(1024),
    p_user_id   UUID,
    p_course_id UUID,
    p_k         INTEGER DEFAULT 5
)
RETURNS TABLE (
    chunk_id       UUID,
    material_id    UUID,
    material_title VARCHAR,
    page_number    INTEGER,
    content        TEXT,
    similarity     DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
    SELECT
        dc.id,
        m.id,
        m.title,
        dc.page_number,
        dc.content,
        1 - (dc.embedding <=> p_query)
    FROM document_chunks dc
    JOIN materials m ON m.id = dc.material_id
    JOIN courses   c ON c.id = m.course_id
    WHERE c.id      = p_course_id
      AND c.user_id = p_user_id
      AND m.status  = 'ready'
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> p_query
    LIMIT p_k;
$$;

COMMIT;
