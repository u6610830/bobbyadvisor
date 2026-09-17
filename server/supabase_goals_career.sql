-- Moves Goals & Career Interest from browser localStorage (unscoped —
-- shared by whatever student used that browser, and invisible to the
-- server) onto the student's own row, so they persist per-account and
-- can be used server-side (Course Recommendation, Bobby Advisor chat).
-- Run this once in the Supabase SQL Editor.

alter table students
  add column if not exists goals jsonb not null default '[]'::jsonb,
  add column if not exists career_interests jsonb not null default '[]'::jsonb;
