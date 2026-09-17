# Merge Report (round 2): SP1 → merge_repo

This merges SP1_2.zip into the previous merged project (mergedprojectresolved_2_1.zip),
since the two had drifted apart with different features added independently.

## What SP1 had that merge_repo didn't (ported over)

**Advisor → Student course recommendations** — a new feature, not present in
merge_repo at all:
- `server/server.js` — new endpoints: `POST /advisor-course-recommendations`,
  `GET /advisor-course-recommendations/:studentId`,
  `PATCH /advisor-course-recommendations/:id`
- `server/supabase_advisor_course_recommendations.sql` — **new file**, table
  schema for this feature (SP1 had the server code but never included a
  matching SQL migration — I wrote one based on the columns the code uses).
  **Run this in Supabase SQL Editor before using the feature.**
- `client/src/pages/InstructorStudentAnalytics.jsx` (+ `.css`) — new
  "Recommend Course" button/panel so an Advisor can send a student a
  recommended course with an optional comment.
- `client/src/pages/InstructorPortal.jsx` — passes `advisorId` down to
  InstructorStudentAnalytics so it knows who's sending the recommendation.
- `client/src/pages/Planner.jsx` (+ `.css`) — new "Advisor Recommended
  Courses" card so the student sees pending recommendations and can
  "Add to Planner" (goes through the normal prerequisite/time-conflict
  checks) or "Dismiss".

**Small fixes/tweaks**, taken from SP1:
- `client/src/pages/StudentGraduationCheck.jsx` — group tag next to a
  block's label is now hidden when it's identical to the label (was showing
  a redundant duplicate tag).
- `client/src/index.css` — `.something-with-rounded-corners` overflow
  changed from `hidden` to `visible` (SP1 had apparently hit a clipping bug).
- `client/src/pages/RequestedCourses.css`, `AdminCourses.css`,
  `AdminCourseRegistrations.css`, `AdminGraduationCheck.css`,
  `AdminPreRequire.css`, `AdminUploadData.css` — SP1 had corrected several
  Admin-page accents from the generic (yellow) `--primary` to the
  role-based purple (`--role-primary-hover` / `--role-accent-bg`, defined
  in `RoleLayout.css`), and in a couple of Admin pages had CSS classes the
  shared `.jsx` actually uses that merge_repo's CSS was missing entirely
  (e.g. most of `AdminGraduationCheck.css`'s `.grad-check-*` rules). Took
  SP1's version for these files.
- `.gitignore` — merged both lists (`**/.env` from SP1 + the more specific
  entries merge_repo already had).
- `server/package.json` — bumped `@supabase/supabase-js` to SP1's newer
  `^2.115.0`; kept `nodemailer` (merge_repo's `server/mailer.js` needs it;
  SP1 didn't have that file).

## What I did NOT bring over from SP1, and why

SP1 turned out to be a less-developed branch for the Advisor/Admin account
system as a whole — it was missing entirely:
- Real Supabase-backed Advisor/Admin accounts (`AdminManageUsers.jsx`,
  password-based login/change-password, `GET/POST /students`,
  `/advisors`, `/admins` endpoints) — merge_repo has all of this, SP1 was
  still on the static `MOCK_ADVISORS`/`MOCK_ADMINS` + dev-preview-password
  login flow.
- The "Account Settings" page (`AccountSettings.jsx`) for
  Admin/Advisor.
- The "None for now" option on Choose Advisor / the separate Choose Advisor
  screen after first login — SP1 instead asks for an Advisor inline during
  Register.
- Registration with real Supabase Auth (`/students`, `/students/microsoft`,
  email confirmation) — SP1's `registerStudent()` was local-only (browser
  storage, no real account).

Since these aren't just isolated fixes but a whole different (older)
architecture for accounts/registration, I kept merge_repo's versions of
`App.jsx`, `Login.jsx`, `Register.jsx` (+ `.css`), `Profile.jsx`,
`ChooseAdvisor.jsx`, `AdminPortal.jsx`, `mockAdmins.js`, `mockAdvisors.js`,
and `utils/students.js` as-is rather than reverting any of this — bringing
in SP1's simpler versions would have deleted working, more complete
features. `Profile.css` did get a small cleanup (SP1 had already dropped
some CSS rules for form fields that merge_repo's current Profile.jsx
doesn't use).

`client/package-lock.json` and `server/package-lock.json` — kept
merge_repo's; run `npm install` in both `client/` and `server/` to
regenerate them cleanly against the final `package.json`s.

## Before you run it

1. Run `server/supabase_advisor_course_recommendations.sql` in the
   project's Supabase SQL Editor (new table, needed for the recommendation
   feature to work at all).
2. `npm install` in both `client/` and `server/`.
3. Everything else (env vars, other SQL files, etc.) is unchanged from
   before — see `SETUP.md` / the other `README-*.md` files.
