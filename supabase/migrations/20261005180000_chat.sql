-- Chat between admins (coaches) and each student. One thread per student, keyed by student_id.
-- Safe to re-run.

-- ── Admins ──────────────────────────────────────────────────────────────
-- Who counts as an admin inside the database (chat access). Keep in step with ADMIN_EMAILS in .env.
create table if not exists public.admins (
  email text primary key
);
insert into public.admins (email) values ('abhishek4code@gmail.com') on conflict do nothing;

alter table public.admins enable row level security;
drop policy if exists "see own admin row" on public.admins;
create policy "see own admin row" on public.admins
  for select using (email = (select auth.jwt() ->> 'email'));

-- security definer so policies can check admin status without exposing the admins table.
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where email = (select auth.jwt() ->> 'email'));
$$;

-- ── Messages ────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references auth.users (id) on delete cascade,
  sender_id   uuid not null references auth.users (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  chapter_id  text,                       -- optional: the chapter this message is about
  created_at  timestamptz not null default now(),
  read_at     timestamptz                 -- set when the other side has seen it
);
create index if not exists messages_thread on public.messages (student_id, created_at desc);

alter table public.messages enable row level security;

-- A student sees only their own thread; admins see every thread.
drop policy if exists "read thread" on public.messages;
create policy "read thread" on public.messages
  for select using (student_id = (select auth.uid()) or (select public.is_admin()));

-- You can only send as yourself, into your own thread (or any thread if you're an admin).
drop policy if exists "send in thread" on public.messages;
create policy "send in thread" on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and (student_id = (select auth.uid()) or (select public.is_admin()))
  );

-- Marking as read: only the read_at column can change, only in threads you can see.
drop policy if exists "mark read" on public.messages;
create policy "mark read" on public.messages
  for update using (student_id = (select auth.uid()) or (select public.is_admin()))
  with check (student_id = (select auth.uid()) or (select public.is_admin()));
revoke update on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;

-- Live delivery over Supabase Realtime.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
