"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase/client";
import type { Action, TankGame } from "./rules";
import type { Side } from "./world";

// Online battles live in public.tank_games. Everything that changes one goes through /api/tanks (the server
// simulates the shots, lib/tanks/rules.ts); players only read their own rows, live over Supabase Realtime.

export type { TankGame } from "./rules";

async function userId() {
  const { data } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  };
  return data.session?.user.id ?? null;
}

/** Opens a battle with you on the left tank. Returns its id (the link is /extras/tanks/<id>). */
export async function createBattle(name: string) {
  if (!supabase) throw new Error("Accounts aren't set up, so online battles aren't available.");
  const res = await fetch("/api/tanks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
  };
  if (!body.id) throw new Error(body.error ?? "Couldn't open a battle.");
  return body.id;
}

/** Your battles, newest first, plus your user id (to tell which tank is yours). Cancelled ones are left out. */
export async function myBattles(limit = 6): Promise<{ me: string | null; games: TankGame[] }> {
  const me = supabase ? await userId() : null;
  if (!supabase || !me) return { me, games: [] };
  const { data } = await supabase
    .from("tank_games")
    .select("id, p1, p2, p1_name, p2_name, status, winner, reason, step, next, moved_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit + 4);
  return {
    me,
    games: ((data ?? []) as TankGame[]).filter((g) => g.reason !== "cancelled").slice(0, limit),
  };
}

/** Loads (or joins) battle `id` and keeps it live. `act` plays your actions through the server. */
export function useBattle(id: string | undefined, name: string) {
  const [row, setRow] = useState<TankGame | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Why your last action didn't go through. Cleared by the next one that does. */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef<TankGame | null>(null);
  // The server's clock, from the answer with the shortest round trip: the turn timer counts with it.
  const offset = useRef(0);
  const bestRtt = useRef(Infinity);
  const sync = useCallback((sent: number, server: unknown) => {
    const back = Date.now();
    if (typeof server !== "number" || back - sent > bestRtt.current) return;
    bestRtt.current = back - sent;
    offset.current = server - (sent + back) / 2;
  }, []);
  const now = useCallback(() => Date.now() + offset.current, []);

  const apply = useCallback((next: TankGame) => {
    // A late Realtime event can arrive after a newer copy from the server: keep the newer one.
    const prev = latest.current;
    if (prev && prev.id === next.id && (next.step < prev.step || (next.step === prev.step && Date.parse(next.updated_at) < Date.parse(prev.updated_at)))) return;
    latest.current = next;
    setRow(next);
  }, []);

  const post = useCallback(
    async (action: Action) => {
      const sent = Date.now();
      const res = await fetch(`/api/tanks/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = (await res.json().catch(() => ({}))) as {
        game?: TankGame;
        error?: string;
        next?: string;
        now?: number;
      };
      sync(sent, body.now);
      if (body.game) apply(body.game);
      return { ok: res.ok, ...body };
    },
    [id, apply, sync],
  );

  const refresh = useCallback(async () => {
    if (!supabase || !id) return;
    const { data } = await supabase.from("tank_games").select("*").eq("id", id).maybeSingle();
    if (data) apply(data as TankGame);
  }, [id, apply]);

  useEffect(() => {
    if (!id) return;
    const sb = supabase;
    if (!sb) return setError("Accounts aren't set up, so online battles aren't available.");
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      const uid = await userId();
      if (!uid) return setError("Sign in to play online.");
      setMe(uid);
      // Your own battle loads directly; someone else's open one is joined (which also returns it).
      const { data } = await sb.from("tank_games").select("*").eq("id", id).maybeSingle();
      if (data) apply(data as TankGame);
      else {
        const joined = await post({ type: "join", name }).catch(() => null);
        if (cancelled) return;
        if (!joined?.game) return setError(joined?.error ? `Can't join: ${joined.error}` : "This battle doesn't exist.");
      }
      if (cancelled) return;
      const sent = Date.now();
      fetch(`/api/tanks/${id}`)
        .then((r) => r.json())
        .then((b: { now?: number }) => sync(sent, b.now))
        .catch(() => {});
      channel = sb
        .channel(`tanks:${id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "tank_games",
            filter: `id=eq.${id}`,
          },
          (p) => apply(p.new as TankGame),
        )
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
    // Only the battle id matters: `name` is used once, for joining.
  }, [id]);

  /**
   * Plays `action` on the server. Returns whether it went through (and a rematch's id); if not, `notice` says why.
   * A reported timeout is the app's own business: no busy state and no notice.
   */
  const act = useCallback(
    async (action: Action): Promise<{ ok: boolean; next?: string }> => {
      const quiet = action.type === "timeout";
      if (!quiet) setBusy(true);
      try {
        const res = await post(action);
        if (res.ok) {
          if (!quiet) setNotice(null);
          return { ok: true, next: res.next };
        }
        if (!quiet) setNotice(res.error ?? "that didn't go through. try again.");
      } catch {
        if (!quiet) setNotice("couldn't reach the server. try again.");
        // The write may still have landed (only the answer got lost): catch up.
        refresh().catch(() => {});
      } finally {
        if (!quiet) setBusy(false);
      }
      return { ok: false };
    },
    [post, refresh],
  );

  const side: Side | null = row && me ? (row.p1 === me ? 0 : row.p2 === me ? 1 : null) : null;
  return { row, me, side, error, notice, busy, act, refresh, now };
}
