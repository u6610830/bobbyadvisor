-- Run this once in Supabase SQL Editor before using registration,
-- email verification, password reset, or saved curriculum selection.

alter table public.students
  add column if not exists curriculum_year text,
  add column if not exists elective_group text,
  add column if not exists auth_user_id uuid,
  add column if not exists email_verified boolean not null default true;

-- New accounts are stored in Supabase Auth, so a bcrypt hash is optional.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'password_hash'
  ) then
    alter table public.students alter column password_hash drop not null;
  end if;
end $$;

create unique index if not exists students_auth_user_id_unique
  on public.students (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists students_email_lower_unique
  on public.students (lower(email))
  where email is not null;

-- Existing bcrypt accounts remain usable and can be migrated automatically
-- when the student requests a password-reset email.
update public.students
set email_verified = true
where auth_user_id is null;

