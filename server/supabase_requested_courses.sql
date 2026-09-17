-- Run once in the Supabase SQL Editor.
--
-- Backs the student Planner "Requested Unscheduled Courses" box and the
-- Admin/Advisor "High-Demand Courses" page.
--
-- One row = one student requesting one course. A student's rows are fully
-- replaced on every Planner save (see POST /requested-courses in
-- server/server.js), so the number of rows for a course_code is always
-- exactly the number of distinct students currently requesting it.

create table if not exists requested_unscheduled_courses (
  id bigint generated always as identity primary key,
  student_id text not null,
  course_code text not null,
  course_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists requested_unscheduled_courses_student_id_idx
  on requested_unscheduled_courses (student_id);

create index if not exists requested_unscheduled_courses_course_code_idx
  on requested_unscheduled_courses (course_code);
