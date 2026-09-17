-- Creates the admins table so Admin login authenticates against a real
-- per-account password instead of a shared hardcoded value. Run this once
-- in the Supabase SQL Editor.
--
-- There's no "Add Admin" UI (Admin accounts are seeded here, not created
-- from the app) — this table exists only so Admin has a real password to
-- change from Profile, matching how Advisor accounts work. See the
-- /login/admin and PUT /admins/:id/password endpoints in server.js.

create table if not exists admins (
  id text primary key,
  name text not null,
  department text not null,
  email text unique,
  password_hash text,
  created_at timestamptz not null default now()
);

insert into admins (id, name, department, email) values
  ('A1001', 'Mr. David Dance', 'Computer Science', 'david.d@school.edu')
on conflict (id) do nothing;

-- Seed admins get a temporary password of "dev-preview" too, same as
-- advisors — change it from Profile after signing in.
create extension if not exists pgcrypto;
update admins
  set password_hash = crypt('dev-preview', gen_salt('bf'))
  where password_hash is null;
