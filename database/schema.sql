-- ============================================================
-- StudyMate Database Schema
-- Phase 3: Database Design
-- ============================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;


-- ============================================================
-- 1. USERS
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 2. COURSES
-- ============================================================

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 3. MATERIALS
-- ============================================================

CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_type VARCHAR(50),
    file_size BIGINT,
    processing_status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT materials_processing_status_check
        CHECK (processing_status IN (
            'pending',
            'processing',
            'completed',
            'failed'
        ))
);


-- ============================================================
-- 4. DOCUMENT CHUNKS
-- ============================================================

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page_number INTEGER,

    -- Embedding will be added after we choose
    -- the embedding model and vector dimension.

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT document_chunks_index_check
        CHECK (chunk_index >= 0),

    CONSTRAINT document_chunks_unique_index
        UNIQUE (material_id, chunk_index)
);


-- ============================================================
-- 5. CHAT SESSIONS
-- ============================================================

CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 6. CHAT MESSAGES
-- ============================================================

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chat_messages_role_check
        CHECK (role IN ('user', 'assistant', 'system'))
);


-- ============================================================
-- 7. MESSAGE SOURCES
-- ============================================================

CREATE TABLE message_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    similarity_score DOUBLE PRECISION,
    source_order INTEGER,

    CONSTRAINT message_sources_unique
        UNIQUE (message_id, chunk_id)
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_courses_user_id
    ON courses(user_id);

CREATE INDEX idx_materials_course_id
    ON materials(course_id);

CREATE INDEX idx_document_chunks_material_id
    ON document_chunks(material_id);

CREATE INDEX idx_chat_sessions_user_id
    ON chat_sessions(user_id);

CREATE INDEX idx_chat_sessions_course_id
    ON chat_sessions(course_id);

CREATE INDEX idx_chat_messages_session_id
    ON chat_messages(session_id);

CREATE INDEX idx_message_sources_message_id
    ON message_sources(message_id);

CREATE INDEX idx_message_sources_chunk_id
    ON message_sources(chunk_id);