-- Video and voice calls, anywhere in the app: a student and the coaches, the two players of a chess game, the
-- players of a skribbl room. Up to 8 people, all connected to each other (a WebRTC mesh), so the media never
-- touches our servers. They find each other over a Realtime broadcast channel named
-- call:<id>:<key>, and only members can read the key, so nobody else can listen in even if they guess the id.
-- The database decides who may call whom, keeps the roster, and delivers the ring: an invitee's 'ringing' row
-- reaches them through Realtime, which only sends rows they're allowed to read, so a ring can't be faked.
-- Every call belongs to a context, and there's at most one live call per context that you're in: a student calling
-- the coaches and a coach calling that student at the same moment end up in the same call, but a coach's calls with
-- two different students never merge (each student has their own 'coach:<student id>').
-- Players never write these tables. Everything goes through start_call, set_call_state and call_heartbeat below.
-- Safe to re-run.

create table if not exists public.calls (
  id          uuid primary key default gen_random_uuid(),
  key         uuid not null default gen_random_uuid(),    -- names the signaling channel; only members can read it
  created_by  uuid not null references auth.users (id) on delete cascade,
  context     text not null,                              -- 'coach:<student id>' | 'chess:<game id>' | 'skribbl:<room id>'
  created_at  timestamptz not null default now(),
  ended_at    timestamptz                                 -- set when the last person leaves
);
-- Finding the live call for a chess game, a skribbl room, ...
create index if not exists calls_live on public.calls (context) where ended_at is null;

create table if not exists public.call_members (
  call        uuid not null references public.calls (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default '',                   -- display only; whoever invites picks it
  state       text not null default 'ringing' check (state in ('ringing', 'joined', 'left', 'declined', 'missed')),
  invited_by  uuid references auth.users (id) on delete set null,
  seen_at     timestamptz,                                -- heartbeat while joined
  updated_at  timestamptz not null default now(),         -- a ring lasts 60 s from here
  primary key (call, user_id)
);
-- "Is anyone ringing me?" and the call history.
create index if not exists call_members_user on public.call_members (user_id, updated_at desc);

alter table public.calls enable row level security;
alter table public.call_members enable row level security;

-- Whether the signed-in user is in call `p_call`, in any state: the roster stays visible to someone who declined or
-- left (it holds no secret). security definer: the call_members policy can't query call_members itself (infinite
-- recursion).
create or replace function public.call_member(p_call uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.call_members m where m.call = p_call and m.user_id = (select auth.uid()));
$$;
revoke execute on function public.call_member(uuid) from public, anon;
grant execute on function public.call_member(uuid) to authenticated;


drop policy if exists "members read" on public.call_members;
create policy "members read" on public.call_members for select using (public.call_member(call));

-- Nobody writes directly, and anonymous visitors can't read anything.
revoke insert, update, delete, truncate on public.calls, public.call_members from authenticated, anon;
revoke all on public.calls, public.call_members from anon;
grant select on public.calls, public.call_members to authenticated;

-- Whether user `p_user` may be in a call with context `p_context` (canonical, lowercase), whatever its roster says:
--   coach:<student>  that student, or any coach
--   chess:<game>     white or black of the game
--   skribbl:<room>   a player of the room who wasn't kicked
-- start_call checks it for the caller and every invitee, set_call_state again on every join, so someone who has
-- since been kicked from the room or stopped being a coach can't get back in. Internal: it takes any user id, so
-- clients can't call it (that would tell them who's in which room).
create or replace function public.call_allowed(p_context text, p_user uuid) returns boolean
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if p_user is null or p_context is null then
    return false;
  elsif p_context ~ ('^coach:' || v_uuid || '$') then
    return p_user = substr(p_context, 7)::uuid or public.is_admin_user(p_user);
  elsif p_context ~ ('^chess:' || v_uuid || '$') then
    return exists (select 1 from public.chess_games g where g.id = substr(p_context, 7)::uuid and p_user in (g.white, g.black));
  elsif p_context ~ ('^skribbl:' || v_uuid || '$') then
    return exists (
      select 1 from public.skribbl_players p where p.room = substr(p_context, 9)::uuid and p.user_id = p_user and not p.kicked
    );
  end if;
  return false;
end;
$$;
revoke execute on function public.call_allowed(text, uuid) from public, anon, authenticated;

-- Whether the signed-in user is ringing or in call `p_call`, and still belongs in it (call_allowed). Only they can
-- read the call itself, and with it the key to the signaling channel: someone who declined, left or missed it, was
-- kicked from the room or stopped being a coach can't keep listening in. To come back, the app sets 'joined' first
-- (set_call_state checks they may), then reads the call. security definer, so reading calls here from the calls
-- policy doesn't go through that policy again.
create or replace function public.call_active_member(p_call uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.call_members m join public.calls c on c.id = m.call
     where m.call = p_call and m.user_id = (select auth.uid()) and m.state in ('ringing', 'joined')
       and public.call_allowed(c.context, m.user_id)
  );
$$;
revoke execute on function public.call_active_member(uuid) from public, anon;
grant execute on function public.call_active_member(uuid) to authenticated;

drop policy if exists "members read" on public.calls;
create policy "members read" on public.calls for select using (public.call_active_member(id));

-- Starts a call (or rings more people into the one already going) and returns its id.
--   coach:<student>  the call between that student and the coaches. The student (only for their own id) rings every
--                    coach, and p_invitees is ignored. A coach rings just that student (p_invitees empty or only them).
--   chess:<game>     a player calls the other player
--   skribbl:<room>   a player calls other players in the room
-- p_names[i] is the name to show for p_invitees[i], p_name the caller's own. A live call with the same context
-- that you're in is reused (for coach:<student>, any coach joins the live one), unless it's stale (nobody's
-- heartbeat in 90 s and older than 90 s): then it's ended and a new one starts. People who left, declined or
-- missed are rung again; ringing people ring again from now.
create or replace function public.start_call(p_context text, p_invitees uuid[], p_names text[], p_name text)
  returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_context  text := lower(trim(coalesce(p_context, '')));
  v_target   uuid;              -- the student, chess game or skribbl room
  v_admin    boolean;
  v_ids      uuid[] := '{}';
  v_names    text[] := '{}';
  v_call     uuid;
  v_u        uuid;
  v_black    uuid;
  v_found    boolean;
  v_stale    boolean;
  r          record;
begin
  if v_me is null then
    raise exception 'sign in to make a call.';
  end if;

  v_admin := public.is_admin_user(v_me);

  -- Who's being called. Duplicates count once (with the first name given).
  if v_context !~ '^coach:' or v_admin then
    for i in 1 .. coalesce(array_length(p_invitees, 1), 0) loop
      v_u := p_invitees[i];
      if v_u is null then
        raise exception 'unknown user.';
      end if;
      if v_u = v_me then
        raise exception 'you can''t call yourself.';
      end if;
      if not v_u = any (v_ids) then
        v_ids := v_ids || v_u;
        v_names := v_names || left(trim(coalesce(p_names[i], '')), 40);
      end if;
    end loop;
  end if;

  if v_context ~ '^coach:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and not v_admin then
    v_target := substr(v_context, 7)::uuid;
    v_context := 'coach:' || v_target::text;
    if not public.call_allowed(v_context, v_me) then
      raise exception 'you can only call your own coach.';
    end if;
    select coalesce(array_agg(u.id order by u.id), '{}'),
           coalesce(array_agg(left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), 'coach'), 40) order by u.id), '{}')
      into v_ids, v_names
      from auth.users u
     where u.id <> v_me and exists (select 1 from public.admins a where lower(a.email) = lower(u.email));
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      raise exception 'there''s no coach to call.';
    end if;

  elsif v_context ~ '^coach:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    -- A coach calling a student.
    v_target := substr(v_context, 7)::uuid;
    v_context := 'coach:' || v_target::text;
    if v_target = v_me then
      raise exception 'you can''t call yourself.';
    end if;
    if not public.call_allowed(v_context, v_me) then
      raise exception 'you can only call your own coach.';
    end if;
    if exists (select 1 from unnest(v_ids) x where x <> v_target) then
      raise exception 'you can only call this student.';
    end if;
    if not exists (select 1 from auth.users u where u.id = v_target) then
      raise exception 'unknown user.';
    end if;
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      v_ids := array[v_target];
      v_names := array[left(trim(coalesce(p_names[1], '')), 40)];
    end if;

  elsif v_context ~ '^chess:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_target := substr(v_context, 7)::uuid;
    v_context := 'chess:' || v_target::text;
    select true, g.black into v_found, v_black from public.chess_games g where g.id = v_target;
    if v_found is null then
      raise exception 'game not found.';
    end if;
    if not public.call_allowed(v_context, v_me) then
      raise exception 'you''re not playing in this game.';
    end if;
    if v_black is null then
      raise exception 'nobody has joined this game yet.';
    end if;
    -- With two seats and no calling yourself, "may be in this call" means "the opponent".
    if exists (select 1 from unnest(v_ids) x where not public.call_allowed(v_context, x)) then
      raise exception 'you can only call your opponent in this game.';
    end if;

  elsif v_context ~ '^skribbl:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_target := substr(v_context, 9)::uuid;
    v_context := 'skribbl:' || v_target::text;
    if not public.call_allowed(v_context, v_me) then
      raise exception 'you''re not in this room.';
    end if;
    if exists (select 1 from unnest(v_ids) x where not public.call_allowed(v_context, x)) then
      raise exception 'you can only call players in this room.';
    end if;

  else
    raise exception 'unknown kind of call.';
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'pick someone to call.';
  end if;
  if array_length(v_ids, 1) > 7 then
    raise exception 'a call can have at most 8 people.';
  end if;
  if (select count(*) from auth.users u where u.id = any (v_ids)) <> array_length(v_ids, 1) then
    raise exception 'unknown user.';
  end if;

  -- One start_call at a time per context, so two people calling each other at once end up in the same call.
  perform pg_advisory_xact_lock(hashtextextended('public.calls:' || v_context, 0));

  for r in
    select c.id, c.created_at
      from public.calls c
     where c.context = v_context and c.ended_at is null
       -- coach:<student> is open to any coach (the student is always in it), the rest only to members.
       and (c.context like 'coach:%' or exists (select 1 from public.call_members m where m.call = c.id and m.user_id = v_me))
     order by c.created_at desc
       for update of c
  loop
    v_stale := r.created_at < now() - interval '90 seconds'
       and not exists (
         select 1 from public.call_members m
          where m.call = r.id and m.state = 'joined' and m.seen_at > now() - interval '90 seconds'
       );
    if v_stale then
      update public.calls set ended_at = now() where id = r.id;
      update public.call_members set state = 'missed', updated_at = now() where call = r.id and state = 'ringing';
    elsif v_call is null then
      v_call := r.id;
    end if;
  end loop;

  if v_call is null then
    insert into public.calls (created_by, context) values (v_me, v_context) returning id into v_call;
  end if;

  -- The caller is in.
  insert into public.call_members as m (call, user_id, name, state, seen_at, updated_at)
  values (v_call, v_me, left(trim(coalesce(p_name, '')), 40), 'joined', now(), now())
  on conflict (call, user_id) do update
     set state = 'joined', seen_at = now(), updated_at = now(),
         name = case when excluded.name <> '' then excluded.name else m.name end;

  -- Ring everyone else. When no name was given, use the one the game or room already shows.
  insert into public.call_members as m (call, user_id, name, state, invited_by, updated_at)
  select v_call, x.u,
         coalesce(
           nullif(x.n, ''),
           nullif(left(case
             when v_context like 'chess:%' then (select case when g.white = x.u then g.white_name else g.black_name end
                                                  from public.chess_games g where g.id = v_target)
             when v_context like 'skribbl:%' then (select p.name from public.skribbl_players p where p.room = v_target and p.user_id = x.u)
             else (select u.raw_user_meta_data ->> 'name' from auth.users u where u.id = x.u)
           end, 40), ''),
           ''),
         'ringing', v_me, now()
    from unnest(v_ids, v_names) as x (u, n)
  on conflict (call, user_id) do update
     set state = 'ringing', updated_at = now(),
         invited_by = case when m.state = 'ringing' then m.invited_by else excluded.invited_by end
   where m.state in ('ringing', 'left', 'declined', 'missed');

  if (select count(*) from public.call_members m where m.call = v_call and m.state in ('ringing', 'joined')) > 8 then
    raise exception 'a call can have at most 8 people.';
  end if;

  return v_call;
end;
$$;
revoke execute on function public.start_call(text, uuid[], text[], text) from public, anon;
grant execute on function public.start_call(text, uuid[], text[], text) to authenticated;

-- Joins, leaves or declines a call you're in. You can't join one that's over, or one you no longer belong in (kicked
-- from the skribbl room, no longer a coach, ...: see call_allowed). When nobody is left in the call, it
-- ends and everyone still ringing has missed it.
create or replace function public.set_call_state(p_call uuid, p_state text, p_name text default null)
  returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_ended    timestamptz;
  v_context  text;
begin
  if p_state is null or p_state not in ('joined', 'left', 'declined') then
    raise exception 'unknown call state.';
  end if;
  -- Lock the call so two people hanging up at once can't both think the other is still there.
  select c.ended_at, c.context into v_ended, v_context from public.calls c where c.id = p_call for update;
  if not found or v_me is null or not exists (select 1 from public.call_members m where m.call = p_call and m.user_id = v_me) then
    raise exception 'you''re not in this call.';
  end if;
  if p_state = 'joined' and v_ended is not null then
    raise exception 'this call has ended.';
  end if;
  if p_state = 'joined' and not public.call_allowed(v_context, v_me) then
    raise exception 'you''re not in this call.';
  end if;

  update public.call_members m
     set state = p_state, updated_at = now(),
         seen_at = case when p_state = 'joined' then now() else m.seen_at end,
         name = coalesce(nullif(left(trim(p_name), 40), ''), m.name)
   where m.call = p_call and m.user_id = v_me;

  if not exists (select 1 from public.call_members m where m.call = p_call and m.state = 'joined') then
    update public.calls set ended_at = now() where id = p_call and ended_at is null;
    update public.call_members set state = 'missed', updated_at = now() where call = p_call and state = 'ringing';
  end if;
end;
$$;
revoke execute on function public.set_call_state(uuid, text, text) from public, anon;
grant execute on function public.set_call_state(uuid, text, text) to authenticated;

-- "Still here": sent every few seconds while you're in a call, so a call everyone dropped out of (closed tab, lost
-- signal) is known to be stale.
create or replace function public.call_heartbeat(p_call uuid) returns void
  language sql security definer set search_path = ''
as $$
  update public.call_members set seen_at = now()
   where call = p_call and user_id = (select auth.uid()) and state = 'joined';
$$;
revoke execute on function public.call_heartbeat(uuid) from public, anon;
grant execute on function public.call_heartbeat(uuid) to authenticated;

-- Rings, joins and hang-ups over Supabase Realtime (each subscriber only gets rows the policies above let it read).
do $$
declare
  t text;
begin
  foreach t in array array['calls', 'call_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
