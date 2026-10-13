-- Quizrr (MathonGo's test platform): scores the student logs, and the dates an admin assigns. Safe to re-run.

-- ── Scores ──────────────────────────────────────────────────────────────
-- One row per Quizrr test taken (QRT, QPT). Synced from the app like test_results: soft-deleted
-- (deleted = true) so a removal reaches every device. Marks can be negative (JEE marking).
create table if not exists public.quizrr_attempts (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  test_id      text not null,            -- e.g. 'qrt-1', 'qpt-11' (src/data/quizrr.json)
  taken_on     date,
  score        numeric,
  max_score    numeric,
  physics      numeric,
  chemistry    numeric,
  maths        numeric,
  percentile   numeric check (percentile is null or (percentile >= 0 and percentile <= 100)),
  rank         integer check (rank is null or rank > 0),
  correct      integer,
  wrong        integer,
  unattempted  integer,
  time_min     integer,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);
create index if not exists quizrr_attempts_user_test on public.quizrr_attempts (user_id, test_id);

alter table public.quizrr_attempts enable row level security;
-- Students manage their own scores. (The admin panel reads and writes with the secret key on the server.)
drop policy if exists "own quizrr attempts" on public.quizrr_attempts;
create policy "own quizrr attempts" on public.quizrr_attempts
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── Dates ───────────────────────────────────────────────────────────────
-- The day each test should be taken, set from the admin panel. A missing row means the app's suggested
-- date applies; date = null takes a test off the schedule.
create table if not exists public.quizrr_schedule (
  user_id     uuid not null references auth.users (id) on delete cascade,
  test_id     text not null,
  date        date,
  updated_at  timestamptz not null default now(),
  primary key (user_id, test_id)
);

alter table public.quizrr_schedule enable row level security;
-- Students can only read their dates: there is no insert/update/delete policy, so only the secret key
-- (admin panel) can change them.
drop policy if exists "read own quizrr schedule" on public.quizrr_schedule;
create policy "read own quizrr schedule" on public.quizrr_schedule
  for select using ((select auth.uid()) = user_id);
