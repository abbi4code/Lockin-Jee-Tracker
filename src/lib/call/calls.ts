// Calls anywhere in the app: the shapes of public.calls / public.call_members (20261026180000_calls.sql) and the
// pure rules for reading them. Who may call whom is decided by the database (start_call); this file only reads.

/** 'away': the page closed mid-call without hanging up (most likely a reload); 'left' is a hang-up. */
export type MemberState = "ringing" | "joined" | "away" | "left" | "declined" | "missed";

export interface CallRow {
  id: string;
  /** Names the signaling channel. Only members can read it. */
  key: string;
  created_by: string;
  /** Where the call belongs: "coach", "direct", "chess:<game id>", "skribbl:<room id>". */
  context: string;
  created_at: string;
  ended_at: string | null;
}

export interface MemberRow {
  call: string;
  user_id: string;
  name: string;
  state: MemberState;
  invited_by: string | null;
  seen_at: string | null;
  updated_at: string;
}

export interface Invitee {
  id: string;
  name: string;
}

/** A ring lasts this long. The database doesn't time rings out; the caller gives up and clients stop showing them. */
export const RING_MS = 60_000;
/** Joined members heartbeat this often while their call is open... */
export const HEARTBEAT_MS = 30_000;
/** ...and one not seen for this long has gone (a closed tab can't say goodbye). Matches start_call's 90 s. */
export const STALE_MS = 90_000;

/** Someone 'away' (their page closed mid-call, most likely a reload) still counts as in the call this long. */
export const AWAY_GRACE_MS = 20_000;

/** Why a call ended, for the line shown afterwards. */
export type Notice = "no-answer" | "declined" | "left" | "moved" | "blocked" | "no-device" | "failed";

const age = (iso: string | null, now: number) => (iso ? now - Date.parse(iso) : Infinity);

/**
 * Whether someone is in the call: joined with a recent heartbeat, or away for less than the grace (they're probably
 * reloading). A hang-up ('left') ends their part at once.
 */
export const present = (m: MemberRow, now = Date.now()) => (m.state === "joined" && age(m.seen_at, now) < STALE_MS) || (m.state === "away" && age(m.updated_at, now) < AWAY_GRACE_MS);

/** The ring to show: your newest fresh "ringing" row from someone else. */
export function pickIncoming(mine: MemberRow[], me: string, now = Date.now()): MemberRow | null {
  return mine.filter((m) => m.user_id === me && m.state === "ringing" && m.invited_by !== me && age(m.updated_at, now) < RING_MS).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

/**
 * A call you're still marked as in, though no device of yours is in it (a crashed tab, a killed browser): it can be
 * rejoined until it goes stale. A heartbeat newer than one interval means a device of yours is still in it, so it's
 * not offered (that would pull the call off your other tab or device). A reload is offered sooner, from the tab's
 * own memory (CallProvider).
 */
export function pickRejoin(mine: MemberRow[], me: string, now = Date.now()): MemberRow | null {
  return mine.filter((m) => m.user_id === me && m.state === "joined" && age(m.seen_at, now) >= HEARTBEAT_MS + 15_000 && age(m.seen_at, now) < STALE_MS).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

/**
 * Whether the call is over for you, judging by everyone else's rows: nobody else is in it or still being rung.
 * `connected`: someone else was in the call at some point (then it's "left"; otherwise nobody picked up).
 */
export function endReason(members: MemberRow[], me: string, connected: boolean, now = Date.now()): Notice | null {
  const others = members.filter((m) => m.user_id !== me);
  if (others.some((m) => present(m, now))) return null;
  if (others.some((m) => m.state === "ringing" && age(m.updated_at, now) < RING_MS)) return null;
  if (connected) return "left";
  if (others.length && others.every((m) => m.state === "declined")) return "declined";
  return "no-answer";
}

/** Everyone else currently in the call by the roster (the media connection says whether they're connected). */
export const othersIn = (members: MemberRow[], me: string, now = Date.now()) => members.filter((m) => m.user_id !== me && present(m, now));

/** "chess" / "skribbl" for a game's call, else null. */
export function contextKind(context: string): "chess" | "skribbl" | null {
  const kind = context.split(":")[0];
  return kind === "chess" || kind === "skribbl" ? kind : null;
}

/** Names as a short list: "anu", "anu and abhi", "anu, abhi and 2 more". */
export function nameList(names: string[]) {
  const n = names.filter(Boolean);
  if (!n.length) return "";
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} more`;
}
