-- ============================================================
-- StudyMate Database Schema (v2)
--
-- Run with:
--   psql -U postgres -p 5433 -d studymate -f database/schema.sql
--
-- Design summary
--   users ─┬─< courses ──< materials ──< document_chunks
--          └─< chat_sessions ──< chat_messages ──< message_sources >── document_chunks
--
--   * Each student owns PRIVATE courses and materials.
--   * Admin is a platform role (manage users, moderate content, view stats).
--   * document_chunks holds both the text (for full-text search) and its
--     embedding vector (for semantic search with pgvector).
-- ============================================================


-- ============================================================
-- 0. DEV RESET
-- Drops everything this file creates, so the file can be re-run
-- while we iterate on the design. Order: dependents first.
-- (Never run this against a database with real user data.)
-- ============================================================

DROP VIEW     IF EXISTS admin_model_usage;
DROP VIEW     IF EXISTS admin_chat_daily;
DROP VIEW     IF EXISTS admin_user_stats;
DROP VIEW     IF EXISTS admin_overview;
DROP VIEW     IF EXISTS material_overview;
DROP VIEW     IF EXISTS user_overview;
DROP VIEW     IF EXISTS course_overview;
DROP FUNCTION IF EXISTS hybrid_search_chunks(vector, text, uuid, uuid, integer, integer);
DROP TABLE    IF EXISTS message_sources  CASCADE;
DROP TABLE    IF EXISTS chat_messages    CASCADE;
DROP TABLE    IF EXISTS chat_sessions    CASCADE;
DROP TABLE    IF EXISTS document_chunks  CASCADE;
DROP TABLE    IF EXISTS document_pages   CASCADE;
DROP TABLE    IF EXISTS materials        CASCADE;
DROP TABLE    IF EXISTS courses          CASCADE;
DROP TABLE    IF EXISTS users            CASCADE;
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS touch_chat_session();
DROP FUNCTION IF EXISTS set_processing_times();
DROP FUNCTION IF EXISTS delete_empty_chat_sessions(interval);


-- ============================================================
-- EXTENSIONS
-- vector: adds the VECTOR column type, distance operators (<=>)
--         and vector indexes (HNSW). This is what makes PostgreSQL
--         our vector database.
-- (gen_random_uuid() is built into PostgreSQL 13+, so the
--  pgcrypto extension from v1 is no longer needed.)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;


-- ============================================================
-- 1. USERS
-- One row per account. Passwords are NEVER stored, only a
-- one-way hash (Argon2/bcrypt) produced by the backend.
-- ============================================================

CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash TEXT         NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'student',
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT users_email_unique     UNIQUE (email),
    -- Emails are stored lowercase so Test@x.com and test@x.com
    -- can't become two different accounts.
    CONSTRAINT users_email_lowercase  CHECK (email = lower(email)),
    CONSTRAINT users_email_format     CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_name_not_blank   CHECK (length(trim(name)) > 0),
    CONSTRAINT users_role_check       CHECK (role IN ('student', 'admin'))
);


-- ============================================================
-- 2. COURSES
-- A student's private folder of study material, e.g. "DBMS".
-- ============================================================

CREATE TABLE courses (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    code        VARCHAR(50),
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT courses_name_not_blank CHECK (length(trim(name)) > 0)
);

-- A student can't have two courses with the same name, ignoring case:
-- "DBMS" and "dbms" count as the same course. A plain UNIQUE (user_id, name)
-- would allow both, so this is a unique index on an EXPRESSION, lower(name).
-- (Added by migrations/001_course_names_case_insensitive.sql.)
CREATE UNIQUE INDEX courses_user_lower_name_unique ON courses (user_id, lower(name));


-- ============================================================
-- 3. MATERIALS
-- One uploaded file (a PDF of notes, slides, PYQs...).
-- status tracks the processing pipeline:
--   pending -> processing -> ready   (searchable)
--                        \-> failed  (error_message says why)
-- ============================================================

CREATE TABLE materials (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id         UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title             VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_path       TEXT         NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    file_size         BIGINT       NOT NULL,
    content_hash      CHAR(64)     NOT NULL,   -- SHA-256 of the file bytes
    page_count        INTEGER,
    pages_processed   INTEGER      NOT NULL DEFAULT 0,  -- progress bar: "page 12 of 40"
    status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
    error_message     TEXT,
    -- 'smart' = only pages with pictures go to the image reader (5b);
    -- 'thorough' = every page does (added by migrations/003)
    processing_mode   VARCHAR(10)  NOT NULL DEFAULT 'smart',
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Set by trg_materials_processing_times when status changes (migrations/007):
    -- started = 'processing', finished = 'ready'/'failed'. Admin stats only.
    processing_started_at  TIMESTAMPTZ,
    processing_finished_at TIMESTAMPTZ,

    -- Same file uploaded twice to the same course is rejected,
    -- otherwise search results would contain every chunk twice.
    CONSTRAINT materials_course_hash_unique UNIQUE (course_id, content_hash),
    CONSTRAINT materials_title_not_blank    CHECK (length(trim(title)) > 0),
    CONSTRAINT materials_mime_check         CHECK (mime_type IN ('application/pdf')),
    CONSTRAINT materials_file_size_check    CHECK (file_size > 0),
    CONSTRAINT materials_page_count_check   CHECK (page_count IS NULL OR page_count > 0),
    CONSTRAINT materials_pages_processed_check
        CHECK (pages_processed >= 0 AND (page_count IS NULL OR pages_processed <= page_count)),
    CONSTRAINT materials_status_check       CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    -- A failed upload must say why, so the UI can show the reason.
    CONSTRAINT materials_failed_has_error   CHECK (status <> 'failed' OR error_message IS NOT NULL),
    CONSTRAINT materials_mode_check         CHECK (processing_mode IN ('smart', 'thorough')),
    -- A CHECK passes when the result is NULL, so "not finished yet" is fine.
    CONSTRAINT materials_processing_times_check
        CHECK (processing_finished_at >= processing_started_at)
);


-- ============================================================
-- 3b. DOCUMENT PAGES  (added by migrations/002)
-- One row per PDF page: what was found on it, and whether text
-- extraction alone can't capture it (images, diagrams, formulas,
-- scanned pages) so the image reader (Stage 5b) must look at it.
-- Primary key = the PAIR (material_id, page_number).
-- ============================================================

CREATE TABLE document_pages (
    material_id        UUID        NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    page_number        INTEGER     NOT NULL,
    char_count         INTEGER     NOT NULL DEFAULT 0,  -- characters of real text found
    table_count        INTEGER     NOT NULL DEFAULT 0,
    image_count        INTEGER     NOT NULL DEFAULT 0,  -- embedded pictures / scans
    drawing_count      INTEGER     NOT NULL DEFAULT 0,  -- vector shapes outside tables (diagrams)
    math_symbol_count  INTEGER     NOT NULL DEFAULT 0,  -- symbols like ∑ ∫ ≤ θ (formulas)
    needs_vision       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Image reading of this page (added by migrations/003):
    --   none -> not needed; pending -> processing -> done | failed
    vision_status      VARCHAR(10) NOT NULL DEFAULT 'none',
    vision_attempts    INTEGER     NOT NULL DEFAULT 0,
    vision_error       TEXT,
    vision_model       VARCHAR(100),  -- which model read it
    image_path         TEXT,          -- saved page picture (relative path), for citations

    PRIMARY KEY (material_id, page_number),
    CONSTRAINT document_pages_page_check   CHECK (page_number > 0),
    CONSTRAINT document_pages_counts_check CHECK (
        char_count >= 0 AND table_count >= 0 AND image_count >= 0
        AND drawing_count >= 0 AND math_symbol_count >= 0
    ),
    CONSTRAINT document_pages_vision_status_check
        CHECK (vision_status IN ('none', 'pending', 'processing', 'done', 'failed')),
    CONSTRAINT document_pages_vision_attempts_check
        CHECK (vision_attempts >= 0),
    CONSTRAINT document_pages_vision_failed_has_error
        CHECK (vision_status <> 'failed' OR vision_error IS NOT NULL)
);


-- ============================================================
-- 4. DOCUMENT CHUNKS
-- A material's text split into small pieces. Each chunk is the
-- unit of retrieval: search returns chunks, the LLM reads chunks,
-- and citations point at a chunk's page.
-- ============================================================

CREATE TABLE document_chunks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID        NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    chunk_index INTEGER     NOT NULL,   -- order of the chunk inside the file
    page_number INTEGER     NOT NULL,   -- page the chunk starts on (for citations)
    content     TEXT        NOT NULL,
    token_count INTEGER,
    -- WHAT it is: 'text' = prose; 'table' = one whole table as markdown;
    -- 'diagram' = a description of a diagram (from the image reader)
    chunk_type  VARCHAR(10) NOT NULL DEFAULT 'text',

    -- Semantic meaning of `content`, produced by the embedding model.
    -- 1024 = output size of Qwen/Qwen3-Embedding-0.6B (migrations/004).
    -- NULL until the embedding step has run for this chunk.
    embedding   VECTOR(1024),

    -- Keyword-search version of `content`, maintained automatically by
    -- PostgreSQL (GENERATED ... STORED): words are normalised, so
    -- "normalization" also matches "normalized" / "normalize".
    content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- HOW it was read: 'pdf_text' = exact, from the PDF's text layer;
    -- 'vision' = written by the image reader (added by migrations/003)
    source      VARCHAR(10) NOT NULL DEFAULT 'pdf_text',
    -- WHICH model made `embedding` (added by migrations/004). Vectors from
    -- different models can't be compared, so a model change re-embeds
    -- exactly the rows made by the old one.
    embedding_model VARCHAR(100),

    CONSTRAINT document_chunks_unique_index  UNIQUE (material_id, chunk_index),
    CONSTRAINT document_chunks_index_check   CHECK (chunk_index >= 0),
    CONSTRAINT document_chunks_page_check    CHECK (page_number > 0),
    CONSTRAINT document_chunks_content_check CHECK (length(trim(content)) > 0),
    CONSTRAINT document_chunks_tokens_check  CHECK (token_count IS NULL OR token_count > 0),
    CONSTRAINT document_chunks_type_check    CHECK (chunk_type IN ('text', 'table', 'diagram')),
    CONSTRAINT document_chunks_source_check  CHECK (source IN ('pdf_text', 'vision')),
    -- A vector and its model name are set together or not at all.
    CONSTRAINT document_chunks_embedding_model_check
        CHECK ((embedding IS NULL) = (embedding_model IS NULL)),
    -- COMPOSITE foreign key: the chunk's (file, page) pair must be a real page.
    CONSTRAINT document_chunks_page_fk FOREIGN KEY (material_id, page_number)
        REFERENCES document_pages(material_id, page_number) ON DELETE CASCADE
);


-- ============================================================
-- 5. CHAT SESSIONS
-- One conversation. Optionally tied to a course, which limits
-- retrieval to that course's material.
-- ============================================================

CREATE TABLE chat_sessions (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- If the course is deleted, keep the chat history but unlink it.
    course_id  UUID         REFERENCES courses(id) ON DELETE SET NULL,
    title      VARCHAR(255),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ============================================================
-- 6. CHAT MESSAGES
-- Each question (role = 'user') and answer (role = 'assistant').
-- A question and its answer are saved in ONE transaction (migration 006).
-- ============================================================

CREATE TABLE chat_messages (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID         NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role          VARCHAR(20)  NOT NULL,
    content       TEXT         NOT NULL,
    -- clock_timestamp(), not now(): now() is the time the TRANSACTION began,
    -- so a question and its answer saved together would get the same time.
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    -- Answers only: answered | not_in_notes (honest refusal) | stopped (by the student)
    status        VARCHAR(20),
    model         VARCHAR(100),             -- which Gemini model wrote the answer
    search_query  TEXT,                     -- questions only: rewritten follow-up we searched with
    prompt_tokens INTEGER,                  -- answers only: what the answer cost
    output_tokens INTEGER,

    CONSTRAINT chat_messages_role_check    CHECK (role IN ('user', 'assistant')),
    CONSTRAINT chat_messages_content_check CHECK (length(trim(content)) > 0),
    CONSTRAINT chat_messages_status_check  CHECK (status IN ('answered', 'not_in_notes', 'stopped')),
    -- Which columns belong to which role.
    CONSTRAINT chat_messages_role_fields_check CHECK (
        (role = 'user'
            AND status IS NULL AND model IS NULL
            AND prompt_tokens IS NULL AND output_tokens IS NULL)
        OR
        (role = 'assistant'
            AND status IS NOT NULL AND search_query IS NULL)
    ),
    CONSTRAINT chat_messages_tokens_check CHECK (
        (prompt_tokens IS NULL OR prompt_tokens >= 0)
        AND (output_tokens IS NULL OR output_tokens >= 0)
    )
);


-- ============================================================
-- 7. MESSAGE SOURCES
-- Which chunks an answer was based on (the citations).
-- A many-to-many link between chat_messages and document_chunks,
-- so its primary key is the PAIR (message_id, chunk_id).
-- Every passage SHOWN to the model is stored; rank = its number [n]
-- in the prompt; cited = the answer actually referenced it.
-- ============================================================

CREATE TABLE message_sources (
    message_id       UUID             NOT NULL REFERENCES chat_messages(id)   ON DELETE CASCADE,
    chunk_id         UUID             NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    rank             SMALLINT         NOT NULL,   -- 1 = most relevant = [1] in the answer
    similarity_score DOUBLE PRECISION,
    cited            BOOLEAN          NOT NULL DEFAULT false,

    PRIMARY KEY (message_id, chunk_id),
    CONSTRAINT message_sources_rank_unique UNIQUE (message_id, rank),
    CONSTRAINT message_sources_rank_check  CHECK (rank >= 1)
);


-- ============================================================
-- INDEXES
-- PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically,
-- but NOT foreign keys. Every "show me X's courses / Y's chunks"
-- query filters on a foreign key, so each gets a B-tree index.
-- (courses.user_id and document_chunks.material_id are already
--  covered by the leading column of their UNIQUE constraint/index.)
-- ============================================================

CREATE INDEX idx_materials_course_id      ON materials(course_id);
-- "My chats, most recent first": WHERE user_id = ? ORDER BY updated_at DESC.
CREATE INDEX idx_chat_sessions_user_recent ON chat_sessions(user_id, updated_at DESC);
CREATE INDEX idx_chat_sessions_course_id  ON chat_sessions(course_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id, created_at);
CREATE INDEX idx_message_sources_chunk_id ON message_sources(chunk_id);
-- Supports the chunk -> page foreign key and "chunks of page N".
CREATE INDEX idx_chunks_material_page     ON document_chunks(material_id, page_number);

-- Partial index: only rows WHERE needs_vision are in it, so it stays tiny
-- and "which pages of this file need the image reader?" is fast (5b).
CREATE INDEX idx_pages_needs_vision ON document_pages(material_id) WHERE needs_vision;
-- The image reader's queue: only waiting/active pages are in it (migrations/003).
CREATE INDEX idx_pages_vision_queue
    ON document_pages (material_id, page_number)
    WHERE vision_status IN ('pending', 'processing');

-- Full-text search: GIN ("generalized inverted index") maps each
-- word to the chunks containing it, like the index at the back of a book.
CREATE INDEX idx_chunks_content_tsv ON document_chunks USING GIN (content_tsv);

-- Semantic search: HNSW builds a navigable graph of vectors so the
-- nearest chunks are found without comparing against every row.
-- vector_cosine_ops = we measure closeness with cosine distance (<=>).
CREATE INDEX idx_chunks_embedding ON document_chunks
    USING hnsw (embedding vector_cosine_ops);

-- The embedding worker's to-do list: partial index with only the passages
-- that have no vector yet, so it stays tiny (migrations/004).
CREATE INDEX idx_chunks_needs_embedding ON document_chunks (material_id)
    WHERE embedding IS NULL;


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Keeps updated_at correct on every UPDATE, whoever performs it.
-- (v1 relied on application code, which forgot or set it to NULL.)
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at         BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_courses_updated_at       BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_materials_updated_at     BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A new message means the conversation was just active, so bump the
-- session's updated_at. "Recent chats" is sorted by this column.
CREATE FUNCTION touch_chat_session() RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_messages_touch_session AFTER INSERT ON chat_messages
    FOR EACH ROW EXECUTE FUNCTION touch_chat_session();

-- Processing timestamps for the admin stats (migrations/007).
-- clock_timestamp(), not now(): the worker marks a file 'ready' in the SAME
-- transaction that inserted all its pages, which began right after the file
-- was claimed. now() = transaction start, so every file would "finish" in
-- about 0 seconds. clock_timestamp() = the real moment of this UPDATE.
CREATE FUNCTION set_processing_times() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'processing' THEN
            NEW.processing_started_at  := clock_timestamp();
            NEW.processing_finished_at := NULL;
        ELSIF NEW.status IN ('ready', 'failed') THEN
            NEW.processing_finished_at := clock_timestamp();
        ELSIF NEW.status = 'pending' THEN          -- retry / requeue after restart
            NEW.processing_started_at  := NULL;
            NEW.processing_finished_at := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- "UPDATE OF status": fires only when an UPDATE sets the status column,
-- not on every progress tick (pages_processed) or rename.
CREATE TRIGGER trg_materials_processing_times
    BEFORE UPDATE OF status ON materials
    FOR EACH ROW EXECUTE FUNCTION set_processing_times();


-- ============================================================
-- VIEWS
-- A view is a saved SELECT that can be queried like a table.
-- ============================================================

-- Dashboard / "My Courses" cards: one row per course with counts.
-- LEFT JOIN keeps courses that have no materials yet (count 0).
CREATE VIEW course_overview AS
SELECT
    c.id,
    c.user_id,
    c.name,
    c.code,
    c.description,
    c.created_at,
    COUNT(DISTINCT m.id)                                    AS material_count,
    COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'ready')  AS ready_material_count,
    COUNT(dc.id)                                            AS chunk_count,
    GREATEST(c.updated_at, MAX(m.updated_at))               AS last_activity
FROM courses c
LEFT JOIN materials       m  ON m.course_id    = c.id
LEFT JOIN document_chunks dc ON dc.material_id = m.id
GROUP BY c.id;

-- ---- Admin dashboard (migrations/007) ----------------------------
-- The admin sees how StudyMate is USED, never WHAT students study:
-- only account metadata, counts, statuses, models, tokens, timestamps.
-- No note text, passages, questions, answers, chat titles (= first
-- question), course names, file titles or file names.

-- One row for the whole platform. Each part reads its own table once and
-- counts it several ways with FILTER (one scan instead of one query per number).
CREATE VIEW admin_overview AS
SELECT
    u.users_total, u.students, u.admins, u.inactive_users,
    f.files_total, f.files_ready, f.files_processing, f.files_pending, f.files_failed,
    f.files_smart, f.files_thorough,
    f.avg_processing_seconds, f.median_processing_seconds, f.avg_seconds_per_page,
    f.files_timed,
    p.pages_total, p.pages_needing_pictures, p.pages_read_from_pictures,
    p.pages_picture_failed, p.pages_picture_waiting,
    k.passages_total, k.passages_embedded, k.passages_from_pictures,
    c.chats_total, c.chats_empty, c.questions_total
FROM
    (SELECT count(*)                                AS users_total,
            count(*) FILTER (WHERE role = 'student') AS students,
            count(*) FILTER (WHERE role = 'admin')   AS admins,
            count(*) FILTER (WHERE NOT is_active)    AS inactive_users
       FROM users) u,
    (SELECT count(*)                                         AS files_total,
            count(*) FILTER (WHERE status = 'ready')          AS files_ready,
            count(*) FILTER (WHERE status = 'processing')     AS files_processing,
            count(*) FILTER (WHERE status = 'pending')        AS files_pending,
            count(*) FILTER (WHERE status = 'failed')         AS files_failed,
            count(*) FILTER (WHERE processing_mode = 'smart')    AS files_smart,
            count(*) FILTER (WHERE processing_mode = 'thorough') AS files_thorough,
            -- Text pass only (upload -> searchable text). Picture reading and
            -- embeddings run afterwards in their own workers.
            round(avg(extract(epoch FROM processing_finished_at - processing_started_at))
                  FILTER (WHERE status = 'ready')::numeric, 1)             AS avg_processing_seconds,
            -- Median: one huge PDF can't drag it up the way it drags the average.
            round((percentile_cont(0.5) WITHIN GROUP (
                     ORDER BY extract(epoch FROM processing_finished_at - processing_started_at))
                  FILTER (WHERE status = 'ready'))::numeric, 1)            AS median_processing_seconds,
            round((sum(extract(epoch FROM processing_finished_at - processing_started_at))
                     FILTER (WHERE status = 'ready')
                  / nullif(sum(page_count) FILTER (WHERE status = 'ready'
                       AND processing_finished_at IS NOT NULL), 0))::numeric, 2) AS avg_seconds_per_page,
            count(*) FILTER (WHERE status = 'ready'
                               AND processing_finished_at IS NOT NULL)     AS files_timed
       FROM materials) f,
    (SELECT count(*)                                                     AS pages_total,
            count(*) FILTER (WHERE vision_status <> 'none')               AS pages_needing_pictures,
            count(*) FILTER (WHERE vision_status = 'done')                AS pages_read_from_pictures,
            count(*) FILTER (WHERE vision_status = 'failed')              AS pages_picture_failed,
            count(*) FILTER (WHERE vision_status IN ('pending', 'processing')) AS pages_picture_waiting
       FROM document_pages) p,
    (SELECT count(*)                                         AS passages_total,
            count(*) FILTER (WHERE embedding_model IS NOT NULL) AS passages_embedded,
            count(*) FILTER (WHERE source = 'vision')         AS passages_from_pictures
       FROM document_chunks) k,
    (SELECT count(*)                                         AS chats_total,
            count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM chat_messages m WHERE m.session_id = s.id)) AS chats_empty,
            (SELECT count(*) FROM chat_messages WHERE role = 'user')     AS questions_total
       FROM chat_sessions s) c;

-- One row per user. Each table is counted ONCE, grouped by user, and the
-- per-user totals are LEFT JOINed to users (LEFT: a user with no courses or
-- chats still appears, with 0 via coalesce).
-- Why not one big join? courses x files x messages would MULTIPLY the rows
-- (2 courses x 3 files x 40 messages = 240 rows) and inflate every count.
-- Why not a LATERAL subquery per user? Measured: it re-read all messages once
-- PER USER (60 users x 38k messages = 2.2M rows, ~140-300 ms); grouping
-- first reads each table once.
CREATE VIEW admin_user_stats AS
SELECT
    u.id, u.name, u.email, u.role, u.is_active,
    u.created_at                       AS joined_at,
    coalesce(c.course_count, 0)        AS course_count,
    coalesce(f.file_count, 0)          AS file_count,
    coalesce(f.pages_total, 0)         AS pages_total,
    coalesce(q.chat_count, 0)          AS chat_count,
    coalesce(q.question_count, 0)      AS question_count,
    coalesce(q.not_in_notes_count, 0)  AS not_in_notes_count,
    q.last_question_at
FROM users u
LEFT JOIN (
    SELECT user_id, count(*) AS course_count
      FROM courses GROUP BY user_id
) c ON c.user_id = u.id
LEFT JOIN (
    SELECT c.user_id, count(*) AS file_count, sum(m.page_count) AS pages_total
      FROM materials m JOIN courses c ON c.id = m.course_id
     GROUP BY c.user_id
) f ON f.user_id = u.id
LEFT JOIN (
    -- The inner JOIN drops chats with no messages, so empty chats don't count.
    SELECT s.user_id,
           count(DISTINCT s.id)                                AS chat_count,
           count(*) FILTER (WHERE m.role = 'user')              AS question_count,
           count(*) FILTER (WHERE m.status = 'not_in_notes')    AS not_in_notes_count,
           max(m.created_at) FILTER (WHERE m.role = 'user')     AS last_question_at
      FROM chat_sessions s JOIN chat_messages m ON m.session_id = s.id
     GROUP BY s.user_id
) q ON q.user_id = u.id;

-- One row per day that had chat activity. Days are Indian days (IST):
-- date_trunc on a TIMESTAMPTZ uses the CONNECTION's TimeZone setting, so
-- the same view could split days differently on another server. Converting
-- with AT TIME ZONE first fixes the day boundary to midnight IST.
-- Days with no activity are filled in by the API (generate_series).
CREATE VIEW admin_chat_daily AS
SELECT
    (m.created_at AT TIME ZONE 'Asia/Kolkata')::date               AS day,
    count(*) FILTER (WHERE m.role = 'user')                         AS questions,
    count(*) FILTER (WHERE m.status = 'answered')                   AS answered,
    count(*) FILTER (WHERE m.status = 'not_in_notes')               AS not_in_notes,
    count(*) FILTER (WHERE m.status = 'stopped')                    AS stopped,
    count(DISTINCT s.user_id)                                       AS active_users,
    coalesce(sum(m.prompt_tokens), 0)                               AS prompt_tokens,
    coalesce(sum(m.output_tokens), 0)                               AS output_tokens
FROM chat_messages m
JOIN chat_sessions s ON s.id = m.session_id
GROUP BY 1;

-- One row per Gemini model. The picture reader and the chat share ONE rate
-- limiter per model, so the admin sees both uses of each model side by side.
-- UNION ALL stacks the two sources; GROUP BY folds them into one row per model.
-- (Answers with no model = no passages found, so Gemini wasn't asked.)
CREATE VIEW admin_model_usage AS
SELECT
    model,
    sum(pages_read)                       AS pages_read,
    sum(answers)                          AS answers,
    sum(not_in_notes)                     AS not_in_notes,
    sum(prompt_tokens)                    AS prompt_tokens,
    sum(output_tokens)                    AS output_tokens,
    round(sum(output_tokens)::numeric / nullif(sum(answers), 0), 0) AS avg_output_tokens
FROM (
    SELECT vision_model AS model, count(*) AS pages_read, 0 AS answers, 0 AS not_in_notes,
           0 AS prompt_tokens, 0 AS output_tokens
      FROM document_pages
     WHERE vision_status = 'done' AND vision_model IS NOT NULL
     GROUP BY vision_model
    UNION ALL
    SELECT model, 0, count(*), count(*) FILTER (WHERE status = 'not_in_notes'),
           coalesce(sum(prompt_tokens), 0), coalesce(sum(output_tokens), 0)
      FROM chat_messages
     WHERE role = 'assistant' AND model IS NOT NULL
     GROUP BY model
) uses
GROUP BY model;


-- Course page: one row per file with its counts (added by migrations/002).
-- Each count is its own subquery so they don't multiply each other.
-- user_id comes from the course, so the API can filter "my files only".
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
      WHERE dp.material_id = m.id AND dp.needs_vision)         AS vision_page_count,
    m.processing_mode,
    v.vision_waiting_count,
    v.vision_done_count,
    v.vision_failed_count
FROM materials m
JOIN courses c ON c.id = m.course_id
-- Image-reading progress (migrations/003): LATERAL runs once per material,
-- reads its pages once and counts them three ways with FILTER.
CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE dp.vision_status IN ('pending', 'processing')) AS vision_waiting_count,
           count(*) FILTER (WHERE dp.vision_status = 'done')                     AS vision_done_count,
           count(*) FILTER (WHERE dp.vision_status = 'failed')                   AS vision_failed_count
      FROM document_pages dp
     WHERE dp.material_id = m.id
) v;


-- ============================================================
-- STORED FUNCTION: hybrid search (migrations/005)
-- Searches ONE course of ONE user by meaning (pgvector) AND by keywords
-- (full-text), and merges both lists with Reciprocal Rank Fusion.
-- ============================================================

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


-- ============================================================
-- STORED FUNCTION: empty-chat cleanup (migrations/007)
-- ============================================================

-- A chat is created when its first question is sent; question + answer are
-- saved only when the answer finishes. If that first answer fails (or is
-- stopped before any text), the chat stays empty. The chat list already
-- hides them; this deletes them. Called at backend start and by the admin.
--
-- Only chats OLDER than p_older_than: a chat created seconds ago may still be
-- streaming its first answer. Deleting it then would make the final save fail
-- (its session_id would point at a deleted row -> foreign-key error).
-- Answers time out after 90 s, so 1 hour is a wide safety margin.
--
-- Returns how many were deleted. DELETE ... RETURNING inside a CTE lets one
-- SQL statement delete AND count. It runs with the CALLER's rights, so the
-- read-only admin role can't use it (it has no DELETE on chat_sessions).
CREATE FUNCTION delete_empty_chat_sessions(p_older_than INTERVAL DEFAULT '1 hour')
RETURNS INTEGER
LANGUAGE sql AS $$
    WITH gone AS (
        DELETE FROM chat_sessions s
         WHERE s.created_at < now() - p_older_than
           AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id)
        RETURNING 1
    )
    SELECT count(*)::integer FROM gone;
$$;


-- ============================================================
-- ROLE: read-only access for admin routes (migrations/007)
-- Admin routes run SET LOCAL ROLE studymate_admin_reader, which may
-- SELECT the four admin views and nothing else. A view runs with its
-- OWNER's rights, so the counts work without any right on the tables.
-- ============================================================

-- Roles belong to the whole PostgreSQL server, not one database, and
-- CREATE ROLE has no IF NOT EXISTS, hence the DO block.
-- NOLOGIN: nobody connects as it; the app switches to it inside a transaction.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studymate_admin_reader') THEN
        CREATE ROLE studymate_admin_reader NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO studymate_admin_reader;
GRANT SELECT ON admin_overview, admin_user_stats, admin_chat_daily, admin_model_usage
    TO studymate_admin_reader;
-- Nothing else is granted: no table, no other view, no function.
