-- ============================================================
-- Migration 004: Enhance search_chunks function
--
-- What this adds and why:
--   * chunk_type and source added to returned columns so citations know WHAT it is (table/diagram/text)
--   * p_course_id is optional (DEFAULT NULL): allows searching all courses belonging to user
--   * similarity is explicitly cast to DOUBLE PRECISION
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS search_chunks(vector, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION search_chunks(
    p_query     VECTOR(384),
    p_user_id   UUID,
    p_course_id UUID DEFAULT NULL,
    p_k         INTEGER DEFAULT 5
)
RETURNS TABLE (
    chunk_id       UUID,
    material_id    UUID,
    material_title VARCHAR,
    page_number    INTEGER,
    content        TEXT,
    chunk_type     VARCHAR,
    source         VARCHAR,
    similarity     DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
    SELECT
        dc.id,
        m.id,
        m.title,
        dc.page_number,
        dc.content,
        dc.chunk_type,
        dc.source,
        (1 - (dc.embedding <=> p_query))::DOUBLE PRECISION AS similarity
    FROM document_chunks dc
    JOIN materials m ON m.id = dc.material_id
    JOIN courses   c ON c.id = m.course_id
    WHERE (p_course_id IS NULL OR c.id = p_course_id)
      AND c.user_id = p_user_id
      AND m.status  = 'ready'
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> p_query
    LIMIT p_k;
$$;

COMMIT;
