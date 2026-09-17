// Browser-side Supabase client — used by advisor chat subscriptions and
// the secure password-recovery callback. Normal profile/data requests go
// through the Express backend in server/server.js.
//
// IMPORTANT: only ever put the Supabase "anon" / "public" key here.
// NEVER put the service-role key in client/.env — Vite bundles every
// VITE_-prefixed variable into the JS shipped to the browser, so a
// service key here would be visible to anyone who opens dev tools.
//
// Setup:
//   1. Run server/supabase_chat.sql once in the Supabase SQL Editor.
//   2. Create client/.env (see client/.env.example) with:
//        VITE_SUPABASE_URL=https://ipkxqqnuwswuwbtsemdp.supabase.co
//        VITE_SUPABASE_ANON_KEY=<Project Settings -> API -> anon public key>
//   3. Restart `npm run dev` after adding/changing client/.env (Vite only
//      reads env files at startup).
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. " +
      "Advisor chat won't work until client/.env is configured — see client/.env.example."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
