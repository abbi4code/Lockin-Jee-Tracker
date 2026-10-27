-- Online tank battles (/extras/tanks/<id>): one row per battle between two signed-in players. p1 makes the battle
-- and shares the link; whoever opens it first becomes p2. `world` is the whole battlefield (ground heights, tanks,
-- wind, whose turn); the server simulates every shot (src/lib/tanks/world.ts) and writes the result. Players can
-- only read their own battles: creating, joining, shooting, resigning and rematches all go through /api/tanks,
-- which writes with the secret key. Safe to re-run.

create table if not exists public.tank_games (
  id          uuid primary key default gen_random_uuid(),
  p1          uuid not null references auth.users (id) on delete cascade,
  p2          uuid references auth.users (id) on delete cascade,
  p1_name     text not null default '',
  p2_name     text not null default '',
  status      text not null default 'waiting' check (status in ('waiting', 'active', 'over')),
  winner      smallint check (winner in (0, 1)),       -- 0: p1's tank, 1: p2's; null: a draw (or unfinished)
  reason      text,                                     -- destroyed, resigned, left the battle, cancelled, ...
  step        integer not null default 0 check (step >= 0),  -- bumped by every change; the write guard
  world       jsonb not null,
  last        jsonb,                                    -- the last change, so the other app can play it
  next        uuid references public.tank_games (id) on delete set null,  -- the rematch
  moved_at    timestamptz not null default now(),       -- when the current turn started
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tank_games_p1 on public.tank_games (p1, updated_at desc);
create index if not exists tank_games_p2 on public.tank_games (p2, updated_at desc);

alter table public.tank_games enable row level security;

-- Players see only their own battles. Open battles can't be listed: the link (an unguessable id) is the way in.
drop policy if exists "players read" on public.tank_games;
create policy "players read" on public.tank_games
  for select using ((select auth.uid()) in (p1, p2));

-- No direct writes: the server does them all.
revoke insert, update, delete on public.tank_games from authenticated, anon;

-- Live shots over Supabase Realtime.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tank_games') then
    alter publication supabase_realtime add table public.tank_games;
  end if;
end $$;
