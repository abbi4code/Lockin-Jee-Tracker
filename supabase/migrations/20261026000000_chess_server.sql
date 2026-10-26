-- Online chess, refereed by the server. Until now either player could write any pgn, ply or result straight into
-- public.chess_games, so a player could move on the other's turn or declare themselves the winner. Now players
-- only create and join games; every move, resignation, draw offer and claim goes through /api/chess/[id], which
-- replays the game with chess.js and writes with the secret key. Also adds draw offers and abandoned-game claims.
-- Safe to re-run.

alter table public.chess_games add column if not exists draw_offer text check (draw_offer in ('w', 'b'));
-- When the game last moved: the side to move has been waiting since then (abandonment claims after 3 days).
alter table public.chess_games add column if not exists moved_at timestamptz;
update public.chess_games set moved_at = updated_at where moved_at is null;
alter table public.chess_games alter column moved_at set default now();

-- No direct writes after creation.
drop policy if exists "players move" on public.chess_games;
revoke update on public.chess_games from authenticated, anon;
revoke update (pgn, ply, status, result, reason, updated_at) on public.chess_games from authenticated, anon;

-- A new game starts empty: you can't create one that's already under way or decided.
drop policy if exists "create as white" on public.chess_games;
create policy "create as white" on public.chess_games
  for insert with check (
    white = (select auth.uid()) and black is null and status = 'waiting' and ply = 0 and pgn = '' and result is null and draw_offer is null
  );

-- Takes the black seat of an open game (not your own, not a cancelled one). Returns the game if you're in it, else null.
create or replace function public.join_chess_game(game uuid, name text) returns public.chess_games
  language plpgsql security definer set search_path = ''
as $$
declare
  g public.chess_games;
begin
  update public.chess_games
     set black = auth.uid(), black_name = left(coalesce(name, ''), 40), status = 'active', moved_at = now(), updated_at = now()
   where id = game and black is null and status = 'waiting' and white <> auth.uid() and auth.uid() is not null
  returning * into g;
  if g.id is null then
    select * into g from public.chess_games where id = game and auth.uid() in (white, black);
  end if;
  return g;
end;
$$;
revoke execute on function public.join_chess_game(uuid, text) from public, anon;
grant execute on function public.join_chess_game(uuid, text) to authenticated;
