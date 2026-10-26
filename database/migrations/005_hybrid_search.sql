-- ============================================================
-- Migration 005: hybrid search (Stage 6)
--
-- What this adds and why:
--   * hybrid_search_chunks()  ONE stored function that searches a student's
--     course two ways and merges the results:
--       1. by MEANING  : pgvector, cosine distance between the question's
--                        vector and every passage's vector
--       2. by KEYWORDS : PostgreSQL full-text search on content_tsv
--       3. merged with Reciprocal Rank Fusion (RRF)
--     Meaning search finds paraphrases ("money disappears" -> Atomicity) but
--     can blur exact terms ("ERROR 1792", "LRU"); keyword search is the
--     opposite. Together they cover each other's blind spots.
--   * search_chunks() (meaning only, from schema v2) is dropped: the new
--     function does the same and more, and one search path is easier to
--     keep correct (and to defend).
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/005_hybrid_search.sql
-- One transaction: if any step fails, nothing is changed.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS search_chunks(vector, uuid, uuid, integer);

-- ------------------------------------------------------------
-- Reciprocal Rank Fusion, in one line:
--     score(passage) = 1/(60 + rank by meaning) + 1/(60 + rank by keywords)
--   (a list the passage isn't in adds 0)
-- Why ranks and not the raw scores? Cosine similarity (0..1) and ts_rank
-- (any positive number) are on different scales and can't be added. Ranks
-- can. 60 is the constant from the original RRF paper: it keeps one list's
-- #1 from drowning everything else, so a passage that is high in BOTH lists
-- beats one that is #1 in only one.
--
-- p_query may be NULL (embedding model not loaded yet): then only the
-- keyword half runs and the search still works.
-- ------------------------------------------------------------
CREATE FUNCTION hybrid_search_chunks(
    p_query       VECTOR(1024),   -- the question as 1024 numbers (or NULL)
    p_query_text  TEXT,           -- the question as typed
    p_user_id     UUID,
    p_course_id   UUID,
    p_k           INTEGER DEFAULT 8,    -- results returned
    p_candidates  INTEGER DEFAULT 20    -- taken from EACH search before merging
)
RETURNS TABLE (
    chunk_id       UUID,
    material_id    UUID,
    material_title VARCHAR,
    page_number    INTEGER,
    chunk_type     VARCHAR,
    source         VARCHAR,
    content        TEXT,
    score          DOUBLE PRECISION,   -- RRF score: higher = better
    meaning_rank   BIGINT,             -- position in the meaning list (NULL = not in it)
    keyword_rank   BIGINT,             -- position in the keyword list (NULL = not in it)
    similarity     DOUBLE PRECISION    -- cosine similarity 0..1 (NULL = not in meaning list)
)
LANGUAGE sql STABLE AS $$
    WITH
    -- Only the student's OWN course, only files that are fully read.
    -- Checked here as well as in the API: a backend bug still can't leak
    -- another student's notes.
    allowed AS (
        SELECT m.id
        FROM materials m
        JOIN courses c ON c.id = m.course_id
        WHERE c.id = p_course_id AND c.user_id = p_user_id AND m.status = 'ready'
    ),

    -- 1. MEANING: the p_candidates passages closest to the question.
    --    Inner query = "ORDER BY distance LIMIT n" (the shape the HNSW index
    --    can serve); row_number() numbers them 1, 2, 3 ... afterwards.
    by_meaning AS (
        SELECT id, distance, row_number() OVER (ORDER BY distance, id) AS rnk
        FROM (
            SELECT dc.id, dc.embedding <=> p_query AS distance
            FROM document_chunks dc
            JOIN allowed a ON a.id = dc.material_id
            WHERE p_query IS NOT NULL AND dc.embedding IS NOT NULL
            ORDER BY dc.embedding <=> p_query
            LIMIT p_candidates
        ) nearest
    ),

    -- 2. KEYWORDS, ranked like a search engine (the IDF idea from BM25).
    --    The question's words are normalised exactly like content_tsv
    --    ("transactions" -> 'transact'; stop words like "what", "the" dropped).
    --    A passage matches if it contains ANY of them (OR, not AND: a typed
    --    question has many words and a passage rarely contains all of them).
    --    Each word is weighted by how RARE it is in this course: "1792" (one
    --    passage) counts far more than "update" (many passages). That rare
    --    word is usually what identifies the right passage.
    --        weight = ln(1 + (N - n + 0.5) / (n + 0.5))
    --        N = passages in the course, n = passages containing the word
    --    Passage score = sum of the weights of the words it contains;
    --    ts_rank_cd (how often/close together) only breaks ties.
    terms AS (
        SELECT DISTINCT lexeme, quote_literal(lexeme)::tsquery AS tq
        FROM unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query_text, '')))) AS lexeme
    ),
    course_size AS (
        SELECT count(*) AS n_all
        FROM document_chunks dc
        JOIN allowed a ON a.id = dc.material_id
    ),
    term_weights AS (
        SELECT t.lexeme, t.tq,
               ln(1 + (cs.n_all - count(dc.id) + 0.5) / (count(dc.id) + 0.5)) AS weight
        FROM terms t
        JOIN document_chunks dc ON dc.content_tsv @@ t.tq      -- GIN index, per word
        JOIN allowed a ON a.id = dc.material_id
        CROSS JOIN course_size cs
        GROUP BY t.lexeme, t.tq, cs.n_all
    ),
    any_word AS (
        SELECT string_agg(lexeme, ' | ')::tsquery AS q FROM (
            SELECT quote_literal(lexeme) AS lexeme FROM term_weights
        ) w
    ),
    by_keywords AS (
        SELECT id, row_number() OVER (ORDER BY weight DESC, tie DESC, id) AS rnk
        FROM (
            SELECT dc.id, sum(tw.weight) AS weight,
                   ts_rank_cd(dc.content_tsv, (SELECT q FROM any_word)) AS tie
            FROM term_weights tw
            JOIN document_chunks dc ON dc.content_tsv @@ tw.tq
            JOIN allowed a ON a.id = dc.material_id
            GROUP BY dc.id, dc.content_tsv
            ORDER BY weight DESC, tie DESC, dc.id
            LIMIT p_candidates
        ) matched
    ),

    -- 3. MERGE. FULL OUTER JOIN keeps passages found by only one search.
    fused AS (
        SELECT
            coalesce(v.id, k.id) AS id,
            coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) AS score,
            v.rnk AS meaning_rank,
            k.rnk AS keyword_rank,
            1 - v.distance AS similarity
        FROM by_meaning v
        FULL OUTER JOIN by_keywords k ON k.id = v.id
    )
    SELECT
        dc.id, m.id, m.title, dc.page_number, dc.chunk_type, dc.source, dc.content,
        f.score, f.meaning_rank, f.keyword_rank, f.similarity
    FROM fused f
    JOIN document_chunks dc ON dc.id = f.id
    JOIN materials m ON m.id = dc.material_id
    ORDER BY f.score DESC, f.meaning_rank NULLS LAST, f.keyword_rank NULLS LAST
    LIMIT p_k;
$$;

COMMIT;
