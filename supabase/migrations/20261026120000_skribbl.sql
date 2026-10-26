-- skribbl (/extras/skribbl/<code>): one player draws a word, the others guess it. Signed-in players only.
-- Players can read their room but never write it: every action goes through /api/skribbl/[code], which runs the
-- rules (src/lib/skribbl/rules.ts) and saves the result with skribbl_apply below, using the secret key. The word
-- and the host's custom words live in skribbl_secrets, which no player can read. Drawing strokes don't touch the
-- database: they go over a Realtime broadcast channel. Safe to re-run.

create table if not exists public.skribbl_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host             uuid not null references auth.users (id) on delete cascade,
  settings         jsonb not null default '{}',
  status           text not null default 'lobby' check (status in ('lobby', 'choosing', 'drawing', 'reveal', 'over')),
  round            integer not null default 0,
  drawer           uuid,
  drawn            uuid[] not null default '{}',     -- who has drawn this round
  step             integer not null default 0,       -- bumped by every change: the write guard
  turn_started_at  timestamptz,
  phase_ends_at    timestamptz,
  mask             text,                             -- the word's blanks with revealed letters (null in hidden mode)
  last_word        text,                             -- the word, once its turn is over
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.skribbl_players (
  room         uuid not null references public.skribbl_rooms (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null default '',
  hue          smallint not null default 0,
  score        integer not null default 0,
  turn_points  integer not null default 0,
  guessed_at   timestamptz,
  vote         smallint not null default 0 check (vote between -1 and 1),
  gone         boolean not null default false,
  kicked       boolean not null default false,
  joined_at    timestamptz not null default now(),
  primary key (room, user_id)
);
create index if not exists skribbl_players_user on public.skribbl_players (user_id);

create table if not exists public.skribbl_secrets (
  room     uuid primary key references public.skribbl_rooms (id) on delete cascade,
  word     text,
  choices  text[] not null default '{}',
  used     text[] not null default '{}',
  custom   text[] not null default '{}'
);

create table if not exists public.skribbl_messages (
  id          bigint generated always as identity primary key,
  room        uuid not null references public.skribbl_rooms (id) on delete cascade,
  user_id     uuid,                -- null: a system line
  name        text not null default '',
  body        text not null,
  kind        text not null check (kind in ('chat', 'correct', 'close', 'system')),
  audience    text not null default 'all' check (audience in ('all', 'guessed', 'user')),
  to_users    uuid[] not null default '{}',   -- who sees a 'guessed' or 'user' message, fixed when it's sent
  created_at  timestamptz not null default now()
);
create index if not exists skribbl_messages_room on public.skribbl_messages (room, id desc);

alter table public.skribbl_rooms enable row level security;
alter table public.skribbl_players enable row level security;
alter table public.skribbl_secrets enable row level security;
alter table public.skribbl_messages enable row level security;

-- Whether the signed-in user is in room `r` (a player who left can still look; a removed one can't).
-- security definer: the players policy can't query skribbl_players itself (infinite recursion).
create or replace function public.skribbl_member(r uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.skribbl_players p where p.room = r and p.user_id = (select auth.uid()) and not p.kicked);
$$;
revoke execute on function public.skribbl_member(uuid) from public, anon;
grant execute on function public.skribbl_member(uuid) to authenticated;

drop policy if exists "members read" on public.skribbl_rooms;
create policy "members read" on public.skribbl_rooms for select using ((select public.skribbl_member(id)));

drop policy if exists "members read" on public.skribbl_players;
create policy "members read" on public.skribbl_players for select using ((select public.skribbl_member(room)));

-- Chat: lines for everyone, plus the ones addressed to you (guessers' chat, "close!").
drop policy if exists "members read" on public.skribbl_messages;
create policy "members read" on public.skribbl_messages for select using (
  (select public.skribbl_member(room)) and (audience = 'all' or (select auth.uid()) = any (to_users))
);

-- skribbl_secrets has no policies: no player can read it. Nobody but the server writes anything.
revoke insert, update, delete on public.skribbl_rooms, public.skribbl_players, public.skribbl_secrets, public.skribbl_messages from authenticated, anon;
revoke select on public.skribbl_secrets from authenticated, anon;

-- Saves one decision of the rules in one go: the room (only if its step is still p_step, then step + 1), the
-- players that changed, the secret, and new chat lines. With p_room_row null the room isn't changed, but the step
-- must still match (and a concurrent change is waited for), so chat can't be judged against a word that's gone.
-- Returns false, changing nothing, when another write got there first: the server reads again and retries.
create or replace function public.skribbl_apply(p_room uuid, p_step integer, p_room_row jsonb, p_players jsonb, p_secret jsonb, p_messages jsonb)
  returns boolean
  language plpgsql security definer set search_path = ''
as $$
begin
  if p_room_row is not null then
    update public.skribbl_rooms r
       set host = x.host, settings = x.settings, status = x.status, round = x.round, drawer = x.drawer, drawn = x.drawn,
           turn_started_at = x.turn_started_at, phase_ends_at = x.phase_ends_at, mask = x.mask, last_word = x.last_word,
           step = p_step + 1, updated_at = now()
      from jsonb_populate_record(null::public.skribbl_rooms, p_room_row) x
     where r.id = p_room and r.step = p_step;
    if not found then return false; end if;
  else
    perform 1 from public.skribbl_rooms where id = p_room and step = p_step for share;
    if not found then return false; end if;
  end if;

  if p_players is not null and jsonb_array_length(p_players) > 0 then
    insert into public.skribbl_players (room, user_id, name, hue, score, turn_points, guessed_at, vote, gone, kicked, joined_at)
    select p_room, x.user_id, x.name, x.hue, x.score, x.turn_points, x.guessed_at, x.vote, x.gone, x.kicked, coalesce(x.joined_at, now())
      from jsonb_populate_recordset(null::public.skribbl_players, p_players) x
    on conflict (room, user_id) do update
       set name = excluded.name, hue = excluded.hue, score = excluded.score, turn_points = excluded.turn_points,
           guessed_at = excluded.guessed_at, vote = excluded.vote, gone = excluded.gone, kicked = excluded.kicked;
  end if;

  if p_secret is not null then
    insert into public.skribbl_secrets (room, word, choices, used, custom)
    select p_room, x.word, coalesce(x.choices, '{}'), coalesce(x.used, '{}'), coalesce(x.custom, '{}')
      from jsonb_populate_record(null::public.skribbl_secrets, p_secret) x
    on conflict (room) do update set word = excluded.word, choices = excluded.choices, used = excluded.used, custom = excluded.custom;
  end if;

  if p_messages is not null and jsonb_array_length(p_messages) > 0 then
    insert into public.skribbl_messages (room, user_id, name, body, kind, audience, to_users)
    select p_room, x.user_id, x.name, x.body, x.kind, coalesce(x.audience, 'all'), coalesce(x.to_users, '{}')
      from jsonb_populate_recordset(null::public.skribbl_messages, p_messages) x;
  end if;
  return true;
end;
$$;
revoke execute on function public.skribbl_apply(uuid, integer, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.skribbl_apply(uuid, integer, jsonb, jsonb, jsonb, jsonb) to service_role;

-- Live room, players and chat over Supabase Realtime (each subscriber only gets rows the policies above let it read).
do $$
declare
  t text;
begin
  foreach t in array array['skribbl_rooms', 'skribbl_players', 'skribbl_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
