"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase/client";
import { nextDeadline, type Action, type Message, type Player, type Room } from "./rules";

// One skribbl room in the browser: joins it, keeps the room, players and chat live over Supabase Realtime, sends
// actions to /api/skribbl/[code], and runs the clock. The same channel carries the drawing (broadcast) and who's
// connected (presence). See rules.ts for the game itself.

/** What only this player may see, fetched from the server: the drawer's words, the host's custom words. */
export interface Private {
  choices: string[];
  word: string | null;
  custom: string[] | null;
}

type Listener = (payload: Record<string, unknown>) => void;
type Channel = ReturnType<NonNullable<typeof supabase>["channel"]>;
const MESSAGES = 150;

/** Creates a room and returns its code. */
export async function createRoom(name: string) {
  const res = await fetch("/api/skribbl", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!body.code) throw new Error(body.error ?? "couldn't open a room. try again.");
  return body.code;
}

/** Rooms you're in that haven't finished, newest first. */
export async function myRooms(): Promise<{ code: string; status: Room["status"]; updated_at: string }[]> {
  const sb = supabase;
  if (!sb) return [];
  const { data } = await sb.auth.getSession();
  const me = data.session?.user.id;
  if (!me) return [];
  const { data: rows } = await sb.from("skribbl_players").select("skribbl_rooms(code, status, updated_at)").eq("user_id", me).eq("gone", false).limit(20);
  return ((rows ?? []) as unknown as { skribbl_rooms: { code: string; status: Room["status"]; updated_at: string } | null }[])
    .map((r) => r.skribbl_rooms)
    .filter((r): r is NonNullable<typeof r> => !!r && r.status !== "over")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
}

export function useSkribbl(code: string, name: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [secret, setSecret] = useState<Private>({ choices: [], word: null, custom: null });
  /** Can't play here at all (not signed in, removed, full, no such room). */
  const [fatal, setFatal] = useState<string | null>(null);
  /** A refused action, shown for a moment. */
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const offset = useRef(0);
  const bestRtt = useRef(Infinity);
  const channel = useRef<Channel | null>(null);
  const listeners = useRef(new Set<Listener>());
  const roomRef = useRef<Room | null>(null);

  /** The server's clock, estimated from the request with the shortest round trip. */
  const now = useCallback(() => Date.now() + offset.current, []);
  const clock = (sent: number, server: unknown) => {
    const back = Date.now();
    if (typeof server !== "number" || back - sent > bestRtt.current) return;
    bestRtt.current = back - sent;
    offset.current = server - (sent + back) / 2;
  };

  // Realtime can deliver an older row after a newer one: the step decides.
  const applyRoom = useCallback((next: Room | null | undefined) => {
    if (!next) return;
    const prev = roomRef.current;
    if (prev && prev.id === next.id && next.step < prev.step) return;
    roomRef.current = next;
    setRoom(next);
  }, []);
  const upsertPlayers = useCallback((rows: Player[], replace = false) => {
    setPlayers((prev) => {
      const map = new Map((replace ? [] : prev).map((p) => [p.user_id, p]));
      for (const p of rows) map.set(p.user_id, p);
      return [...map.values()];
    });
  }, []);
  const addMessages = useCallback((rows: Message[], replace = false) => {
    setMessages((prev) => {
      const map = new Map((replace ? [] : prev).map((m) => [m.id, m]));
      for (const m of rows) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.id - b.id).slice(-MESSAGES);
    });
  }, []);

  const refresh = useCallback(
    async (roomId: string) => {
      const sb = supabase;
      if (!sb) return;
      const [r, p, m] = await Promise.all([
        sb.from("skribbl_rooms").select("*").eq("id", roomId).maybeSingle(),
        sb.from("skribbl_players").select("*").eq("room", roomId),
        sb.from("skribbl_messages").select("*").eq("room", roomId).order("id", { ascending: false }).limit(MESSAGES),
      ]);
      if (r.data) applyRoom(r.data as Room);
      if (p.data) upsertPlayers(p.data as Player[], true);
      if (m.data) addMessages(m.data as Message[], true);
    },
    [applyRoom, upsertPlayers, addMessages],
  );

  const post = useCallback(
    async (action: Action): Promise<{ error?: string }> => {
      const sent = Date.now();
      try {
        const res = await fetch(`/api/skribbl/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
        const body = (await res.json().catch(() => ({}))) as { room?: Room; error?: string; now?: number };
        clock(sent, body.now);
        applyRoom(body.room);
        return { error: body.error ?? (res.ok ? undefined : "something went wrong. try again.") };
      } catch {
        return { error: "couldn't reach the server. check your connection." };
      }
    },
    [code, applyRoom],
  );

  /** Sends an action; a refusal shows for a few seconds (except the clock's own "not yet"). */
  const act = useCallback(
    async (action: Action) => {
      const { error } = await post(action);
      if (error && action.type !== "tick") {
        setNotice(error);
        window.setTimeout(() => setNotice((n) => (n === error ? null : n)), 3500);
      }
      return !error;
    },
    [post],
  );

  // Join, load, and listen.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return setFatal("accounts aren't set up here, so skribbl isn't available.");
    let cancelled = false;
    let ch: Channel | null = null;
    let roomId: string | null = null;
    (async () => {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return setFatal("sign in to play.");
      setMe(uid);
      const sent = Date.now();
      const res = await fetch(`/api/skribbl/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "join", name }) }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { room?: Room; error?: string; now?: number } | undefined;
      if (cancelled) return;
      if (!body?.room) return setFatal(body?.error ?? "couldn't reach the server. check your connection.");
      clock(sent, body.now);
      applyRoom(body.room);
      roomId = body.room.id;
      const id = roomId;
      ch = sb
        .channel(`skribbl:${code}`, { config: { presence: { key: uid }, broadcast: { self: false } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "skribbl_rooms", filter: `id=eq.${id}` }, (p) => applyRoom(p.new as Room))
        .on("postgres_changes", { event: "*", schema: "public", table: "skribbl_players", filter: `room=eq.${id}` }, (p) => {
          if (p.new && "user_id" in p.new) upsertPlayers([p.new as Player]);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "skribbl_messages", filter: `room=eq.${id}` }, (p) => addMessages([p.new as Message]))
        .on("broadcast", { event: "draw" }, ({ payload }) => listeners.current.forEach((l) => l(payload as Record<string, unknown>)))
        .on("presence", { event: "sync" }, () => setOnline(new Set(Object.keys(ch!.presenceState()))))
        .subscribe((status) => {
          setConnected(status === "SUBSCRIBED");
          // A dropped connection can miss changes: catch up whenever the channel (re)connects.
          if (status === "SUBSCRIBED") {
            refresh(id);
            ch!.track({ at: Date.now() });
          }
        });
      channel.current = ch;
    })();
    const onVisible = () => {
      if (document.visibilityState === "visible" && roomId) refresh(roomId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (ch) sb.removeChannel(ch);
      channel.current = null;
    };
    // Only the room code matters: `name` is used once, for joining.
  }, [code]);

  // The drawer's words and the host's custom words come from the server, only to them.
  const host = !!room && room.host === me;
  const drawing = !!room && room.drawer === me && (room.status === "choosing" || room.status === "drawing");
  const privateKey = room && me ? `${room.status}|${room.drawer}|${room.turn_started_at}|${host}` : null;
  useEffect(() => {
    if (!privateKey) return;
    if (!drawing && !host) return setSecret({ choices: [], word: null, custom: null });
    let stale = false;
    const sent = Date.now();
    fetch(`/api/skribbl/${code}`)
      .then((r) => r.json())
      .then((b: Private & { now?: number }) => {
        clock(sent, b.now);
        if (!stale) setSecret({ choices: b.choices ?? [], word: b.word ?? null, custom: b.custom ?? null });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [privateKey]);

  // The clock: when the next deadline passes (a hint, the end of a phase), tell the server. Every app does; the
  // server acts once. A "not yet" (clocks a little apart) comes back with the room as the server has it, and tries
  // again a second later.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!room) return;
    const at = nextDeadline(room);
    if (at == null || Number.isNaN(at)) return;
    const wait = Math.max(0, at - now() + 250 + Math.random() * 600);
    const t = window.setTimeout(async () => {
      const { error } = await post({ type: "tick" });
      if (error === "not yet.") window.setTimeout(() => setRetry((n) => n + 1), 1000);
    }, wait);
    return () => window.clearTimeout(t);
  }, [room, retry, now, post]);

  const sendDraw = useCallback((payload: Record<string, unknown>) => {
    channel.current?.send({ type: "broadcast", event: "draw", payload });
  }, []);
  const onDraw = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);

  return { room, players, messages, me, online, secret, setSecret, fatal, notice, connected, now, act, sendDraw, onDraw };
}

export type Skribbl = ReturnType<typeof useSkribbl>;
