import { describe, expect, it } from "vitest";
import {
  CHOOSE_MS,
  cleanCustom,
  cleanSettings,
  CODE,
  decide,
  DEFAULT_SETTINGS,
  guessPoints,
  hintTimes,
  isClose,
  isCorrect,
  maskOf,
  nextDeadline,
  parseAction,
  pickWords,
  REVEAL_MS,
  roomCode,
  type Action,
  type Effects,
  type Player,
  type Room,
  type State,
} from "./rules";

const T0 = Date.parse("2026-10-26T12:00:00Z");
const TEN = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

function room(over: Partial<Room> = {}): Room {
  return {
    id: "r1",
    code: "ABCDEF",
    host: "a",
    settings: { ...DEFAULT_SETTINGS, customOnly: true },
    status: "lobby",
    round: 0,
    drawer: null,
    drawn: [],
    step: 0,
    turn_started_at: null,
    phase_ends_at: null,
    mask: null,
    last_word: null,
    created_at: new Date(T0).toISOString(),
    updated_at: new Date(T0).toISOString(),
    ...over,
  };
}
const player = (id: string, i: number, over: Partial<Player> = {}): Player => ({
  room: "r1",
  user_id: id,
  name: id.toUpperCase(),
  hue: i,
  score: 0,
  turn_points: 0,
  guessed_at: null,
  vote: 0,
  gone: false,
  kicked: false,
  joined_at: new Date(T0 + i).toISOString(),
  ...over,
});

/** Applies effects the way the database does, so tests can play a game step by step. */
function apply(s: State, e: Effects): State {
  const players = [...s.players];
  for (const p of e.players ?? []) {
    const i = players.findIndex((x) => x.user_id === p.user_id);
    if (i >= 0) players[i] = p;
    else players.push(p);
  }
  return { room: e.room ? { ...e.room, step: s.room.step + 1 } : s.room, players, secret: e.secret ?? s.secret };
}
function play(s: State, me: string, a: Action, now: number, rng = seq(0)) {
  const v = decide(s, me, a, now, rng);
  if ("error" in v) throw new Error(v.error);
  return { s: apply(s, v.effects), e: v.effects };
}

const secret = (custom = TEN) => ({ room: "r1", word: null, choices: [], used: [], custom });
const lobby = (custom = TEN): State => ({ room: room(), players: [player("a", 0), player("b", 1), player("c", 2)], secret: secret(custom) });

describe("guess matching", () => {
  it("ignores case, spaces, hyphens and accents", () => {
    expect(isCorrect("  X-Ray ", "x ray")).toBe(true);
    expect(isCorrect("xray", "x ray")).toBe(true);
    expect(isCorrect("Café", "cafe")).toBe(true);
    expect(isCorrect("pendulums", "pendulum")).toBe(false);
  });
  it("calls one letter off close, but not short words or exact hits", () => {
    expect(isClose("pendulm", "pendulum")).toBe(true);
    expect(isClose("pendulum", "pendulum")).toBe(false);
    expect(isClose("cat", "car")).toBe(false);
    expect(isClose("magnetc fild", "magnetic field")).toBe(true);
    expect(isClose("magnet", "magnetic field")).toBe(false);
  });
  it("masks letters but keeps spaces and punctuation", () => {
    expect(maskOf("x-ray tube")).toBe("_-___ ____");
    expect(maskOf("pi", new Set([1]))).toBe("_i");
  });
});

describe("settings and actions", () => {
  it("clamps settings and cleans custom words", () => {
    const s = cleanSettings({ rounds: 99, drawTime: 77, hints: -2, words: "nope", customCount: 400 });
    expect(s.rounds).toBe(10);
    expect(s.drawTime).toBe(DEFAULT_SETTINGS.drawTime);
    expect(s.hints).toBe(0);
    expect(s.words).toBe(DEFAULT_SETTINGS.words);
    expect(s.customCount).toBe(0);
    expect(cleanCustom(["  Hello World ", "hello-world", "", "!!", 5])).toEqual(["hello world"]);
  });
  it("rejects malformed actions", () => {
    expect(parseAction({ type: "choose", index: "1" })).toBeNull();
    expect(parseAction({ type: "vote", value: 5 })).toBeNull();
    expect(parseAction({ type: "nuke" })).toBeNull();
    expect(parseAction({ type: "say", text: "hi" })).toEqual({ type: "say", text: "hi" });
  });
  it("makes readable room codes", () => {
    for (let i = 0; i < 50; i++) expect(roomCode()).toMatch(CODE);
  });
  it("doesn't repeat words until the list runs out", () => {
    const s = { ...DEFAULT_SETTINGS, customOnly: true };
    const custom = ["a1", "b2", "c3"];
    expect(pickWords(s, custom, ["a1", "b2"], 1, seq(0))).toEqual(["c3"]);
    expect(pickWords(s, custom, ["a1", "b2", "c3"], 2, seq(0)).length).toBe(2);
  });
});

describe("a game", () => {
  it("only the host starts, with 2+ players", () => {
    const s = lobby();
    expect(decide(s, "b", { type: "start" }, T0)).toEqual({ error: "only the host can start the game." });
    const alone: State = { ...s, players: [s.players[0]] };
    expect("error" in decide(alone, "a", { type: "start" }, T0)).toBe(true);
  });

  it("plays a turn: choose, guess, close, all guessed, reveal, next drawer", () => {
    let { s } = play(lobby(), "a", { type: "start" }, T0);
    expect(s.room.status).toBe("choosing");
    expect(s.room.drawer).toBe("a");
    expect(s.room.round).toBe(1);
    expect(s.secret?.choices.length).toBe(3);
    expect(Date.parse(s.room.phase_ends_at!)).toBe(T0 + CHOOSE_MS);
    // The word stays in the secret: the room only has blanks.
    expect(decide(s, "b", { type: "choose", index: 0 }, T0)).toEqual({ error: "it's not your turn to pick." });
    ({ s } = play(s, "a", { type: "choose", index: 0 }, T0 + 1000));
    const word = s.secret!.word!;
    expect(s.room.status).toBe("drawing");
    expect(s.room.mask).toBe(maskOf(word));
    expect(JSON.stringify(s.room)).not.toContain(word);

    // A wrong guess is public chat; a close one also tells the guesser privately.
    let r = play(s, "b", { type: "say", text: `${word}x` }, T0 + 2000);
    expect(r.e.room).toBeUndefined();
    expect(r.e.messages?.map((m) => [m.kind, m.audience])).toEqual([
      ["chat", "all"],
      ["close", "user"],
    ]);
    expect(r.e.messages?.[1].to_users).toEqual(["b"]);

    // A right guess never shows the word; points depend on time left.
    r = play(s, "b", { type: "say", text: word.toUpperCase() }, T0 + 1000);
    s = r.s;
    expect(r.e.messages?.[0].kind).toBe("correct");
    expect(r.e.messages?.[0].body).not.toContain(word);
    expect(s.players.find((p) => p.user_id === "b")!.score).toBe(500);

    // Someone who guessed talks only to the drawer and the others who guessed.
    r = play(s, "b", { type: "say", text: `it's ${word}` }, T0 + 3000);
    expect(r.e.messages?.[0].audience).toBe("guessed");
    expect(r.e.messages?.[0].to_users.sort()).toEqual(["a", "b"]);

    // The last guesser ends the turn; the drawer gets the guessers' average.
    const halfway = T0 + 1000 + (DEFAULT_SETTINGS.drawTime * 1000) / 2;
    ({ s } = play(s, "c", { type: "say", text: word }, halfway));
    const c = s.players.find((p) => p.user_id === "c")!;
    expect(c.turn_points).toBe(300);
    expect(s.room.status).toBe("reveal");
    expect(s.room.last_word).toBe(word);
    expect(s.players.find((p) => p.user_id === "a")!.turn_points).toBe(400);

    // After the reveal, the next player picks.
    expect(decide(s, "b", { type: "tick" }, halfway + 10)).toEqual({ error: "not yet." });
    ({ s } = play(s, "b", { type: "tick" }, halfway + REVEAL_MS));
    expect(s.room.status).toBe("choosing");
    expect(s.room.drawer).toBe("b");
    expect(s.players.every((p) => !p.guessed_at && p.turn_points === 0)).toBe(true);
  });

  it("picks a word when the drawer doesn't, and ends at the buzzer", () => {
    let { s } = play(lobby(), "a", { type: "start" }, T0);
    expect("error" in decide(s, "c", { type: "tick" }, T0 + CHOOSE_MS - 1)).toBe(true);
    ({ s } = play(s, "c", { type: "tick" }, T0 + CHOOSE_MS));
    expect(s.room.status).toBe("drawing");
    const end = Date.parse(s.room.phase_ends_at!);
    ({ s } = play(s, "b", { type: "tick" }, end));
    expect(s.room.status).toBe("reveal");
    expect(s.players.find((p) => p.user_id === "a")!.turn_points).toBe(0);
  });

  it("reveals hints on schedule, never more than half the word", () => {
    let { s } = play({ ...lobby(), room: room({ settings: { ...DEFAULT_SETTINGS, hints: 5, customOnly: true } }) }, "a", { type: "start" }, T0);
    s = { ...s, secret: { ...s.secret!, choices: ["abcdef"] } };
    ({ s } = play(s, "a", { type: "choose", index: 0 }, T0));
    const times = hintTimes(s.room);
    expect(times.length).toBe(3);
    expect(nextDeadline(s.room)).toBe(times[0]);
    ({ s } = play(s, "b", { type: "tick" }, times[1], seq(0, 0.99)));
    expect(s.room.mask!.replace(/_/g, "").length).toBe(2);
    expect(nextDeadline(s.room)).toBe(times[2]);
  });

  it("hidden mode shows no blanks and gives no hints", () => {
    let { s } = play({ ...lobby(), room: room({ settings: { ...DEFAULT_SETTINGS, wordMode: "hidden", customOnly: true } }) }, "a", { type: "start" }, T0);
    ({ s } = play(s, "a", { type: "choose", index: 0 }, T0));
    expect(s.room.mask).toBeNull();
    expect(hintTimes(s.room)).toEqual([]);
  });

  it("goes round by round and ends after the last", () => {
    let s: State = { ...lobby(), room: room({ settings: { ...DEFAULT_SETTINGS, rounds: 2, customOnly: true } }), players: [player("a", 0), player("b", 1)] };
    let t = T0;
    ({ s } = play(s, "a", { type: "start" }, t));
    const drawers: string[] = [];
    while (s.room.status !== "over") {
      drawers.push(`${s.room.round}${s.room.drawer}`);
      t = Date.parse(s.room.phase_ends_at!);
      ({ s } = play(s, "a", { type: "tick" }, t)); // choosing → drawing
      t = Date.parse(s.room.phase_ends_at!);
      ({ s } = play(s, "a", { type: "tick" }, t)); // drawing → reveal
      t = Date.parse(s.room.phase_ends_at!);
      ({ s } = play(s, "a", { type: "tick" }, t)); // reveal → next
    }
    expect(drawers).toEqual(["1a", "1b", "2a", "2b"]);
  });

  it("a late joiner draws in the current round", () => {
    let { s } = play(lobby(), "a", { type: "start" }, T0);
    ({ s } = play(s, "d", { type: "join", name: "dee" }, T0 + 5));
    expect(s.players.find((p) => p.user_id === "d")?.hue).toBe(3);
    const order: string[] = [s.room.drawer!];
    for (let i = 0; i < 3; i++) {
      ({ s } = play(s, "a", { type: "tick" }, Date.parse(s.room.phase_ends_at!)));
      ({ s } = play(s, "a", { type: "tick" }, Date.parse(s.room.phase_ends_at!)));
      ({ s } = play(s, "a", { type: "tick" }, Date.parse(s.room.phase_ends_at!)));
      order.push(s.room.drawer!);
    }
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("the drawer leaving ends the turn; the host leaving passes the host on", () => {
    let { s } = play(lobby(), "a", { type: "start" }, T0);
    ({ s } = play(s, "a", { type: "choose", index: 0 }, T0));
    ({ s } = play(s, "a", { type: "leave" }, T0 + 10));
    expect(s.room.status).toBe("reveal");
    expect(s.room.host).toBe("b");
    // Down to one player: the game ends, and someone who left can't win it.
    s = { ...s, players: s.players.map((p) => (p.user_id === "b" ? { ...p, score: 900 } : p.user_id === "c" ? { ...p, score: 100 } : p)) };
    const r = play(s, "b", { type: "leave" }, T0 + 20);
    expect(r.s.room.status).toBe("over");
    expect(r.e.messages?.map((m) => m.body)).toContain("game over. C wins!");
  });

  it("a turn can be skipped while picking or drawing, and the chat says who", () => {
    let { s, e } = play(lobby(), "a", { type: "start" }, T0);
    ({ s, e } = play(s, "b", { type: "skip" }, T0 + 10));
    expect(s.room.status).toBe("choosing");
    expect(s.room.drawer).toBe("b");
    expect(e.messages?.[0].body).toBe("B skipped A's turn.");
    ({ s } = play(s, "b", { type: "choose", index: 0 }, T0 + 20));
    ({ s, e } = play(s, "b", { type: "skip" }, T0 + 30));
    expect(s.room.status).toBe("reveal");
    expect(e.messages?.[0].body).toBe("B passed.");
    expect(decide(s, "a", { type: "skip" }, T0 + 40)).toEqual({ error: "there's no turn to skip." });
  });

  it("kicked players can't come back", () => {
    let { s } = play(lobby(), "a", { type: "kick", user: "c" }, T0);
    expect(decide(s, "c", { type: "join", name: "c" }, T0)).toEqual({ error: "the host removed you from this room." });
    expect(decide(s, "b", { type: "kick", user: "a" }, T0)).toEqual({ error: "only the host can remove players." });
    ({ s } = play(s, "b", { type: "leave" }, T0));
    expect(play(s, "b", { type: "join", name: "b" }, T0).s.players.find((p) => p.user_id === "b")?.gone).toBe(false);
  });

  it("a full room turns new players away", () => {
    const s: State = { ...lobby(), room: room({ settings: { ...DEFAULT_SETTINGS, maxPlayers: 3 } }) };
    expect(decide(s, "z", { type: "join", name: "z" }, T0)).toEqual({ error: "this room is full." });
  });

  it("custom-only needs enough words", () => {
    const s = lobby(["alpha", "bravo"]);
    expect("error" in decide(s, "a", { type: "start" }, T0)).toBe(true);
    // Only the host changes words; the room shows how many, never which.
    const { s: set } = play(s, "a", { type: "settings", settings: {}, custom: TEN }, T0);
    expect(set.room.settings.customCount).toBe(10);
    expect(JSON.stringify(set.room)).not.toContain("alpha");
    expect(set.room.status).toBe("lobby");
  });

  it("scores from 500 down to 100 with the clock", () => {
    const r = room({ status: "drawing", turn_started_at: new Date(T0).toISOString(), phase_ends_at: new Date(T0 + 80_000).toISOString() });
    expect(guessPoints(r, T0)).toBe(500);
    expect(guessPoints(r, T0 + 40_000)).toBe(300);
    expect(guessPoints(r, T0 + 90_000)).toBe(100);
  });

  it("play again resets scores and goes back to the lobby", () => {
    let s: State = { ...lobby(), room: room({ status: "over", round: 3 }), players: [player("a", 0, { score: 900 }), player("b", 1, { score: 300 })] };
    ({ s } = play(s, "a", { type: "again" }, T0));
    expect(s.room.status).toBe("lobby");
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  });
});
