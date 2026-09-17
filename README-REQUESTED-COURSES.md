# Requested Unscheduled Courses + High-Demand Courses

## One-time Supabase step
Run `server/supabase_requested_courses.sql` in the Supabase SQL Editor.

It creates `requested_unscheduled_courses` (student_id, course_code, course_name, created_at).

## What changed
- **Student > Planner**: a new "Requested Unscheduled Courses" card sits below "Which courses are open". Students add one box per course they'd like offered (autocomplete suggests from Admin's All Courses catalog, same as Selected Course above it), and can edit/delete a box before pressing **Save**. Save fully replaces that student's saved requests, mirroring how the Selected Course list already saves.
- **Admin sidebar**: new **High-Demand Courses** page listing every requested course (code, name, and number of distinct students who requested it), most-requested first.
- **Advisor sidebar**: same **High-Demand Courses** page, scoped to that advisor's own advisees (same scoping already used for Course Registrations).

## API
- `GET /requested-courses/:studentId` — one student's saved requests (Planner load).
- `POST /requested-courses` — body `{ studentId, courses: ["CODE Name", ...] }`; replaces that student's rows.
- `GET /requested-courses` — every request, or `?advisor_id=` to scope to one advisor's advisees (High-Demand Courses page). A course's demand count is the number of distinct `student_id` rows for that `course_code`.
