"use client";

import type { Chess, Color } from "chess.js";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { supabase } from "../supabase/client";

// Online games live in public.chess_games (supabase/migrations/20261005210000_chess.sql). The row holds the PGN;
// each client replays it with chess.js. Every write is guarded by the ply it was based on, so two devices can't
// overwrite each other: a write that lost the race is dropped and the board reloads from the server.

export interface OnlineGame {
  id: string;
  white: string;
  black: string | null;
  white_name: string;
  black_name: string;
  pgn: string;
  ply: number;
  status: "waiting" | "active" | "over";
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  reason: string | null;
  updated_at: string;
}

const COLUMNS = "id, white, black, white_name, black_name, pgn, ply, status, result, reason, updated_at";

async function userId() {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.user.id ?? null;
}

/** Creates a game with you as white. Returns its id (the link is /extras/chess/<id>). */
export async function createGame(name: string) {
  if (!supabase) throw new Error("Accounts aren't set up, so online games aren't available.");
  const me = await userId();
  if (!me) throw new Error("Sign in to play online.");
  const { data, error } = await supabase.from("chess_games").insert({ white: me, white_name: name.slice(0, 40) }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Your games, newest first, plus your user id (to tell which side you're on). */
export async function myGames(limit = 6): Promise<{ me: string | null; games: OnlineGame[] }> {
  const me = supabase ? await userId() : null;
  if (!supabase || !me) return { me, games: [] };
  const { data } = await supabase.from("chess_games").select(COLUMNS).order("updated_at", { ascending: false }).limit(limit);
  return { me, games: (data ?? []) as OnlineGame[] };
}

/** Replays a game's PGN onto the board if it differs from what's shown. */
function replay(game: Chess, pgn: string) {
  if (game.history().length === 0 && !pgn) return;
  game.reset();
  if (pgn) game.loadPgn(pgn);
}

/**
 * Loads (or joins) game `id`, keeps `game` in sync with the server live, and sends your moves.
 * `onChange` re-renders the board after a remote update.
 */
export function useOnlineGame(id: string | undefined, name: string, game: RefObject<Chess>, onChange: () => void) {
  const [row, setRow] = useState<OnlineGame | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<OnlineGame | null>(null);

  const apply = useCallback(
    (next: OnlineGame) => {
      latest.current = next;
      if (next.ply !== game.current.history().length) replay(game.current, next.pgn);
      setRow(next);
      onChange();
    },
    [game, onChange],
  );

  const refresh = useCallback(async () => {
    if (!supabase || !id) return;
    const { data } = await supabase.from("chess_games").select(COLUMNS).eq("id", id).maybeSingle();
    if (data) apply(data as OnlineGame);
  }, [id, apply]);

  useEffect(() => {
    if (!id) return;
    const sb = supabase;
    if (!sb) return setError("Accounts aren't set up, so online games aren't available.");
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      const uid = await userId();
      if (!uid) return setError("Sign in to play online.");
      setMe(uid);
      // Your own game loads directly; someone else's open game is joined (which also returns it).
      let { data } = await sb.from("chess_games").select(COLUMNS).eq("id", id).maybeSingle();
      if (!data) {
        const joined = await sb.rpc("join_chess_game", { game: id, name: name.slice(0, 40) });
        data = joined.data?.id ? joined.data : null;
      }
      if (cancelled) return;
      if (!data) return setError("This game doesn't exist, or two players are already in it.");
      apply(data as OnlineGame);
      channel = sb
        .channel(`chess:${id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chess_games", filter: `id=eq.${id}` }, (p) => apply(p.new as OnlineGame))
        // A dropped connection can miss updates: catch up whenever the channel (re)connects.
        .subscribe((status) => {
          if (status === "SUBSCRIBED") refresh();
        });
    })();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) sb.removeChannel(channel);
    };
    // Only the game id matters: `name` is used once, for joining.
  }, [id]);

  /** Saves the board after your move (or a resignation). Returns false if the other side moved first. */
  const send = useCallback(
    async (patch: Partial<Pick<OnlineGame, "status" | "result" | "reason">> = {}, basePly?: number) => {
      const current = latest.current;
      if (!supabase || !current) return false;
      const g = game.current;
      const ply = g.history().length;
      const { data, error: err } = await supabase
        .from("chess_games")
        .update({ pgn: g.pgn(), ply, ...patch, updated_at: new Date().toISOString() })
        .eq("id", current.id)
        .eq("ply", basePly ?? current.ply)
        .select(COLUMNS)
        .maybeSingle();
      if (err || !data) {
        await refresh();
        return false;
      }
      apply(data as OnlineGame);
      return true;
    },
    [game, apply, refresh],
  );

  const color: Color | null = row && me ? (row.white === me ? "w" : row.black === me ? "b" : null) : null;
  return { row, me, color, error, send };
}
