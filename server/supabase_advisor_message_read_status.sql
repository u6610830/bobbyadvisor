-- Adds unread/read tracking for Student <-> Advisor chat notifications.
-- New columns begin with DEFAULT true so old messages are treated as read.
-- After the backfill, the default is changed to false for future rows.
-- The backend still explicitly sets the sender's own flag to true.

alter table if exists public.advisor_messages
  add column if not exists read_by_student boolean not null default true;

alter table if exists public.advisor_messages
  add column if not exists read_by_advisor boolean not null default true;

alter table if exists public.advisor_messages
  alter column read_by_student set default false,
  alter column read_by_advisor set default false;

create index if not exists advisor_messages_student_unread_idx
  on public.advisor_messages (student_id, advisor_id, read_by_student);

create index if not exists advisor_messages_advisor_unread_idx
  on public.advisor_messages (advisor_id, student_id, read_by_advisor);
