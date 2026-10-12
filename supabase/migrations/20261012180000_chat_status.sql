-- Chat: delivery ticks and last seen (WhatsApp-style). Safe to re-run.
--   ✓  sent (the row exists)   ✓✓ delivered (reached the other person's app or phone)   red ✓✓ read

-- ── Fix: sending messages ─────────────────────────────────────────────────
-- The reactions migration's insert policy looked up public.messages from inside a policy on messages, which
-- Postgres rejects ("infinite recursion detected in policy"), so every send failed. Same rule, checked in a function.
-- Whether a message belongs to a thread. A policy on messages can't query messages itself (Postgres reports
-- infinite recursion), so the check runs here, outside row-level security.
create or replace function public.message_in_thread(msg uuid, student uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.messages where id = msg and student_id = student);
$$;
revoke execute on function public.message_in_thread(uuid, uuid) from public, anon;
grant execute on function public.message_in_thread(uuid, uuid) to authenticated;

drop policy if exists "send in thread" on public.messages;
create policy "send in thread" on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and (student_id = (select auth.uid()) or (select public.is_admin()))
    and (reply_to is null or public.message_in_thread(reply_to, student_id))
  );

-- ── Delivered / read ──────────────────────────────────────────────────────

-- delivered_at: set when the message reaches the recipient's app (open, or a push landing on the phone).
alter table public.messages add column if not exists delivered_at timestamptz;
-- Anything already read was delivered.
update public.messages set delivered_at = read_at where read_at is not null and delivered_at is null;

-- Marks every message addressed to the caller as delivered: a student gets the coaches' messages in their
-- thread; an admin gets the students' messages (not other coaches'). Returns how many changed.
create or replace function public.mark_delivered() returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update public.messages
     set delivered_at = now()
   where delivered_at is null
     and sender_id <> auth.uid()
     and (student_id = auth.uid() or (public.is_admin() and sender_id = student_id));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mark_delivered() from public, anon;
grant execute on function public.mark_delivered() to authenticated;

-- Marks one thread's incoming messages as read (and so delivered, if that hadn't been recorded yet).
create or replace function public.mark_read(student uuid) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update public.messages
     set read_at = now(), delivered_at = coalesce(delivered_at, now())
   where student_id = student
     and read_at is null
     and sender_id <> auth.uid()
     and (student_id = auth.uid() or (public.is_admin() and sender_id = student_id));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;

-- ── Last seen ─────────────────────────────────────────────────────────────
-- Updated by the app while it's open (every minute) and when it goes to the background.
-- "Online" itself comes from Realtime presence; this is for "last seen 4:12 pm".
create table if not exists public.chat_presence (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  last_seen  timestamptz not null default now()
);
alter table public.chat_presence enable row level security;

-- Whether a user is an admin (by their auth email), for the policy below.
create or replace function public.is_admin_user(uid uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.users u join public.admins a on lower(a.email) = lower(u.email) where u.id = uid);
$$;
revoke execute on function public.is_admin_user(uuid) from public, anon;
grant execute on function public.is_admin_user(uuid) to authenticated;

-- Admins see everyone's last seen; a student sees their own and the coaches'.
drop policy if exists "see last seen" on public.chat_presence;
create policy "see last seen" on public.chat_presence
  for select using (user_id = (select auth.uid()) or (select public.is_admin()) or public.is_admin_user(user_id));
drop policy if exists "write own last seen" on public.chat_presence;
create policy "write own last seen" on public.chat_presence
  for insert with check (user_id = (select auth.uid()));
drop policy if exists "update own last seen" on public.chat_presence;
create policy "update own last seen" on public.chat_presence
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
