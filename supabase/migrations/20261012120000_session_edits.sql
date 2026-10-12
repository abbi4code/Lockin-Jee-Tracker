-- Study sessions can be added by hand, edited and deleted (focus page → log). Safe to re-run.

-- updated_at: newest copy wins when devices sync. Existing rows count as "never edited" (epoch).
alter table public.study_sessions add column if not exists updated_at timestamptz not null default 'epoch';
-- deleted: soft delete, so a removal reaches every device.
alter table public.study_sessions add column if not exists deleted boolean not null default false;
-- source: 'timer' (focus timer) or 'manual' (added by hand). edited: a timer session changed by hand later.
alter table public.study_sessions add column if not exists source text not null default 'timer';
alter table public.study_sessions add column if not exists edited boolean not null default false;

alter table public.study_sessions drop constraint if exists study_sessions_source_check;
alter table public.study_sessions add constraint study_sessions_source_check check (source in ('timer', 'manual'));
-- At most 12 hours in one session (the app trims to this too).
alter table public.study_sessions drop constraint if exists study_sessions_minutes_max;
alter table public.study_sessions add constraint study_sessions_minutes_max check (minutes <= 720) not valid;
