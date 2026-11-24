-- Students pick their own Quizrr dates, and log an analysis for each test. Safe to re-run.

-- ── Dates ───────────────────────────────────────────────────────────────
-- Until now only admins wrote public.quizrr_schedule. Students may now add and change their own rows, which
-- are marked set_by = 'student' so the admin panel can show what he moved. They still can't delete rows
-- (that's the admin's "reset to the suggested schedule") or write anyone else's.
alter table public.quizrr_schedule
  add column if not exists set_by text not null default 'admin' check (set_by in ('admin', 'student'));

drop policy if exists "add own quizrr dates" on public.quizrr_schedule;
create policy "add own quizrr dates" on public.quizrr_schedule
  for insert with check ((select auth.uid()) = user_id and set_by = 'student');

drop policy if exists "change own quizrr dates" on public.quizrr_schedule;
create policy "change own quizrr dates" on public.quizrr_schedule
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and set_by = 'student');

-- ── Analysis ────────────────────────────────────────────────────────────
-- Why marks were lost in a test: { on, silly, concept, unstudied, time, note } (src/lib/analysis.ts).
-- Null = not analysed yet. The existing "own tests" / "own quizrr attempts" policies already cover it.
alter table public.test_results add column if not exists analysis jsonb;
alter table public.quizrr_attempts add column if not exists analysis jsonb;

alter table public.test_results drop constraint if exists test_results_analysis_object;
alter table public.test_results add constraint test_results_analysis_object check (analysis is null or jsonb_typeof(analysis) = 'object');
alter table public.quizrr_attempts drop constraint if exists quizrr_attempts_analysis_object;
alter table public.quizrr_attempts add constraint quizrr_attempts_analysis_object check (analysis is null or jsonb_typeof(analysis) = 'object');
