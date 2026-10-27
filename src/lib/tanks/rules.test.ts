import { describe, expect, it } from "vitest";
import { decide, parseAction, SKIPS_TO_LOSE, TURN_MS, type Patch, type TankGame } from "./rules";
import { newWorld } from "./world";

const T0 = Date.parse("2026-10-27T10:00:00Z");
const game = (over: Partial<TankGame> = {}): TankGame => ({
  id: "g",
  p1: "anu",
  p2: "abhi",
  p1_name: "anu",
  p2_name: "abhi",
  status: "active",
  winner: null,
  reason: null,
  step: 3,
  world: newWorld(9),
  last: null,
  next: null,
  moved_at: new Date(T0).toISOString(),
  updated_at: new Date(T0).toISOString(),
  ...over,
});
const patchOf = (r: ReturnType<typeof decide>): Patch => {
  if (!("patch" in r)) throw new Error(JSON.stringify(r));
  return r.patch;
};
const shot = { weapon: "shell", angle: 45, power: 60 } as const;

describe("joining", () => {
  const open = game({ p2: null, p2_name: "", status: "waiting", step: 0 });
  it("gives the open seat to the first one in", () => {
    const p = patchOf(decide(open, "abhi", { type: "join", name: "abhi" }, T0));
    expect(p).toMatchObject({
      p2: "abhi",
      p2_name: "abhi",
      status: "active",
      step: 1,
      last: { kind: "join" },
    });
  });
  it("changes nothing for someone already in", () => {
    expect(patchOf(decide(open, "anu", { type: "join", name: "anu" }, T0))).toEqual({});
  });
  it("turns away a third player", () => {
    expect(decide(game(), "ravi", { type: "join", name: "ravi" }, T0)).toEqual({
      error: "two players are already in this battle.",
    });
  });
});

describe("shots", () => {
  it("simulates the shot and hands the turn over", () => {
    const p = patchOf(decide(game(), "anu", { type: "fire", step: 3, shot }, T0 + 5000));
    expect(p.step).toBe(4);
    expect(p.world?.turn).toBe(1);
    expect(p.last).toEqual({ kind: "fire", by: 0, shot });
    expect(p.moved_at).toBe(new Date(T0 + 5000).toISOString());
  });
  it("refuses a shot out of turn, from an old step, or from outsiders", () => {
    expect(decide(game(), "abhi", { type: "fire", step: 3, shot }, T0)).toEqual({ error: "it's not your turn." });
    expect(decide(game(), "anu", { type: "fire", step: 2, shot }, T0)).toEqual({
      error: "the battle moved on. it's been reloaded.",
    });
    expect(decide(game(), "ravi", { type: "fire", step: 3, shot }, T0)).toEqual({ error: "you're not in this battle." });
  });
  it("ends the game when a tank is destroyed", () => {
    const g = game();
    g.world.tanks[0].hp = 1;
    g.world.wind = 0;
    const p = patchOf(
      decide(
        g,
        "anu",
        {
          type: "fire",
          step: 3,
          shot: { weapon: "shell", angle: 90, power: 50 },
        },
        T0,
      ),
    );
    expect(p).toMatchObject({ status: "over", winner: 1, reason: "destroyed" });
  });
});

describe("drives", () => {
  it("moves your tank without restarting the turn's time", () => {
    const p = patchOf(decide(game(), "anu", { type: "move", step: 3, dir: 1 }, T0 + 9000));
    expect(p.world?.tanks[0].moves).toBe(3);
    expect(p.moved_at).toBeUndefined();
    expect(p.last).toEqual({ kind: "move", by: 0, dir: 1 });
  });
});

describe("turn time", () => {
  it("isn't up before the minute is", () => {
    expect(decide(game(), "abhi", { type: "timeout", step: 3 }, T0 + TURN_MS - 1)).toEqual({ error: "not yet." });
  });
  it("skips the turn once it is", () => {
    const p = patchOf(decide(game(), "abhi", { type: "timeout", step: 3 }, T0 + TURN_MS));
    expect(p.world?.turn).toBe(1);
    expect(p.world?.tanks[0].skips).toBe(1);
    expect(p.status).toBeUndefined();
  });
  it(`loses the battle for a player who lets it run out ${SKIPS_TO_LOSE} times in a row`, () => {
    const g = game();
    g.world.tanks[0].skips = SKIPS_TO_LOSE - 1;
    const p = patchOf(decide(g, "abhi", { type: "timeout", step: 3 }, T0 + TURN_MS));
    expect(p).toMatchObject({
      status: "over",
      winner: 1,
      reason: "left the battle",
    });
  });
});

describe("the rest", () => {
  it("lets either player give up", () => {
    expect(patchOf(decide(game(), "abhi", { type: "resign" }, T0))).toMatchObject({ status: "over", winner: 0, reason: "surrendered" });
  });
  it("only cancels an open battle, by the one who made it", () => {
    const open = game({ p2: null, status: "waiting" });
    expect(patchOf(decide(open, "anu", { type: "cancel" }, T0))).toMatchObject({
      status: "over",
      reason: "cancelled",
    });
    expect("error" in decide(game(), "anu", { type: "cancel" }, T0)).toBe(true);
  });
  it("offers a rematch only once the battle is over", () => {
    expect(decide(game({ status: "over", winner: 0 }), "abhi", { type: "rematch" }, T0)).toEqual({ rematch: true });
    expect("error" in decide(game(), "abhi", { type: "rematch" }, T0)).toBe(true);
  });
});

describe("parseAction", () => {
  it("accepts well-formed actions", () => {
    expect(
      parseAction({
        type: "fire",
        step: 2,
        shot: { weapon: "nuke", angle: 30, power: 90 },
      }),
    ).toEqual({
      type: "fire",
      step: 2,
      shot: { weapon: "nuke", angle: 30, power: 90 },
    });
    expect(parseAction({ type: "move", step: 2, dir: -1 })).toEqual({
      type: "move",
      step: 2,
      dir: -1,
    });
    expect(parseAction({ type: "rematch", extra: 1 })).toEqual({
      type: "rematch",
    });
  });
  it("rejects anything else", () => {
    expect(
      parseAction({
        type: "fire",
        step: 2,
        shot: { weapon: "laser", angle: 30, power: 90 },
      }),
    ).toBeNull();
    expect(
      parseAction({
        type: "fire",
        shot: { weapon: "shell", angle: 30, power: 90 },
      }),
    ).toBeNull();
    expect(parseAction({ type: "move", step: 2, dir: 5 })).toBeNull();
    expect(parseAction("fire")).toBeNull();
  });
});
