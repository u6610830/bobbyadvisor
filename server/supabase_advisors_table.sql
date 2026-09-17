-- Creates the advisors table so "Add Advisor" (Admin > Manage Users)
-- persists in the real database instead of only in browser
-- localStorage. Run this once in the Supabase SQL Editor.
--
-- Seed advisors (E1001-E1005) are inserted with is_seed = true and are
-- protected from deletion by the DELETE /advisors/:id endpoint in
-- server.js — only advisors added afterward (is_seed = false) can be
-- removed.

create table if not exists advisors (
  id text primary key,
  name text not null,
  department text not null,
  email text unique,
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Upgrade an advisors table created before department was added.
alter table advisors add column if not exists department text;
update advisors set department = 'Undeclared' where department is null;
alter table advisors alter column department set not null;
notify pgrst, 'reload schema';

-- Advisor IDs in this application are values such as E1001, not UUIDs.
-- Upgrade the student assignment column when an older schema made it uuid.
alter table students add column if not exists advisor_id text;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'advisor_id'
      and data_type = 'uuid'
  ) then
    alter table students
      alter column advisor_id type text
      using advisor_id::text;
  end if;
end
$$;
notify pgrst, 'reload schema';

insert into advisors (id, name, department, email, is_seed) values
  ('E1001', 'Asst. Prof. Shinnosuke Nohara', 'Computer Science', 'shinnosuke.n@school.edu', true),
  ('E1002', 'Asst. Prof. Toru Kazama', 'Computer Science', 'toru.k@school.edu', true),
  ('E1003', 'Dr. Furuya Rei', 'Information Technology', 'furuya.r@school.edu', true),
  ('E1004', 'Dr. Dekisugi Hidetoshi ', 'Software Engineering', 'dekisugi.h@school.edu', true),
  ('E1005', 'A. Reimon Marika', 'Computer Science', 'reimon.m@school.edu', true)
on conflict (id) do nothing;

-- Advisor login password. New advisors (added via Admin > Manage Users)
-- get a temporary password of "dev-preview" automatically — see the
-- POST /advisors handler in server.js, which hashes it with bcrypt before
-- insert. Advisor/Admin can change it afterwards from Profile (see
-- PUT /advisors/:id/password). Seed advisors get the same temporary
-- password so local/dev login keeps working without extra setup.
alter table advisors add column if not exists password_hash text;
notify pgrst, 'reload schema';

-- Backfill: any advisor without a password yet (seed advisors from an
-- older run of this script, before password_hash existed) gets the same
-- "dev-preview" temporary password so login keeps working. Requires the
-- pgcrypto extension, which Supabase enables by default.
create extension if not exists pgcrypto;
update advisors
  set password_hash = crypt('dev-preview', gen_salt('bf'))
  where password_hash is null;
