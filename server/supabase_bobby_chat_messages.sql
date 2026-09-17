-- Run once in the Supabase SQL Editor.
--
-- Saves the student <-> Bobby (AI advisor) chat so the conversation
-- persists and can continue across sessions, instead of resetting to just
-- the greeting every time the page loads. See GET/POST /chat/bobby in
-- server/server.js.
--
-- The `text` column holds AES-256-GCM ciphertext, not plain chat text —
-- both the student's messages and Bobby's replies are encrypted in the
-- server before insert (see encryptChatText/decryptChatText in
-- server/server.js) and decrypted only when read back out for the
-- signed-in student. Anyone reading this table directly in Supabase sees
-- only ciphertext, never the conversation itself. No schema change here
-- if you already ran this migration before encryption was added — same
-- `text` column, just holding encrypted values from here on.

create table if not exists bobby_chat_messages (
  id bigint generated always as identity primary key,
  student_id text not null,
  role text not null check (role in ('user', 'bot')),
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists bobby_chat_messages_student_id_idx
  on bobby_chat_messages (student_id);
