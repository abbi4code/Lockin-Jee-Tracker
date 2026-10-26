"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabaseBackend } from "../../lib/call/backend";
import { AWAY_GRACE_MS, othersIn, pickIncoming, pickRejoin, type Invitee, type MemberRow } from "../../lib/call/calls";
import { CallSession, IDLE, type CallBackend, type SessionState } from "../../lib/call/session";
import { useSync } from "../../lib/sync";
import { supabase } from "../../lib/supabase/client";
import { useProgress } from "../../store/progress";
import { CallWindow } from "./CallWindow";
import { IncomingCall } from "./IncomingCall";

// Calls anywhere in the app. Mounted once in Providers (around every page, the admin panel included), so a call
// keeps going while you move between pages. Starting points (a chat, a game) use `useCall()`; the call itself
// shows in one floating window and rings arrive as a banner, wherever you are.

export interface Ring {
  call: string;
  /** Who's calling, and from where ("coach:<id>", "chess:<id>", …). */
  from: string;
  context: string;
}

export interface CallApi {
  me: string;
  state: SessionState;
  /** The context you last tried to call from, so the button there can show what happened. */
  lastContext: string | null;
  ring: Ring | null;
  /** A call this page dropped out of (a reload, a crash) that's still going. */
  rejoin: { call: string } | null;
  start(context: string, invitees: Invitee[]): void;
  accept(): void;
  decline(): void;
  rejoinNow(): void;
  dismissRejoin(): void;
  leave(): void;
  toggleMic(): void;
  toggleCam(): void;
  clearNotice(): void;
  /** Brings the call window back up (from a button elsewhere). */
  reveal(): void;
  revealed: number;
}

const Ctx = createContext<CallApi | null>(null);

/** The call this tab was in when it closed or reloaded, so the reloaded page can offer the way back. */
const DROPPED_KEY = "lockin-call-dropped";
function readDropped(): { call: string; at: number } | null {
  try {
    return JSON.parse(sessionStorage.getItem(DROPPED_KEY) ?? "null");
  } catch {
    return null;
  }
}
function writeDropped(v: { call: string; at: number } | null) {
  try {
    if (v) sessionStorage.setItem(DROPPED_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(DROPPED_KEY);
  } catch {
    // Private mode: a reload just won't offer the way back in.
  }
}

/** The call API, or null when calls aren't available (signed out, or accounts aren't set up). */
export const useCall = () => useContext(Ctx);

/** Calls for the signed-in user, over Supabase. Renders nothing extra while signed out or in local-only mode. */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user, session } = useSync();
  const settingsName = useProgress((s) => s.settings.name);
  const token = useRef<string | null>(null);
  token.current ??= session?.access_token ?? null;
  // The keepalive "left" request on page close needs the current token, and tokens refresh hourly without anything
  // here re-rendering: follow the auth client directly.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => (token.current = data.session?.access_token ?? null));
    const { data } = sb.auth.onAuthStateChange((_event, s) => (token.current = s?.access_token ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  const backend = useMemo(() => (supabase ? supabaseBackend(supabase, () => token.current) : null), []);
  const name = settingsName || (user?.user_metadata?.name as string | undefined) || user?.email?.split("@")[0] || "someone";
  return (
    <CallRoot backend={backend} me={user?.id ?? null} name={name}>
      {children}
    </CallRoot>
  );
}

/** The calls UI and state for user `me` over any backend (Supabase in the app, a fake in the browser test). */
export function CallRoot({ backend, me, name, children }: { backend: CallBackend | null; me: string | null; name: string; children: ReactNode }) {
  const [state, setState] = useState<SessionState>(IDLE);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [ring, setRing] = useState<Ring | null>(null);
  const [lastContext, setLastContext] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [dropped, setDropped] = useState<string | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  // One session per signed-in user. Signing out (or another account) leaves any call.
  useEffect(() => {
    if (!backend || !me) return;
    const s = new CallSession({
      backend,
      me: {
        id: me,
        get name() {
          return nameRef.current;
        },
      },
      onChange: setState,
    });
    sessionRef.current = s;
    const load = () => void backend.mine(me).then(setRows);
    const unwatch = backend.watchMine(me, load);
    // Reloaded mid-call? The others hold the call for a little while (AWAY_GRACE_MS): offer the way back while it lasts.
    const was = readDropped();
    let expire: ReturnType<typeof setTimeout> | undefined;
    if (was && Date.now() - was.at < AWAY_GRACE_MS) {
      backend
        .load(was.call)
        .then(({ call, members }) => {
          if (call.ended_at || !othersIn(members, me).length) return writeDropped(null);
          setDropped(was.call);
          expire = setTimeout(() => (setDropped(null), writeDropped(null)), AWAY_GRACE_MS - (Date.now() - was.at));
        })
        .catch(() => writeDropped(null));
    } else writeDropped(null);
    const onHide = () => {
      const call = s.pageHidden();
      if (call) writeDropped({ call, at: Date.now() });
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      clearTimeout(expire);
      window.removeEventListener("pagehide", onHide);
      unwatch();
      void s.leave();
      sessionRef.current = null;
      setState(IDLE);
      setRows([]);
    };
  }, [backend, me]);

  // Rings run out after a minute without anyone writing to the database, so look again every few seconds.
  const live = rows.some((r) => r.state === "ringing" || r.state === "joined");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, [live]);

  const inCall = state.call?.id ?? null;
  const ringRow = me ? pickIncoming(rows.filter((r) => r.call !== inCall), me, now) : null;
  const rejoinRow = me && !inCall && !state.busy ? (dropped && dropped !== dismissed ? { call: dropped } : pickRejoin(rows.filter((r) => r.call !== dismissed), me, now)) : null;

  // Who's calling: the ringing row says who invited you; their name and the call's context are in the call.
  useEffect(() => {
    if (!backend || !ringRow) return setRing(null);
    let cancelled = false;
    backend
      .load(ringRow.call)
      .then(({ call, members }) => {
        if (cancelled) return;
        const caller = members.find((x) => x.user_id === ringRow.invited_by);
        setRing({ call: ringRow.call, from: caller?.name || "someone", context: call.context });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backend, ringRow?.call, ringRow?.updated_at, ringRow?.invited_by]);

  const act = useCallback((f: (s: CallSession) => unknown) => {
    const s = sessionRef.current;
    if (s) void f(s);
  }, []);

  const api = useMemo<CallApi | null>(() => {
    if (!me || !backend) return null;
    return {
      me,
      state,
      lastContext,
      ring: ring && ringRow && ring.call === ringRow.call ? ring : null,
      rejoin: rejoinRow,
      start: (context, invitees) => {
        setLastContext(context);
        setRevealed((n) => n + 1);
        act((s) => s.start(context, invitees));
      },
      accept: () => ring && act((s) => s.join(ring.call)),
      decline: () => ring && act((s) => s.decline(ring.call)),
      rejoinNow: () => rejoinRow && (writeDropped(null), setDropped(null), act((s) => s.join(rejoinRow.call))),
      dismissRejoin: () => rejoinRow && (writeDropped(null), setDropped(null), setDismissed(rejoinRow.call), act((s) => s.drop(rejoinRow.call))),
      leave: () => act((s) => s.leave()),
      toggleMic: () => act((s) => s.toggleMic()),
      toggleCam: () => act((s) => s.toggleCam()),
      clearNotice: () => setState((x) => ({ ...x, notice: null, error: null })),
      reveal: () => setRevealed((n) => n + 1),
      revealed,
    };
  }, [me, backend, state, lastContext, ring, ringRow, rejoinRow, act, revealed]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {api && (
        <>
          <IncomingCall api={api} />
          <CallWindow api={api} />
        </>
      )}
    </Ctx.Provider>
  );
}
