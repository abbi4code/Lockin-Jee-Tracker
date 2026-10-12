"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase/client";

// Who's in the app right now (Realtime presence) and when they were last (public.chat_presence), for the
// chat header: "online" / "last seen 4:12 pm". One presence channel for everyone signed in; each app tracks
// itself only while it's on screen, so "online" means looking at the app, like WhatsApp.

interface Here {
  admin: boolean;
}

let here = new Map<string, Here>();
/** When someone dropped off presence while we watched: fresher than their last saved heartbeat. */
const leftAt = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const HEARTBEAT_MS = 60_000;
let started: string | null = null;

async function saveLastSeen(userId: string) {
  if (!supabase) return;
  // Before the chat-status migration the table doesn't exist: nothing to save, and that's fine.
  await supabase.from("chat_presence").upsert({ user_id: userId, last_seen: new Date().toISOString() });
}

/** Joins presence for this signed-in user (once per app load). */
export function startPresence(userId: string, isAdmin: boolean) {
  if (!supabase || started === userId) return;
  started = userId;
  const sb = supabase;
  const channel = sb.channel("online", { config: { presence: { key: userId } } });
  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Here>();
      const next = new Map<string, Here>();
      for (const [key, metas] of Object.entries(state)) next.set(key, { admin: !!metas[0]?.admin });
      for (const key of here.keys()) if (!next.has(key)) leftAt.set(key, Date.now());
      here = next;
      emit();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && document.visibilityState === "visible") channel.track({ admin: isAdmin });
    });

  saveLastSeen(userId);
  let beat = setInterval(() => saveLastSeen(userId), HEARTBEAT_MS);
  document.addEventListener("visibilitychange", () => {
    saveLastSeen(userId);
    clearInterval(beat);
    if (document.visibilityState === "visible") {
      channel.track({ admin: isAdmin });
      beat = setInterval(() => saveLastSeen(userId), HEARTBEAT_MS);
    } else channel.untrack();
  });
}

/**
 * The other side of a thread. Student (otherId = null): the coaches, online if any admin is, last seen = the
 * latest of theirs. Admin: the student with id `otherId`.
 */
export function useOtherStatus(meId: string | null, otherId: string | null) {
  const [, force] = useState(0);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  const others = [...here.entries()].filter(([id, h]) => id !== meId && (otherId ? id === otherId : h.admin));
  const online = others.length > 0;

  // Re-read the saved last seen whenever someone comes or goes.
  const presenceKey = [...here.keys()].sort().join(",");
  useEffect(() => {
    if (!supabase || !meId) return;
    let alive = true;
    let q = supabase.from("chat_presence").select("user_id, last_seen").neq("user_id", meId);
    if (otherId) q = q.eq("user_id", otherId);
    q.then(({ data }) => {
      if (!alive) return;
      const times = (data ?? []).map((r) => new Date(r.last_seen as string).getTime());
      setSaved(times.length ? Math.max(...times) : null);
    });
    return () => {
      alive = false;
    };
  }, [meId, otherId, presenceKey]);

  // Someone we saw leave: that moment beats a heartbeat up to a minute old.
  const watched = otherId ? [leftAt.get(otherId)] : [...leftAt.entries()].filter(([id]) => id !== meId).map(([, t]) => t);
  const left = Math.max(0, ...watched.filter((t): t is number => t != null));
  const lastSeen = Math.max(saved ?? 0, left) || null;
  return { online, lastSeen };
}

/** Everyone online right now (admin inbox dots). */
export function useOnlineIds() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return new Set(here.keys());
}

/** "last seen today 4:12 pm" / "yesterday 9:10 pm" / "10 oct". */
export function lastSeenLabel(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const day = (x: Date) => x.toLocaleDateString("en-CA");
  const yesterday = new Date(now - 86_400_000);
  if (now - ms < 60_000) return "last seen just now";
  if (day(d) === day(new Date(now))) return `last seen today ${time}`;
  if (day(d) === day(yesterday)) return `last seen yesterday ${time}`;
  return `last seen ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toLowerCase()}`;
}
