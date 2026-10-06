-- Revision planner + push reminders. Safe to re-run.

-- ── Plan items ──────────────────────────────────────────────────────────
-- One row per scheduled chapter (revision, study session or test) on a day. Synced from the app like
-- test_results: soft-deleted (deleted = true) so a removal reaches every device.
create table if not exists public.plan_items (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  chapter_id  text not null,
  date        date not null,
  kind        text not null default 'revision' check (kind in ('revision', 'study', 'test')),
  done_at     timestamptz,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists plan_items_user_date on public.plan_items (user_id, date);

alter table public.plan_items enable row level security;
drop policy if exists "own plan" on public.plan_items;
create policy "own plan" on public.plan_items
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── Push subscriptions ──────────────────────────────────────────────────
-- One row per browser/device that turned reminders on. The reminder job reads these with the secret key.
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── Reminder log ────────────────────────────────────────────────────────
-- What the reminder job already sent (user, day, morning/evening), so overlapping runs never double-send.
-- Server-only: no policies, so only the secret key can touch it.
create table if not exists public.reminder_log (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  slot     text not null check (slot in ('morning', 'evening')),
  sent_at  timestamptz not null default now(),
  primary key (user_id, day, slot)
);
alter table public.reminder_log enable row level security;

-- ── The trigger ─────────────────────────────────────────────────────────
-- Reminders go out when something calls GET /api/cron/reminders with the CRON_SECRET. After deploying,
-- schedule it every 15 minutes from Supabase (Database → Extensions: enable pg_cron and pg_net), replacing
-- the two placeholders:
--
--   select cron.schedule('lockin-reminders', '*/15 * * * *', $$
--     select net.http_get(
--       url := 'https://YOUR-SITE.vercel.app/api/cron/reminders',
--       headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
--     );
--   $$);
--
-- To stop it: select cron.unschedule('lockin-reminders');
