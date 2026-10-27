import { drive, fire, isWeapon, shotError, skip, surrender, type Shot, type Side, type World } from "./world";

// The server's referee for online tank battles. Players can't write public.tank_games themselves
// (20261028120000_tanks.sql): creating, joining, every shot and drive, resigning and rematches go through
// /api/tanks, which runs them through `decide` here. Shots are simulated on the server (lib/tanks/world.ts), so
// the damage and craters are the server's, not whatever a player's app claims.

export interface TankGame {
  id: string;
  /** p1 plays the left tank and shoots first; p2 the right one. */
  p1: string;
  p2: string | null;
  p1_name: string;
  p2_name: string;
  status: "waiting" | "active" | "over";
  winner: Side | null;
  reason: string | null;
  /** Bumped by every change: the write guard, and how the apps know what they've missed. */
  step: number;
  world: World;
  /** What the last change was, so the other player's app can play it (a shot flies, a tank drives). */
  last: Last | null;
  /** The rematch, once one of them asks for it. */
  next: string | null;
  /** When the side to move's turn started. */
  moved_at: string;
  updated_at: string;
}

export type Last = { kind: "fire"; by: Side; shot: Shot } | { kind: "move"; by: Side; dir: -1 | 1 } | { kind: "skip"; by: Side } | { kind: "join" } | { kind: "end" };

export type Action =
  | { type: "fire"; step: number; shot: Shot }
  | { type: "move"; step: number; dir: -1 | 1 }
  | { type: "timeout"; step: number }
  | { type: "resign" }
  | { type: "cancel" }
  | { type: "join"; name: string }
  | { type: "rematch" };

export type Patch = Partial<Pick<TankGame, "world" | "last" | "step" | "status" | "winner" | "reason" | "moved_at" | "p2" | "p2_name">>;

/** How long a turn lasts online. A turn that runs out is skipped; SKIPS_TO_LOSE in a row and you've left. */
export const TURN_MS = 60_000;
export const SKIPS_TO_LOSE = 3;

export const seatOf = (g: Pick<TankGame, "p1" | "p2">, user: string): Side | null => (g.p1 === user ? 0 : g.p2 === user ? 1 : null);

/** When the side to move's turn runs out. */
export const deadline = (g: Pick<TankGame, "moved_at">) => new Date(g.moved_at).getTime() + TURN_MS;

/** The patch for a changed world: the step moves on, and a finished battle ends the game. */
function after(g: TankGame, world: World, last: Last, extra: Patch = {}): Patch {
  return {
    world,
    last,
    step: g.step + 1,
    ...extra,
    ...(world.over
      ? {
          status: "over" as const,
          winner: world.over.winner,
          reason: world.over.reason,
        }
      : {}),
  };
}

/**
 * What `user` doing `action` changes in game `g`, or why it's refused. `rematch` is answered with
 * `{ rematch: true }`: the caller makes the new game. Pure: the caller writes the patch.
 */
export function decide(g: TankGame, user: string, action: Action, now = Date.now()): { patch: Patch } | { rematch: true } | { error: string } {
  const at = new Date(now).toISOString();
  if (action.type === "join") {
    if (seatOf(g, user) !== null) return { patch: {} };
    if (g.p2 || g.status !== "waiting") return { error: "two players are already in this battle." };
    return {
      patch: {
        p2: user,
        p2_name: action.name.slice(0, 40),
        status: "active",
        moved_at: at,
        step: g.step + 1,
        last: { kind: "join" },
      },
    };
  }
  const me = seatOf(g, user);
  if (me === null) return { error: "you're not in this battle." };

  if (action.type === "cancel") {
    if (g.status !== "waiting" || me !== 0) return { error: "only an open battle you made can be cancelled." };
    return {
      patch: {
        status: "over",
        reason: "cancelled",
        step: g.step + 1,
        last: { kind: "end" },
      },
    };
  }
  if (action.type === "rematch") {
    if (g.status !== "over" || !g.p2 || g.reason === "cancelled") return { error: "a rematch is for a finished battle." };
    return { rematch: true };
  }
  if (g.status !== "active")
    return {
      error: g.status === "waiting" ? "your opponent hasn't joined yet." : "this battle is over.",
    };
  if (action.type === "resign") return { patch: after(g, surrender(g.world, me), { kind: "end" }) };
  if (action.step !== g.step) return { error: "the battle moved on. it's been reloaded." };

  switch (action.type) {
    case "fire": {
      const why = shotError(g.world, me, action.shot);
      if (why) return { error: why };
      return {
        patch: after(g, fire(g.world, action.shot), { kind: "fire", by: me, shot: action.shot }, { moved_at: at }),
      };
    }
    case "move": {
      if (g.world.turn !== me) return { error: "it's not your turn." };
      const moved = drive(g.world, action.dir);
      if (!moved)
        return {
          error: g.world.tanks[me].moves ? "you can't drive that way." : "no drives left.",
        };
      // Driving doesn't restart your turn's time.
      return {
        patch: after(g, moved, { kind: "move", by: me, dir: action.dir }),
      };
    }
    case "timeout": {
      // Either app reports a turn that ran out; the server checks it on its own clock.
      if (now < deadline(g)) return { error: "not yet." };
      const side = g.world.turn;
      let world = skip(g.world);
      if (world.tanks[side].skips >= SKIPS_TO_LOSE) world = surrender(world, side, "left the battle");
      return {
        patch: after(g, world, { kind: "skip", by: side }, { moved_at: at }),
      };
    }
  }
}

/** Checks a request body is an Action (it comes from the network). */
export function parseAction(x: unknown): Action | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  const step = Number.isInteger(a.step) ? (a.step as number) : null;
  switch (a.type) {
    case "fire": {
      const s = a.shot as Record<string, unknown> | undefined;
      if (step === null || !s || !isWeapon(s.weapon) || !Number.isInteger(s.angle) || !Number.isInteger(s.power)) return null;
      return {
        type: "fire",
        step,
        shot: {
          weapon: s.weapon,
          angle: s.angle as number,
          power: s.power as number,
        },
      };
    }
    case "move":
      if (step === null || (a.dir !== 1 && a.dir !== -1)) return null;
      return { type: "move", step, dir: a.dir };
    case "timeout":
      return step === null ? null : { type: "timeout", step };
    case "join":
      return { type: "join", name: typeof a.name === "string" ? a.name : "" };
    case "resign":
    case "cancel":
    case "rematch":
      return { type: a.type };
    default:
      return null;
  }
}
