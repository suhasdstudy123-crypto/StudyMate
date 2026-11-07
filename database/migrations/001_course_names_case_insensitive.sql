-- ============================================================
-- Migration 001: course names are unique per student, ignoring case
--
-- Problem: UNIQUE (user_id, name) treats "DBMS" and "dbms" as different
-- names, so a student could end up with two DBMS courses and upload notes
-- into the wrong one.
-- Fix: replace it with a unique index on (user_id, lower(name)).
--
-- Why a migration file instead of re-running schema.sql?
--   schema.sql starts with a DEV RESET that drops every table, so running
--   it again deletes all users, courses and (from Stage 5) materials.
--   A migration changes ONLY what needs to change and keeps the data.
--   schema.sql is updated too, so a fresh database gets the same result.
--
-- Run once (from the studymate folder):
--   psql -U postgres -p 5433 -d studymate -f database/migrations/001_course_names_case_insensitive.sql
-- ============================================================

-- BEGIN ... COMMIT = one transaction. PostgreSQL can run schema changes
-- (DDL) inside a transaction, so if any step fails, nothing is changed:
-- we never end up with the old constraint dropped and no new index.
BEGIN;

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_user_name_unique;

-- Fails (and rolls everything back) if a student ALREADY has two names
-- that differ only in case. Find them with:
--   SELECT user_id, lower(name), count(*) FROM courses
--   GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS courses_user_lower_name_unique
    ON courses (user_id, lower(name));

COMMIT;
