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

DROP VIEW     IF EXISTS material_overview;
DROP VIEW     IF EXISTS user_overview;
DROP VIEW     IF EXISTS course_overview;
DROP FUNCTION IF EXISTS search_chunks(vector, uuid, uuid, integer);
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
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

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
    CONSTRAINT materials_failed_has_error   CHECK (status <> 'failed' OR error_message IS NOT NULL)
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

    PRIMARY KEY (material_id, page_number),
    CONSTRAINT document_pages_page_check   CHECK (page_number > 0),
    CONSTRAINT document_pages_counts_check CHECK (
        char_count >= 0 AND table_count >= 0 AND image_count >= 0
        AND drawing_count >= 0 AND math_symbol_count >= 0
    )
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
    -- 'text' = a passage of prose; 'table' = one whole table as markdown
    chunk_type  VARCHAR(10) NOT NULL DEFAULT 'text',

    -- Semantic meaning of `content`, produced by the embedding model.
    -- 384 = output size of the model we'll use (MiniLM / bge-small family).
    -- NULL until the embedding step has run for this chunk.
    embedding   VECTOR(384),

    -- Keyword-search version of `content`, maintained automatically by
    -- PostgreSQL (GENERATED ... STORED): words are normalised, so
    -- "normalization" also matches "normalized" / "normalize".
    content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT document_chunks_unique_index  UNIQUE (material_id, chunk_index),
    CONSTRAINT document_chunks_index_check   CHECK (chunk_index >= 0),
    CONSTRAINT document_chunks_page_check    CHECK (page_number > 0),
    CONSTRAINT document_chunks_content_check CHECK (length(trim(content)) > 0),
    CONSTRAINT document_chunks_tokens_check  CHECK (token_count IS NULL OR token_count > 0),
    CONSTRAINT document_chunks_type_check    CHECK (chunk_type IN ('text', 'table')),
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
-- ============================================================

CREATE TABLE chat_messages (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL,
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_messages_role_check    CHECK (role IN ('user', 'assistant')),
    CONSTRAINT chat_messages_content_check CHECK (length(trim(content)) > 0)
);


-- ============================================================
-- 7. MESSAGE SOURCES
-- Which chunks an answer was based on (the citations).
-- A many-to-many link between chat_messages and document_chunks,
-- so its primary key is the PAIR (message_id, chunk_id).
-- ============================================================

CREATE TABLE message_sources (
    message_id       UUID             NOT NULL REFERENCES chat_messages(id)   ON DELETE CASCADE,
    chunk_id         UUID             NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    rank             SMALLINT         NOT NULL,   -- 1 = most relevant
    similarity_score DOUBLE PRECISION,

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
CREATE INDEX idx_chat_sessions_user_id    ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_course_id  ON chat_sessions(course_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id, created_at);
CREATE INDEX idx_message_sources_chunk_id ON message_sources(chunk_id);
-- Supports the chunk -> page foreign key and "chunks of page N".
CREATE INDEX idx_chunks_material_page     ON document_chunks(material_id, page_number);

-- Partial index: only rows WHERE needs_vision are in it, so it stays tiny
-- and "which pages of this file need the image reader?" is fast (5b).
CREATE INDEX idx_pages_needs_vision ON document_pages(material_id) WHERE needs_vision;

-- Full-text search: GIN ("generalized inverted index") maps each
-- word to the chunks containing it, like the index at the back of a book.
CREATE INDEX idx_chunks_content_tsv ON document_chunks USING GIN (content_tsv);

-- Semantic search: HNSW builds a navigable graph of vectors so the
-- nearest chunks are found without comparing against every row.
-- vector_cosine_ops = we measure closeness with cosine distance (<=>).
CREATE INDEX idx_chunks_embedding ON document_chunks
    USING hnsw (embedding vector_cosine_ops);


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

-- Admin page: activity per user.
-- Subqueries count each table separately, so joining several
-- one-to-many tables doesn't multiply the counts.
CREATE VIEW user_overview AS
SELECT
    u.id,
    u.name,
    u.email,
    u.role,
    u.is_active,
    u.created_at,
    (SELECT COUNT(*) FROM courses c WHERE c.user_id = u.id)          AS course_count,
    (SELECT COUNT(*) FROM materials m
        JOIN courses c ON c.id = m.course_id WHERE c.user_id = u.id) AS material_count,
    (SELECT COUNT(*) FROM chat_sessions s WHERE s.user_id = u.id)    AS chat_count
FROM users u;


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
      WHERE dp.material_id = m.id AND dp.needs_vision)         AS vision_page_count
FROM materials m
JOIN courses c ON c.id = m.course_id;


-- ============================================================
-- STORED FUNCTION: semantic search
-- Returns the k chunks closest in meaning to a question vector,
-- restricted to ONE course that belongs to ONE user.
--
--   <=>  is pgvector's cosine DISTANCE (0 = same direction).
--   similarity = 1 - distance, so higher = more relevant.
--
-- Checking p_user_id here as well as in the API means a bug in the
-- backend still can't leak another student's notes.
-- ============================================================

CREATE FUNCTION search_chunks(
    p_query     VECTOR(384),
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
