-- Chat: reactions and replies (WhatsApp-style). Safe to re-run.

-- reply_to: the message this one answers (swipe right on a bubble). Must be in the same thread (policy below).
alter table public.messages add column if not exists reply_to uuid references public.messages (id) on delete set null;
-- reactions: { "<user id>": "<emoji>" }, one reaction per person per message. Changed only through react_to_message().
alter table public.messages add column if not exists reactions jsonb not null default '{}'::jsonb;

-- Senders write only the message itself; reactions and read receipts have their own paths.
revoke insert on public.messages from authenticated, anon;
grant insert (id, student_id, sender_id, body, chapter_id, reply_to) on public.messages to authenticated;

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

-- Sets (or with emoji = null, removes) the caller's reaction on a message in a thread they can see.
create or replace function public.react_to_message(msg uuid, emoji text) returns public.messages
  language plpgsql security definer set search_path = ''
as $$
declare
  m public.messages;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if emoji is not null and (char_length(emoji) = 0 or char_length(emoji) > 16) then
    raise exception 'bad reaction';
  end if;
  update public.messages
     set reactions = case when emoji is null then reactions - auth.uid()::text
                          else reactions || jsonb_build_object(auth.uid()::text, emoji) end
   where id = msg and (student_id = auth.uid() or public.is_admin())
  returning * into m;
  return m;
end;
$$;
revoke execute on function public.react_to_message(uuid, text) from public, anon;
grant execute on function public.react_to_message(uuid, text) to authenticated;
