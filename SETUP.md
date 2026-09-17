# Bobby Advisor setup

## 1. Configure Supabase

1. Open the Supabase SQL Editor and run `server/supabase_auth_migration.sql` once.
2. In **Authentication > Providers > Email**, enable email/password sign-in and **Confirm email**.
3. In **Authentication > URL Configuration**, set the Site URL to `http://localhost:5173` for local development and allow redirects to:
   - `http://localhost:5173/?verified=1`
   - `http://localhost:5173/?reset=1`
4. For production, replace those local URLs and `CLIENT_URL` with the deployed frontend URL.

Supabase's default email sender is suitable for testing but is rate-limited. Configure custom SMTP before production use.

## 2. Create environment files

Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`, then enter your own keys. Never put the Supabase service-role key in the client file.

Also set `CHAT_ENCRYPTION_KEY` in `server/.env` to a long random value — it encrypts Bobby's saved chat messages (both the student's and Bobby's own replies) before they're written to the database. Without it, the server falls back to an insecure default key and logs a warning on startup. Changing this key later makes previously saved messages undecryptable, so pick it once and keep it stable.

## 3. Install and run

In one terminal:

```bash
cd server
npm install
npm start
```

In a second terminal:

```bash
cd client
npm install
npm run dev
```

The frontend defaults to `http://localhost:5173` and the backend to `http://localhost:3001`.

## What was added

- Student registration now saves the selected curriculum and sends an email-verification link.
- Student login validates the ID/password through Supabase Auth and blocks unverified accounts.
- Forgot Password sends a reset link to the student's registered email.
- Admin Graduation Check uses the student's saved curriculum and elective group, and shows detailed requirement, missing-course, and final-result tables.
- Passing grades and retakes are evaluated consistently across Dashboard, Planner, prerequisites, Goals, and Graduation Check.

