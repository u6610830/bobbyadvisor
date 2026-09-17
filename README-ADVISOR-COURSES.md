# Advisor plan + Admin course descriptions

## One-time Supabase step
Run `server/supabase_course_catalog.sql` in the Supabase SQL Editor.

If the `/advisors` endpoint reports that `department` is missing from the
schema cache, run `server/supabase_advisors_table.sql` in the Supabase SQL
Editor. The script is safe to run again and upgrades an existing advisors
table.

The same script also upgrades `students.advisor_id` to text so advisor IDs such
as `E1001` can be saved without a UUID conversion error.

It:
- adds `advisor_id` to `students` if missing
- creates `course_catalog` for admin-managed descriptions

## What changed
- Advisor Student List is filtered by the logged-in advisor ID.
- Advisor Course Registrations is filtered to that advisor's students.
- Student Analytics shows the selected student's saved Planner courses from `student_registrations`.
- Student advisor choices sync from local profile storage to the `students.advisor_id` column.
- Admin sidebar has **All Courses**.
- All Courses merges known courses from grades, timetable, prerequisites, and `course_catalog`.
- Admin can add a course and edit course name, credits, and description.
