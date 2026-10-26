"use client";

import type { Chess, Color } from "chess.js";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { supabase } from "../supabase/client";
import type { Action, OnlineGame } from "./rules";

// Online games live in public.chess_games. The row holds the PGN; each client replays it with chess.js. Players
// create and join games directly, but every move or result goes through /api/chess/[id], which checks it with
// chess.js before writing (lib/chess/rules.ts). Live updates come over Supabase Realtime.

export type { OnlineGame } from "./rules";

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

/** Your games, newest first, plus your user id (to tell which side you're on). Cancelled games are left out. */
export async function myGames(limit = 6): Promise<{ me: string | null; games: OnlineGame[] }> {
  const me = supabase ? await userId() : null;
  if (!supabase || !me) return { me, games: [] };
  const { data } = await supabase.from("chess_games").select("*").order("updated_at", { ascending: false }).limit(limit + 4);
  return { me, games: ((data ?? []) as OnlineGame[]).filter((g) => g.reason !== "cancelled").slice(0, limit) };
}

/** Replays a game's PGN onto the board. */
function replay(game: Chess, pgn: string) {
  if (game.history().length === 0 && !pgn) return;
  game.reset();
  if (pgn) game.loadPgn(pgn);
}

/** Whether a move sent at `action.ply` is on the server's copy (the game moved past the ply it was played at). */
export function moveLanded(action: Action, saved: OnlineGame | null) {
  return action.type === "move" && !!saved && saved.ply > action.ply;
}

/**
 * Loads (or joins) game `id`, keeps `game` in sync with the server live, and plays your actions.
 * `onChange` re-renders the board after a remote update.
 */
export function useOnlineGame(id: string | undefined, name: string, game: RefObject<Chess>, onChange: () => void) {
  const [row, setRow] = useState<OnlineGame | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Why your last action didn't go through. Cleared by the next one that does. */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef<OnlineGame | null>(null);

  const apply = useCallback(
    (next: OnlineGame) => {
      // A late Realtime event can arrive after a newer copy from the server: keep the newer one.
      const prev = latest.current;
      if (prev && prev.id === next.id && Date.parse(next.updated_at) < Date.parse(prev.updated_at)) return;
      latest.current = next;
      if (next.ply !== game.current.history().length) replay(game.current, next.pgn);
      setRow(next);
      onChange();
    },
    [game, onChange],
  );

  const refresh = useCallback(async () => {
    if (!supabase || !id) return;
    const { data } = await supabase.from("chess_games").select("*").eq("id", id).maybeSingle();
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
      let { data } = await sb.from("chess_games").select("*").eq("id", id).maybeSingle();
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

  /**
   * Plays `action` on the server. A move is already on the local board; if it's refused or never arrives, the
   * board goes back to the last saved position and `notice` says why. Returns whether it went through.
   */
  const act = useCallback(
    async (action: Action) => {
      const current = latest.current;
      if (!current) return false;
      setBusy(true);
      let message = "couldn't reach the server. your move wasn't sent. try again.";
      let answered = false;
      try {
        const res = await fetch(`/api/chess/${current.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
        const body = (await res.json().catch(() => ({}))) as { game?: OnlineGame; error?: string };
        if (body.game) {
          answered = true;
          apply(body.game);
        }
        if (res.ok && body.game) {
          setNotice(null);
          setBusy(false);
          return true;
        }
        if (body.error) message = body.error;
      } catch {
        // Offline, or the request died: the message above says so.
      }
      // No game in the answer: the write may still have landed (only the response got lost), so check first.
      if (!answered) {
        try {
          await refresh();
        } catch {
          // Still offline: fall through to putting the board back.
        }
      }
      setBusy(false);
      if (moveLanded(action, latest.current)) {
        setNotice(null);
        return true;
      }
      if (latest.current) {
        replay(game.current, latest.current.pgn);
        onChange();
      }
      setNotice(message);
      return false;
    },
    [game, apply, refresh, onChange],
  );

  const color: Color | null = row && me ? (row.white === me ? "w" : row.black === me ? "b" : null) : null;
  return { row, me, color, error, notice, busy, act, refresh };
}
