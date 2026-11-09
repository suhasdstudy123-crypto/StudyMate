-- ============================================================
-- Migration 007: admin dashboard (Stage 8)
--
-- The admin sees how StudyMate is USED, never WHAT students study.
-- Allowed: account metadata (name, email, role, active, joined), counts,
-- statuses, model names, token counts, timestamps.
-- Never: note text, passages, questions, answers, chat titles (a chat's
-- title IS its first question), course names, file titles or file names.
--
--   1. materials.processing_started_at / processing_finished_at
--      + trigger that fills them whenever status changes, whoever changes it.
--      Without them "average processing time" can't be measured:
--      updated_at also moves on every progress tick and on rename.
--   2. Four views, each exposing ONLY metadata and counts:
--        admin_overview      one row: users, files, pages, passages, chats
--        admin_user_stats    one row per user
--        admin_chat_daily    one row per day (IST) with questions/answers/tokens
--        admin_model_usage   one row per model: pages read + answers written
--      Replaces user_overview (unused, and it counted empty chats).
--   3. Function delete_empty_chat_sessions(older_than): removes chats whose
--      first question never got saved (cleanup at start + admin button).
--   4. Role studymate_admin_reader: may SELECT the four views and nothing
--      else. Admin routes switch to it with SET LOCAL ROLE, so even a buggy
--      admin query on chat_messages.content gets "permission denied".
--      A view runs with its OWNER's rights, so the reader can see the counts
--      without having any right on the tables underneath.
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/007_admin_stats.sql
-- One transaction: if any step fails, nothing is changed.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Processing timestamps (NULL for files processed before this migration)
-- ------------------------------------------------------------
ALTER TABLE materials
    ADD COLUMN processing_started_at  TIMESTAMPTZ,
    ADD COLUMN processing_finished_at TIMESTAMPTZ,
    -- A CHECK passes when the result is NULL, so "not finished yet" is fine.
    ADD CONSTRAINT materials_processing_times_check
        CHECK (processing_finished_at >= processing_started_at);

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

-- ------------------------------------------------------------
-- 2. Admin views
-- ------------------------------------------------------------
DROP VIEW IF EXISTS user_overview;

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

-- ------------------------------------------------------------
-- Stored function: remove empty chats (Stage 8 cleanup)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3. Read-only role for admin routes
-- ------------------------------------------------------------
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

COMMIT;
