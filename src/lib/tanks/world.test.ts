import { describe, expect, it } from "vitest";
import { aim, drive, fire, groundAt, MAX_SHOTS, MOVE_DIST, newWorld, shotError, skip, startShot, step, W, windFor, type Shot, type World } from "./world";

const calm = (w: World): World => ({ ...w, wind: 0 });
const run = (w: World, shot: Shot) => {
  const s = startShot(w, shot);
  while (step(s));
  return s;
};

describe("newWorld", () => {
  it("is the same for the same seed", () => {
    expect(newWorld(42)).toEqual(newWorld(42));
    expect(newWorld(42).ground).not.toEqual(newWorld(43).ground);
  });
  it("puts a tank near each end on flat ground, left to shoot first", () => {
    const w = newWorld(7);
    const [a, b] = w.tanks;
    expect(a.x).toBeLessThan(W / 3);
    expect(b.x).toBeGreaterThan((2 * W) / 3);
    for (const t of w.tanks) expect(groundAt(w.ground, t.x - 10)).toBe(groundAt(w.ground, t.x + 10));
    expect(w.turn).toBe(0);
    expect(w.wind).toBe(windFor(7, 0));
  });
  it("has the wind between -10 and 10", () => {
    for (let r = 0; r < 200; r++) expect(Math.abs(windFor(99, r))).toBeLessThanOrEqual(10);
  });
});

describe("fire", () => {
  it("comes out the same every time", () => {
    const w = newWorld(5);
    expect(fire(w, { weapon: "heavy", angle: 50, power: 70 })).toEqual(fire(w, { weapon: "heavy", angle: 50, power: 70 }));
  });
  it("leaves the world it was given alone", () => {
    const w = newWorld(5);
    const copy = structuredClone(w);
    fire(w, { weapon: "nuke", angle: 50, power: 70 });
    expect(w).toEqual(copy);
  });
  it("hurts your own tank when the shell comes straight back down", () => {
    const after = fire(calm(newWorld(3)), {
      weapon: "shell",
      angle: 90,
      power: 50,
    });
    expect(after.tanks[0].hp).toBeLessThan(100);
    expect(after.tanks[1].hp).toBe(100);
  });
  it("blows a crater where it lands", () => {
    const w = calm(newWorld(11));
    const s = run(w, { weapon: "heavy", angle: 60, power: 55 });
    expect(s.booms).toHaveLength(1);
    const x = Math.round(s.booms[0].x);
    expect(s.world.ground[x]).toBeLessThan(w.ground[x]);
  });
  it("piles up dirt instead, and hurts nobody", () => {
    const w = calm(newWorld(11));
    const s = run(w, { weapon: "dirt", angle: 60, power: 55 });
    const x = Math.round(s.booms[0].x);
    expect(s.world.ground[x]).toBeGreaterThan(w.ground[x]);
    expect(s.hits).toHaveLength(0);
  });
  it("fires three shells for a triple and five pieces for a cluster", () => {
    const w = calm(newWorld(11));
    expect(run(w, { weapon: "triple", angle: 60, power: 55 }).booms).toHaveLength(3);
    expect(run(w, { weapon: "cluster", angle: 60, power: 55 }).booms.length).toBe(5);
  });
  it("bounces a bouncer before it goes off", () => {
    const s = run(calm(newWorld(11)), {
      weapon: "bouncer",
      angle: 60,
      power: 55,
    });
    expect(s.bounces.length).toBeGreaterThan(0);
    expect(s.booms).toHaveLength(1);
  });
  it("uses up limited weapons and passes the turn with a new wind", () => {
    const w = newWorld(8);
    const after = fire(w, { weapon: "nuke", angle: 45, power: 10 });
    expect(after.tanks[0].ammo.nuke).toBe(0);
    expect(after.turn).toBe(1);
    expect(after.shots).toBe(1);
    expect(after.wind).toBe(windFor(8, 1));
    expect(
      shotError({ ...after, turn: 0 }, 0, {
        weapon: "nuke",
        angle: 45,
        power: 10,
      }),
    ).toMatch(/out of nuke/);
  });
  it("refuses shots out of turn or out of range", () => {
    const w = newWorld(8);
    expect(shotError(w, 1, { weapon: "shell", angle: 45, power: 50 })).toMatch(/not your turn/);
    expect(shotError(w, 0, { weapon: "shell", angle: 181, power: 50 })).toMatch(/angle/);
    expect(shotError(w, 0, { weapon: "shell", angle: 45, power: 101 })).toMatch(/power/);
    expect(shotError(w, 0, { weapon: "shell", angle: 45.5, power: 50 })).toMatch(/angle/);
    expect(shotError(w, 0, { weapon: "shell", angle: 45, power: 50 })).toBeNull();
  });
});

describe("the end", () => {
  it("is won by the tank still standing", () => {
    const w = newWorld(3);
    w.tanks[0].hp = 1;
    const after = fire(calm(w), { weapon: "shell", angle: 90, power: 50 });
    expect(after.over).toEqual({ winner: 1, reason: "destroyed" });
  });
  it("goes to the healthier tank after the last shot", () => {
    const w = { ...newWorld(3), shots: MAX_SHOTS - 1 };
    w.tanks[1].hp = 40;
    const after = fire(w, { weapon: "shell", angle: 45, power: 0 });
    expect(after.over?.winner).toBe(0);
    expect(after.over?.reason).toBe("out of shots");
  });
});

describe("drive", () => {
  it("moves the tank and uses up a drive", () => {
    const w = newWorld(4);
    const after = drive(w, 1)!;
    expect(after.tanks[0].x).toBe(w.tanks[0].x + MOVE_DIST);
    expect(after.tanks[0].moves).toBe(w.tanks[0].moves - 1);
    expect(after.turn).toBe(0);
  });
  it("stops short of the other tank", () => {
    const w = newWorld(4);
    w.tanks[0].x = w.tanks[1].x - 70;
    expect(drive(w, 1)!.tanks[0].x).toBe(w.tanks[1].x - 60);
  });
  it("can't drive once the drives are used up", () => {
    const w = newWorld(4);
    w.tanks[0].moves = 0;
    expect(drive(w, 1)).toBeNull();
  });
});

describe("skip", () => {
  it("passes the turn and counts the skip", () => {
    const after = skip(newWorld(4));
    expect(after.turn).toBe(1);
    expect(after.tanks[0].skips).toBe(1);
    expect(after.shots).toBe(0);
  });
});

describe("the computer", () => {
  it("hits on hard when it doesn't miss on purpose", () => {
    // random() = 0.5: no special weapon, no wobble.
    const w = newWorld(21);
    const shot = aim({ ...w, turn: 1 }, 1, "hard", () => 0.5);
    expect(shot.weapon).toBe("shell");
    const after = fire({ ...w, turn: 1 }, shot);
    expect(after.tanks[0].hp).toBeLessThan(100);
  });
});
