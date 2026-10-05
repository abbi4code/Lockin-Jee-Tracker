-- Initial schema: per-user progress, state and focus sessions, each locked to its owner by row-level security.
-- Applied with `npx supabase db push`. Syllabus data ships inside the app, not the database.

create table if not exists public.chapter_progress (
  user_id    uuid not null references auth.users (id) on delete cascade,
  chapter_id text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per focus-timer session.
create table if not exists public.study_sessions (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  chapter_id text,
  subject    text,
  mode       text not null check (mode in ('stopwatch', 'pomodoro')),
  started_at timestamptz not null,
  minutes    integer not null check (minutes > 0)
);
create index if not exists study_sessions_user_started on public.study_sessions (user_id, started_at desc);

alter table public.chapter_progress enable row level security;
alter table public.user_state enable row level security;
alter table public.study_sessions enable row level security;

-- Each user can only see and change their own rows. (The admin panel reads with the secret key on the server.)
drop policy if exists "own progress" on public.chapter_progress;
create policy "own progress" on public.chapter_progress
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own state" on public.user_state;
create policy "own state" on public.user_state
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own sessions" on public.study_sessions;
create policy "own sessions" on public.study_sessions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
