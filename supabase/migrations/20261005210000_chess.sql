-- Online chess (/extras/chess/<game id>): one row per game between two signed-in players.
-- White creates the game and shares the link; whoever opens it first takes the black seat. Safe to re-run.

create table if not exists public.chess_games (
  id          uuid primary key default gen_random_uuid(),
  white       uuid not null references auth.users (id) on delete cascade,
  black       uuid references auth.users (id) on delete cascade,
  white_name  text not null default '',
  black_name  text not null default '',
  pgn         text not null default '',   -- the whole game; the app replays it with chess.js
  ply         integer not null default 0 check (ply >= 0),  -- half-moves played; also the write guard
  status      text not null default 'waiting' check (status in ('waiting', 'active', 'over')),
  result      text check (result in ('1-0', '0-1', '1/2-1/2')),
  reason      text,                        -- checkmate, resignation, stalemate, repetition, ...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chess_games_white on public.chess_games (white, updated_at desc);
create index if not exists chess_games_black on public.chess_games (black, updated_at desc);

alter table public.chess_games enable row level security;

-- Players see only their own games. Open games can't be listed: the link (an unguessable id) plus
-- join_chess_game below is the only way in.
drop policy if exists "players read" on public.chess_games;
create policy "players read" on public.chess_games
  for select using ((select auth.uid()) in (white, black));

drop policy if exists "create as white" on public.chess_games;
create policy "create as white" on public.chess_games
  for insert with check (white = (select auth.uid()) and black is null);

-- Players record moves and results. The seats and names can't be changed by an update.
drop policy if exists "players move" on public.chess_games;
create policy "players move" on public.chess_games
  for update using ((select auth.uid()) in (white, black))
  with check ((select auth.uid()) in (white, black));
revoke update on public.chess_games from authenticated, anon;
grant update (pgn, ply, status, result, reason, updated_at) on public.chess_games to authenticated;

-- Takes the black seat of an open game (not your own). Returns the game if you're in it, else null.
create or replace function public.join_chess_game(game uuid, name text) returns public.chess_games
  language plpgsql security definer set search_path = ''
as $$
declare
  g public.chess_games;
begin
  update public.chess_games
     set black = auth.uid(), black_name = left(coalesce(name, ''), 40), status = 'active', updated_at = now()
   where id = game and black is null and white <> auth.uid() and auth.uid() is not null
  returning * into g;
  if g.id is null then
    select * into g from public.chess_games where id = game and auth.uid() in (white, black);
  end if;
  return g;
end;
$$;
revoke execute on function public.join_chess_game(uuid, text) from public, anon;
grant execute on function public.join_chess_game(uuid, text) to authenticated;

-- Live moves over Supabase Realtime.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chess_games') then
    alter publication supabase_realtime add table public.chess_games;
  end if;
end $$;
