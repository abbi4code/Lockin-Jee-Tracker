-- Questions in focus sessions (focus page): how many the student meant to solve, set before starting, and how many
-- he did, asked when the session ends. Solved ones count toward the day's questions in the app. Both stay null for
-- sessions without questions (theory, a lecture) and for sessions logged before this. Safe to re-run.

alter table public.study_sessions add column if not exists questions_aim integer;
alter table public.study_sessions add column if not exists questions_solved integer;

-- The app's limits (lib/focus.ts): an aim of 1–200 (none is null, not 0) and 0–500 solved.
alter table public.study_sessions drop constraint if exists study_sessions_questions_aim_check;
alter table public.study_sessions add constraint study_sessions_questions_aim_check check (questions_aim is null or questions_aim between 1 and 200);
alter table public.study_sessions drop constraint if exists study_sessions_questions_solved_check;
alter table public.study_sessions add constraint study_sessions_questions_solved_check check (questions_solved is null or questions_solved between 0 and 500);
