import { builtIn, type WordList } from "./words";

// The referee for skribbl (/extras/skribbl): one player draws a word, the others guess it in the chat. Players
// can't write the game tables (20261026120000_skribbl.sql); every action goes through /api/skribbl/[code], which
// runs it through `decide` here and saves the result in one transaction. The word lives in skribbl_secrets, which
// only the server can read, so a guesser's browser never has it.
//
// A game: the host sets it up in the lobby and starts it. Each round, every player draws once, in the order they
// joined. A turn: the drawer picks one of a few words (choosing), draws it while the others guess (drawing), then
// everyone sees the word and the points (reveal). The clock has no server of its own: the room holds deadlines,
// and any player's app sends "tick" once one has passed.

export type Status = "lobby" | "choosing" | "drawing" | "reveal" | "over";
/** hidden: guessers don't see how long the word is, and get no hints. */
export type WordMode = "normal" | "hidden";

export interface Settings {
  maxPlayers: number;
  /** Seconds to draw. */
  drawTime: number;
  rounds: number;
  /** Words the drawer picks from. */
  choices: number;
  /** Letters revealed while drawing, at even steps (at most half the word). */
  hints: number;
  wordMode: WordMode;
  words: WordList;
  /** How many words the host added. The words themselves are in the secret: a short custom list would give answers away. */
  customCount: number;
  /** Draw only the host's words. */
  customOnly: boolean;
}

export const DEFAULT_SETTINGS: Settings = { maxPlayers: 8, drawTime: 80, rounds: 3, choices: 3, hints: 2, wordMode: "normal", words: "both", customCount: 0, customOnly: false };
export const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180, 240] as const;
export const LIMITS = { players: [2, 12], rounds: [2, 10], choices: [1, 5], hints: [0, 5] } as const;
/** "custom words only" needs at least this many. */
export const CUSTOM_MIN = 10;
const CUSTOM_MAX = 500;
const WORD_MAX = 30;
export const NAME_MAX = 24;
export const TEXT_MAX = 100;
/** Time to pick a word; after it a random one is picked. */
export const CHOOSE_MS = 15_000;
/** How long the word and the points stay up between turns. */
export const REVEAL_MS = 6_000;
/** Player colours (avatar dots); see --color-sketch-hue-* in globals.css. */
export const HUES = 12;

export interface Room {
  id: string;
  code: string;
  host: string;
  settings: Settings;
  status: Status;
  round: number;
  drawer: string | null;
  /** Who has drawn this round. */
  drawn: string[];
  /** Bumped by every saved change: the write guard. */
  step: number;
  turn_started_at: string | null;
  phase_ends_at: string | null;
  /** While drawing in normal mode: the word with unrevealed letters as "_". Null in hidden mode. */
  mask: string | null;
  /** The word of the turn that just ended (reveal), for everyone. */
  last_word: string | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  room: string;
  user_id: string;
  name: string;
  hue: number;
  score: number;
  /** Points this turn (shown at the reveal). */
  turn_points: number;
  guessed_at: string | null;
  /** Thumbs on this turn's drawing: 1, -1 or 0. */
  vote: number;
  gone: boolean;
  /** Removed by the host: can't come back. */
  kicked: boolean;
  joined_at: string;
}

export interface Secret {
  room: string;
  word: string | null;
  choices: string[];
  /** Words already drawn this game, so they don't come up again. */
  used: string[];
  /** The host's own words, added to the list (or used alone with customOnly). */
  custom: string[];
}

export type MessageKind = "chat" | "correct" | "close" | "system";
/** all: everyone · guessed: only the drawer and those who guessed (to_users) · user: one player (to_users). */
export type Audience = "all" | "guessed" | "user";

export interface NewMessage {
  user_id: string | null;
  name: string;
  body: string;
  kind: MessageKind;
  audience: Audience;
  to_users: string[];
}
export interface Message extends NewMessage {
  id: number;
  room: string;
  created_at: string;
}

export interface State {
  room: Room;
  players: Player[];
  secret: Secret | null;
}

/** What to save. `room` set: the room changed (its step goes up, so any write based on the old one fails). */
export interface Effects {
  room?: Room;
  players?: Player[];
  secret?: Secret;
  messages?: NewMessage[];
}

export type Action =
  | { type: "join"; name: string }
  | { type: "rename"; name: string }
  | { type: "leave" }
  | { type: "kick"; user: string }
  | { type: "settings"; settings: Partial<Settings>; custom?: string[] }
  | { type: "start" }
  | { type: "choose"; index: number }
  | { type: "say"; text: string }
  | { type: "vote"; value: number }
  | { type: "tick" }
  | { type: "skip" }
  | { type: "again" };

// ── Words and guesses ────────────────────────────────────────────────────────

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Lowercase, no accents, single spaces. */
export const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** For comparing: also without spaces, hyphens and dots ("x-ray" = "x ray" = "xray"). */
const compact = (s: string) => normalize(s).replace(/[\s\-.'’]/g, "");

export const isCorrect = (guess: string, word: string) => compact(guess) === compact(word);

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** One letter off (two for long words): the guesser alone is told it's close. Short words never are. */
export function isClose(guess: string, word: string) {
  const g = compact(guess);
  const w = compact(word);
  if (w.length < 4 || g === w) return false;
  return distance(g, w) <= (w.length >= 10 ? 2 : 1);
}

/** The blanks: letters as "_", spaces and punctuation as they are; `shown` letters stay. */
export const maskOf = (word: string, shown: Set<number> = new Set()) => [...word].map((ch, i) => (isLetter(ch) && !shown.has(i) ? "_" : ch)).join("");
/** Letters in a mask (hidden and shown). */
export const maskLetters = (mask: string) => [...mask].filter((ch) => ch === "_" || isLetter(ch)).length;
const shownLetters = (mask: string) => [...mask].filter(isLetter).length;

export function cleanWord(s: string) {
  const w = normalize(s).slice(0, WORD_MAX).trim();
  return [...w].some(isLetter) ? w : "";
}

export function wordPool(s: Settings, custom: string[]) {
  if (s.customOnly && custom.length) return custom;
  return [...new Set([...builtIn(s.words), ...custom])];
}

/** `n` different words, avoiding ones already drawn this game (unless the list has run out). */
export function pickWords(s: Settings, custom: string[], used: string[], n: number, rng: () => number) {
  const pool = wordPool(s, custom);
  const seen = new Set(used.map(compact));
  let fresh = pool.filter((w) => !seen.has(compact(w)));
  if (fresh.length < n) fresh = pool;
  const left = [...fresh];
  const out: string[] = [];
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return out;
}

// ── Time ─────────────────────────────────────────────────────────────────────

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const iso = (t: number) => new Date(t).toISOString();

/** How many letters get revealed this turn. */
export const hintCount = (s: Settings, letters: number) => (s.wordMode === "hidden" ? 0 : Math.min(s.hints, Math.floor(letters / 2)));

/** When each hint is due while drawing: evenly spread, none at the very end. */
export function hintTimes(room: Room) {
  if (room.status !== "drawing" || !room.mask) return [];
  const start = ms(room.turn_started_at);
  const length = room.settings.drawTime * 1000;
  const n = hintCount(room.settings, maskLetters(room.mask));
  return Array.from({ length: n }, (_, k) => start + (length * (k + 1)) / (n + 1));
}

/** The next moment something happens on its own (a hint, the end of a phase), for the apps' "tick". */
export function nextDeadline(room: Room) {
  if (room.status === "choosing" || room.status === "reveal") return ms(room.phase_ends_at);
  if (room.status !== "drawing") return null;
  const hint = hintTimes(room)[room.mask ? shownLetters(room.mask) : Infinity];
  return hint ?? ms(room.phase_ends_at);
}

/** Points for a correct guess: 100 at the buzzer up to 500 straight away, in steps of 5. */
export function guessPoints(room: Room, now: number) {
  const length = room.settings.drawTime * 1000;
  const left = Math.max(0, Math.min(1, (ms(room.phase_ends_at) - now) / length));
  return Math.round((100 + 400 * left) / 5) * 5;
}

// ── Settings and actions from the network ────────────────────────────────────

const int = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v as number)) : fallback);

/** The host's words: cleaned, without repeats, at most CUSTOM_MAX. */
export function cleanCustom(list: unknown): string[] {
  const words = new Map<string, string>();
  for (const w of Array.isArray(list) ? list : []) {
    const c = typeof w === "string" ? cleanWord(w) : "";
    if (c && !words.has(compact(c))) words.set(compact(c), c);
  }
  return [...words.values()].slice(0, CUSTOM_MAX);
}

/** Settings from the client, clamped to what the game allows. */
export function cleanSettings(x: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return {
    maxPlayers: int(o.maxPlayers, LIMITS.players, base.maxPlayers),
    drawTime: (DRAW_TIMES as readonly unknown[]).includes(o.drawTime) ? (o.drawTime as number) : base.drawTime,
    rounds: int(o.rounds, LIMITS.rounds, base.rounds),
    choices: int(o.choices, LIMITS.choices, base.choices),
    hints: int(o.hints, LIMITS.hints, base.hints),
    wordMode: o.wordMode === "hidden" || o.wordMode === "normal" ? o.wordMode : base.wordMode,
    words: o.words === "general" || o.words === "jee" || o.words === "both" ? o.words : base.words,
    customCount: base.customCount,
    customOnly: typeof o.customOnly === "boolean" ? o.customOnly : base.customOnly,
  };
}

export const cleanName = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "");
const cleanText = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);

/** Checks a request body is an Action (it comes from the network). */
export function parseAction(x: unknown): Action | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  switch (a.type) {
    case "join":
    case "rename":
      return typeof a.name === "string" ? { type: a.type, name: a.name } : null;
    case "kick":
      return typeof a.user === "string" ? { type: "kick", user: a.user } : null;
    case "settings":
      if (!a.settings || typeof a.settings !== "object") return null;
      return { type: "settings", settings: a.settings as Partial<Settings>, ...(Array.isArray(a.custom) ? { custom: a.custom.slice(0, CUSTOM_MAX * 2) as string[] } : {}) };
    case "choose":
      return Number.isInteger(a.index) ? { type: "choose", index: a.index as number } : null;
    case "say":
      return typeof a.text === "string" ? { type: "say", text: a.text } : null;
    case "vote":
      return a.value === 1 || a.value === -1 || a.value === 0 ? { type: "vote", value: a.value } : null;
    case "leave":
    case "start":
    case "tick":
    case "skip":
    case "again":
      return { type: a.type };
    default:
      return null;
  }
}

// ── The referee ──────────────────────────────────────────────────────────────

/** Players still in the room, in the order they joined (the drawing order). */
export const activePlayers = (players: Player[]) =>
  players.filter((p) => !p.gone && !p.kicked).sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id));

/** A working copy of the state that records what changed. */
function draft(s: State, now: number, rng: () => number) {
  const d = {
    now,
    rng,
    room: { ...s.room, drawn: [...s.room.drawn] },
    players: s.players.map((p) => ({ ...p })),
    secret: s.secret ? { ...s.secret, choices: [...s.secret.choices], used: [...s.secret.used], custom: [...s.secret.custom] } : { room: s.room.id, word: null, choices: [], used: [], custom: [] },
    messages: [] as NewMessage[],
    touched: new Set<string>(),
    roomChanged: false,
    secretChanged: false,
  };
  return d;
}
type Draft = ReturnType<typeof draft>;

const player = (d: Draft, id: string | null) => d.players.find((p) => p.user_id === id);
const touch = (d: Draft, p: Player) => d.touched.add(p.user_id);
const system = (d: Draft, body: string) => d.messages.push({ user_id: null, name: "", body, kind: "system", audience: "all", to_users: [] });

function effects(d: Draft): Effects {
  const out: Effects = {};
  if (d.roomChanged || d.touched.size || d.secretChanged) out.room = d.room;
  if (d.touched.size) out.players = d.players.filter((p) => d.touched.has(p.user_id));
  if (d.secretChanged) out.secret = d.secret;
  if (d.messages.length) out.messages = d.messages;
  return out;
}

function resetTurn(d: Draft) {
  for (const p of d.players) {
    if (p.guessed_at || p.turn_points || p.vote) {
      p.guessed_at = null;
      p.turn_points = 0;
      p.vote = 0;
      touch(d, p);
    }
  }
}

function finish(d: Draft, why?: string) {
  const r = d.room;
  r.status = "over";
  r.drawer = null;
  r.phase_ends_at = null;
  r.mask = null;
  d.roomChanged = true;
  d.secret.word = null;
  d.secret.choices = [];
  d.secretChanged = true;
  if (why) system(d, why);
  // Only those still here are ranked: leaving forfeits.
  const ranked = activePlayers(d.players).sort((a, b) => b.score - a.score);
  if (ranked[0] && ranked[0].score > 0) system(d, ranked[1]?.score === ranked[0].score ? "game over. it's a tie at the top!" : `game over. ${ranked[0].name} wins!`);
}

/** The next player draws: a new round once everyone has, the end after the last round. */
function startTurn(d: Draft) {
  const r = d.room;
  const order = activePlayers(d.players);
  if (order.length < 2) return finish(d, "not enough players left.");
  let next = order.find((p) => !r.drawn.includes(p.user_id));
  if (!next) {
    if (r.round >= r.settings.rounds) return finish(d);
    r.round++;
    r.drawn = [];
    next = order[0];
  }
  resetTurn(d);
  r.status = "choosing";
  r.drawer = next.user_id;
  r.drawn.push(next.user_id);
  r.turn_started_at = null;
  r.phase_ends_at = iso(d.now + CHOOSE_MS);
  r.mask = null;
  r.last_word = null;
  d.roomChanged = true;
  d.secret.word = null;
  d.secret.choices = pickWords(r.settings, d.secret.custom, d.secret.used, r.settings.choices, d.rng);
  d.secretChanged = true;
}

function startDrawing(d: Draft, word: string) {
  const r = d.room;
  r.status = "drawing";
  r.turn_started_at = iso(d.now);
  r.phase_ends_at = iso(d.now + r.settings.drawTime * 1000);
  r.mask = r.settings.wordMode === "hidden" ? null : maskOf(word);
  d.roomChanged = true;
  d.secret.word = word;
  d.secret.choices = [];
  d.secret.used = [...d.secret.used, word];
  d.secretChanged = true;
  system(d, `${player(d, r.drawer)?.name ?? "someone"} is drawing now.`);
}

/** Time's up, everyone guessed, or the drawer left: show the word; the drawer scores the guessers' average. */
function endTurn(d: Draft) {
  const r = d.room;
  const word = d.secret.word;
  const guessers = activePlayers(d.players).filter((p) => p.user_id !== r.drawer);
  const drawer = player(d, r.drawer);
  if (drawer && guessers.length) {
    const points = Math.round(guessers.reduce((n, p) => n + p.turn_points, 0) / guessers.length / 5) * 5;
    drawer.turn_points = points;
    drawer.score += points;
    touch(d, drawer);
  }
  r.status = "reveal";
  r.phase_ends_at = iso(d.now + REVEAL_MS);
  r.mask = word;
  r.last_word = word;
  d.roomChanged = true;
  if (word) system(d, `the word was “${word}”.`);
}

const everyoneGuessed = (d: Draft) => {
  const guessers = activePlayers(d.players).filter((p) => p.user_id !== d.room.drawer);
  return guessers.length > 0 && guessers.every((p) => p.guessed_at);
};

/** A player leaves (or is removed): the host passes on, and the turn ends if it can't go on without them. */
function remove(d: Draft, p: Player, kicked: boolean) {
  p.gone = true;
  if (kicked) p.kicked = true;
  touch(d, p);
  system(d, kicked ? `${p.name} was removed by the host.` : `${p.name} left.`);
  const r = d.room;
  const left = activePlayers(d.players);
  if (r.host === p.user_id && left[0]) {
    r.host = left[0].user_id;
    d.roomChanged = true;
    system(d, `${left[0].name} is the host now.`);
  }
  if (r.status === "lobby" || r.status === "over") return;
  if (left.length < 2) return finish(d, "not enough players left.");
  if (r.drawer === p.user_id) {
    if (r.status === "choosing") startTurn(d);
    else if (r.status === "drawing") endTurn(d);
  } else if (r.status === "drawing" && everyoneGuessed(d)) endTurn(d);
}

function revealHint(d: Draft) {
  const r = d.room;
  const word = d.secret.word;
  if (!r.mask || !word) return;
  const hidden = [...r.mask].flatMap((ch, i) => (ch === "_" ? [i] : []));
  if (!hidden.length) return;
  const shown = new Set([...r.mask].flatMap((ch, i) => (ch !== "_" && isLetter(ch) ? [i] : [])));
  shown.add(hidden[Math.floor(d.rng() * hidden.length)]);
  r.mask = maskOf(word, shown);
  d.roomChanged = true;
}

/**
 * What `me` doing `action` changes, or why it's refused. Pure: the caller saves the effects (and retries with a
 * fresh state if another write got in first).
 */
export function decide(state: State, me: string, action: Action, now = Date.now(), rng: () => number = Math.random): { effects: Effects } | { error: string } {
  const d = draft(state, now, rng);
  const r = d.room;
  const self = player(d, me);
  const active = !!self && !self.gone && !self.kicked;
  const isHost = r.host === me;

  if (action.type === "join") {
    if (self?.kicked) return { error: "the host removed you from this room." };
    if (active) return { effects: {} };
    if (activePlayers(d.players).length >= r.settings.maxPlayers) return { error: "this room is full." };
    if (self) {
      self.gone = false;
      touch(d, self);
      system(d, `${self.name} is back.`);
    } else {
      const name = cleanName(action.name) || "player";
      const taken = new Set(activePlayers(d.players).map((p) => p.hue));
      const hue = Array.from({ length: HUES }, (_, i) => i).find((i) => !taken.has(i)) ?? d.players.length % HUES;
      const p: Player = { room: r.id, user_id: me, name, hue, score: 0, turn_points: 0, guessed_at: null, vote: 0, gone: false, kicked: false, joined_at: iso(now) };
      d.players.push(p);
      touch(d, p);
      system(d, `${name} joined.`);
    }
    return { effects: effects(d) };
  }

  if (!active) return { error: "you're not in this room." };

  switch (action.type) {
    case "rename": {
      const name = cleanName(action.name);
      if (!name) return { error: "pick a name." };
      if (name === self.name) return { effects: {} };
      self.name = name;
      touch(d, self);
      return { effects: effects(d) };
    }
    case "leave":
      remove(d, self, false);
      return { effects: effects(d) };
    case "kick": {
      if (!isHost) return { error: "only the host can remove players." };
      const p = player(d, action.user);
      if (!p || p.user_id === me || p.kicked) return { error: "no such player." };
      remove(d, p, true);
      return { effects: effects(d) };
    }
    case "settings":
      if (!isHost) return { error: "only the host can change the settings." };
      if (r.status !== "lobby") return { error: "settings can only change before the game starts." };
      r.settings = cleanSettings({ ...r.settings, ...action.settings }, r.settings);
      if (action.custom) {
        d.secret.custom = cleanCustom(action.custom);
        d.secretChanged = true;
      }
      r.settings.customCount = d.secret.custom.length;
      d.roomChanged = true;
      return { effects: effects(d) };
    case "start":
    case "again": {
      if (!isHost) return { error: "only the host can start the game." };
      if (action.type === "start" && r.status !== "lobby") return { error: "the game has already started." };
      if (action.type === "again" && r.status !== "over") return { error: "the game isn't over yet." };
      if (action.type === "start" && activePlayers(d.players).length < 2) return { error: "you need at least 2 players." };
      if (action.type === "start" && r.settings.customOnly && d.secret.custom.length < CUSTOM_MIN) return { error: `add at least ${CUSTOM_MIN} custom words, or turn off "custom words only".` };
      for (const p of d.players) {
        if (p.score || p.turn_points || p.guessed_at || p.vote) {
          Object.assign(p, { score: 0, turn_points: 0, guessed_at: null, vote: 0 });
          touch(d, p);
        }
      }
      Object.assign(r, { round: action.type === "start" ? 1 : 0, drawn: [], drawer: null, turn_started_at: null, phase_ends_at: null, mask: null, last_word: null });
      d.secret = { ...d.secret, word: null, choices: [], used: [] };
      d.secretChanged = true;
      d.roomChanged = true;
      if (action.type === "start") startTurn(d);
      else r.status = "lobby";
      return { effects: effects(d) };
    }
    case "choose": {
      if (r.status !== "choosing" || r.drawer !== me) return { error: "it's not your turn to pick." };
      const word = d.secret.choices[action.index];
      if (!word) return { error: "pick one of the words." };
      startDrawing(d, word);
      return { effects: effects(d) };
    }
    case "skip": {
      // For a drawer who's gone quiet (their app closed, their phone locked): the host's button, or any app that
      // sees them away. The server can't see who's connected, so anyone may skip, and the chat says who did.
      if (r.status !== "choosing" && r.status !== "drawing") return { error: "there's no turn to skip." };
      const drawer = player(d, r.drawer);
      system(d, r.drawer === me ? `${self.name} passed.` : `${self.name} skipped ${drawer?.name ?? "the"}'s turn.`);
      if (r.status === "choosing") startTurn(d);
      else endTurn(d);
      return { effects: effects(d) };
    }
    case "vote":
      if ((r.status !== "drawing" && r.status !== "reveal") || r.drawer === me) return { error: "you can't rate this drawing." };
      if (self.vote === action.value) return { effects: {} };
      self.vote = action.value;
      touch(d, self);
      return { effects: { players: [self] } };
    case "tick": {
      const end = ms(r.phase_ends_at);
      if (r.status === "choosing" && now >= end) {
        const word = d.secret.choices[Math.floor(rng() * d.secret.choices.length)] ?? pickWords(r.settings, d.secret.custom, d.secret.used, 1, rng)[0];
        if (!word) return { error: "no words to draw." };
        startDrawing(d, word);
      } else if (r.status === "drawing" && now >= end) endTurn(d);
      else if (r.status === "drawing") {
        const due = hintTimes(r).filter((t) => t <= now).length - (r.mask ? shownLetters(r.mask) : 0);
        for (let i = 0; i < due; i++) revealHint(d);
      } else if (r.status === "reveal" && now >= end) startTurn(d);
      if (!d.roomChanged) return { error: "not yet." };
      return { effects: effects(d) };
    }
    case "say": {
      const text = cleanText(action.text);
      if (!text) return { error: "say something." };
      const word = d.secret.word;
      const chat = (audience: Audience, to: string[] = []) => d.messages.push({ user_id: me, name: self.name, body: text, kind: "chat", audience, to_users: to });
      if (r.status !== "drawing" || !word) {
        chat("all");
        return { effects: effects(d) };
      }
      // The drawer and those who've guessed only talk among themselves: they know the word.
      if (r.drawer === me || self.guessed_at) {
        const insiders = activePlayers(d.players).filter((p) => p.user_id === r.drawer || p.guessed_at);
        chat("guessed", insiders.map((p) => p.user_id));
        return { effects: effects(d) };
      }
      if (isCorrect(text, word)) {
        const points = guessPoints(r, now);
        self.guessed_at = iso(now);
        self.turn_points = points;
        self.score += points;
        touch(d, self);
        d.messages.push({ user_id: me, name: self.name, body: `${self.name} guessed the word!`, kind: "correct", audience: "all", to_users: [] });
        if (everyoneGuessed(d)) endTurn(d);
        return { effects: effects(d) };
      }
      chat("all");
      if (isClose(text, word)) d.messages.push({ user_id: null, name: "", body: `“${text}” is close!`, kind: "close", audience: "user", to_users: [me] });
      return { effects: effects(d) };
    }
  }
}

/** A new room's code: 6 characters that can't be misread (no 0/O, 1/I/L). */
export function roomCode(rng: () => number = Math.random) {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => abc[Math.floor(rng() * abc.length)]).join("");
}
export const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
