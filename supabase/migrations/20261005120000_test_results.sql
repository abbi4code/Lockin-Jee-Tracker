-- Test-series results (MathonGo chapterwise and PYQ tests): one row per test taken.
-- Rows are soft-deleted (deleted = true) so a removal syncs to every device.

create table if not exists public.test_results (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  track_id     text not null,            -- e.g. 'mg-phys-laws-of-motion'
  kind         text not null check (kind in ('chapterwise', 'pyq')),
  test_no      integer not null check (test_no > 0),
  taken_on     date,
  score        numeric,                  -- null for tests imported from the old Excel (no score recorded)
  max_score    numeric,
  correct      integer,
  wrong        integer,
  unattempted  integer,
  time_min     integer,
  imported     boolean not null default false,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);
create index if not exists test_results_user_track on public.test_results (user_id, track_id);

alter table public.test_results enable row level security;

-- Students manage their own results. (The admin panel reads and writes with the secret key on the server.)
drop policy if exists "own tests" on public.test_results;
create policy "own tests" on public.test_results
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
