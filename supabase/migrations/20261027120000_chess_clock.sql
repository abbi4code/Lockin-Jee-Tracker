-- Chess clocks for online games (/extras/chess/<id>). A game can have a time control, e.g. 3+2: 180 seconds each
-- (time_base) plus 2 seconds after every move (time_inc). white_ms / black_ms are each side's time left as of
-- moved_at; the side to move has been using its time since then. The server's referee (/api/chess/[id],
-- src/lib/chess/rules.ts) takes the time off on every move, and ends the game when a clock runs out. Games without
-- a clock have time_base null and play as before. Safe to re-run.

alter table public.chess_games add column if not exists time_base integer check (time_base is null or time_base between 30 and 3600);
alter table public.chess_games add column if not exists time_inc integer not null default 0 check (time_inc between 0 and 60);
alter table public.chess_games add column if not exists white_ms integer check (white_ms >= 0);
alter table public.chess_games add column if not exists black_ms integer check (black_ms >= 0);

-- A new game starts empty, and a timed one with both clocks full: you can't give yourself extra time.
drop policy if exists "create as white" on public.chess_games;
create policy "create as white" on public.chess_games
  for insert with check (
    white = (select auth.uid()) and black is null and status = 'waiting' and ply = 0 and pgn = '' and result is null and draw_offer is null
    and (
      (time_base is null and white_ms is null and black_ms is null)
      or (white_ms = time_base * 1000 and black_ms = time_base * 1000)
    )
  );
