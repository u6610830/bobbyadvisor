-- Advisor -> Student course recommendations sent from
-- InstructorStudentAnalytics.jsx ("Recommend Course") and read/actioned by
-- the student. Backs POST/GET/PATCH /advisor-course-recommendations in
-- server/server.js.
create table if not exists public.advisor_course_recommendation (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  advisor_id text not null,
  course_code text not null,
  course_name text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists advisor_course_recommendation_student_idx
  on public.advisor_course_recommendation (student_id);

alter table public.advisor_course_recommendation enable row level security;

-- This app has no real Supabase Auth (see MERGE_NOTES.md / other tables in
-- this project) — login only checks the ID prefix — so, matching the
-- existing `advisor_messages` policy, this is left open to any anon
-- request. Lock this down if/when real Supabase Auth is added.
create policy "Allow anon read/write on advisor_course_recommendation"
  on public.advisor_course_recommendation
  for all
  using (true)
  with check (true);
