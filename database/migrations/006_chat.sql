-- ============================================================
-- Migration 006: what the RAG chat needs (Stage 7)
--
-- The chat tables exist since schema v2 (chat_sessions, chat_messages,
-- message_sources). Checked against what the chat actually does, they
-- miss five things:
--
--   1. chat_messages.created_at DEFAULT clock_timestamp()  (was now())
--      A question and its answer are saved in ONE transaction (both or
--      neither). now() is the time the TRANSACTION started, so both rows
--      would get the SAME timestamp and "ORDER BY created_at" could show the
--      answer before the question. clock_timestamp() is the real time of
--      each INSERT, so the question is always earlier.
--   2. chat_messages.status   for answers: answered | not_in_notes | stopped
--      "not_in_notes" is a real result (the honest refusal), not an error;
--      the UI shows it differently and Stage 9 counts it.
--      "stopped" = the student pressed Stop; the partial answer is kept.
--   3. chat_messages.model    which Gemini model wrote the answer (main or
--      fallback), NULL when no model was asked (e.g. the course is empty).
--   4. chat_messages.search_query   the stand-alone question we actually
--      searched with, when a follow-up ("explain the second one") had to be
--      rewritten using the conversation. Shows WHY these passages were found.
--   5. chat_messages.prompt_tokens / output_tokens   what each answer cost
--      (admin stats in Stage 8, billing decision in Stage 10).
--   + message_sources.cited   every passage SHOWN to the model is stored
--      (rank = its number [n] in the prompt), and cited = true for the ones
--      the answer actually referenced. "Shown but not cited" is useful when
--      checking the chat's quality (Stage 9).
--   + index (user_id, updated_at DESC) for "my recent chats", replacing the
--      plain user_id index (its leading column covers the same lookups).
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/006_chat.sql
-- One transaction: if any step fails, nothing is changed.
-- ============================================================

BEGIN;

-- 1. Real insert time, so a question sorts before its answer.
ALTER TABLE chat_messages ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- 2-5. New columns. All NULL-able, so existing rows (if any) stay valid.
ALTER TABLE chat_messages
    ADD COLUMN status        VARCHAR(20),
    ADD COLUMN model         VARCHAR(100),
    ADD COLUMN search_query  TEXT,
    ADD COLUMN prompt_tokens INTEGER,
    ADD COLUMN output_tokens INTEGER;

-- Answers from before this migration (there shouldn't be any) count as answered.
UPDATE chat_messages SET status = 'answered' WHERE role = 'assistant' AND status IS NULL;

-- Which columns belong to which role, enforced by the database:
--   a question has no status/model/tokens; an answer always has a status;
--   only a question can have a rewritten search_query.
ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_status_check
        CHECK (status IN ('answered', 'not_in_notes', 'stopped')),
    ADD CONSTRAINT chat_messages_role_fields_check
        CHECK (
            (role = 'user'
                AND status IS NULL AND model IS NULL
                AND prompt_tokens IS NULL AND output_tokens IS NULL)
            OR
            (role = 'assistant'
                AND status IS NOT NULL AND search_query IS NULL)
        ),
    ADD CONSTRAINT chat_messages_tokens_check
        CHECK ((prompt_tokens IS NULL OR prompt_tokens >= 0)
           AND (output_tokens IS NULL OR output_tokens >= 0));

-- Was the passage cited in the answer, or only shown to the model?
ALTER TABLE message_sources
    ADD COLUMN cited BOOLEAN NOT NULL DEFAULT false;

-- "My chats, most recent first" = WHERE user_id = ? ORDER BY updated_at DESC.
-- This index answers it in index order, without a sort.
DROP INDEX IF EXISTS idx_chat_sessions_user_id;
CREATE INDEX idx_chat_sessions_user_recent ON chat_sessions (user_id, updated_at DESC);

COMMIT;
