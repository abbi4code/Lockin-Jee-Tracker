// Tank battle (/extras/tanks), in the spirit of Pocket Tanks: two tanks on hilly ground take turns firing. You set
// an angle and a power, pick a weapon, and the shell flies under gravity and the wind; explosions blow craters in
// the ground and hurt any tank nearby (yours too). Each tank can also drive a little, a few times a game. A tank at
// 0 health loses; after MAX_SHOTS shots the healthier tank wins.
//
// Everything here is plain arithmetic on plain data, so the same code runs the animation in the browser and the
// referee on the server (lib/tanks/rules.ts). A shot is simulated tick by tick: `startShot`, then `step` until it's
// done (the screen draws every tick), then `finish`. `fire` does all three at once.
//
// Coordinates are world units with y pointing up: the field is W × H, the ground is one height per column.

export const W = 800;
export const H = 450;
/** Simulation ticks per second. */
export const HZ = 120;
const DT = 1 / HZ;
const GRAVITY = 300;
/** Sideways pull per point of wind (units/s²). Wind runs from -10 (to the left) to 10. */
const WIND_ACC = 4;
const MAX_WIND = 10;
export const MAX_HP = 100;
/** How close a shell must come to a tank's middle to hit it. */
export const TANK_R = 13;
/** Drives per tank per game, and how far each one goes. */
export const MOVES = 4;
export const MOVE_DIST = 45;
/** Tanks can't drive closer to each other than this. */
const MIN_GAP = 60;
/** After this many shots in all, the tank with more health left wins. */
export const MAX_SHOTS = 60;
const MIN_GROUND = 6;
const MAX_GROUND = H - 40;
/** The longest a shot can take (s): anything still flying then is lost. */
const MAX_FLIGHT = 20;

export type WeaponId = "shell" | "heavy" | "triple" | "sniper" | "bouncer" | "roller" | "cluster" | "dirt" | "nuke";

export interface Weapon {
  id: WeaponId;
  name: string;
  /** How many each tank gets; Infinity: never runs out. */
  count: number;
  about: string;
  radius: number;
  damage: number;
}

export const WEAPONS: Weapon[] = [
  {
    id: "shell",
    name: "shell",
    count: Infinity,
    about: "the basic shot. never runs out.",
    radius: 24,
    damage: 24,
  },
  {
    id: "heavy",
    name: "heavy",
    count: 3,
    about: "a bigger blast.",
    radius: 36,
    damage: 38,
  },
  {
    id: "triple",
    name: "triple",
    count: 2,
    about: "three shells in a fan.",
    radius: 20,
    damage: 16,
  },
  {
    id: "sniper",
    name: "sniper",
    count: 2,
    about: "fast and flat. small blast, hits hard.",
    radius: 12,
    damage: 48,
  },
  {
    id: "bouncer",
    name: "bouncer",
    count: 2,
    about: "bounces three times, then goes off.",
    radius: 24,
    damage: 26,
  },
  {
    id: "roller",
    name: "roller",
    count: 2,
    about: "rolls downhill after it lands, then explodes.",
    radius: 30,
    damage: 32,
  },
  {
    id: "cluster",
    name: "cluster",
    count: 2,
    about: "splits into five at the top of its arc.",
    radius: 18,
    damage: 14,
  },
  {
    id: "dirt",
    name: "dirt",
    count: 2,
    about: "piles up a hill. build a wall, or bury them.",
    radius: 46,
    damage: 0,
  },
  {
    id: "nuke",
    name: "nuke",
    count: 1,
    about: "huge. one per game.",
    radius: 80,
    damage: 60,
  },
];
export const weapon = (id: WeaponId) => WEAPONS.find((w) => w.id === id)!;
export const isWeapon = (x: unknown): x is WeaponId => WEAPONS.some((w) => w.id === x);

export interface Tank {
  x: number;
  hp: number;
  /** The tank's last aim: 0° points right, 90° straight up, 180° left. */
  angle: number;
  /** 0–100. */
  power: number;
  moves: number;
  /** Shots left of each weapon that runs out. */
  ammo: Partial<Record<WeaponId, number>>;
  /** Turns in a row this tank let run out without shooting (online games). */
  skips: number;
}

export type Side = 0 | 1;

export interface World {
  seed: number;
  ground: number[];
  tanks: [Tank, Tank];
  turn: Side;
  /** Shots fired so far. */
  shots: number;
  /** Turns played so far, shots and skips: each turn has its own wind. */
  round: number;
  wind: number;
  over: { winner: Side | null; reason: string } | null;
}

export interface Shot {
  weapon: WeaponId;
  angle: number;
  power: number;
}

/** A small, fast seeded random generator (mulberry32): the same seed gives the same game everywhere. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The wind for turn `round` of game `seed`: a whole number from -10 to 10. */
export const windFor = (seed: number, round: number) => Math.round((rng(seed ^ Math.imul(round + 1, 0x9e3779b1))() * 2 - 1) * MAX_WIND);

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

const freshTank = (x: number, angle: number): Tank => ({
  x,
  hp: MAX_HP,
  angle,
  power: 60,
  moves: MOVES,
  ammo: Object.fromEntries(WEAPONS.filter((w) => w.count !== Infinity).map((w) => [w.id, w.count])),
  skips: 0,
});

/** A new battlefield: rolling hills from the seed, a tank near each end on a little flat patch. Left shoots first. */
export function newWorld(seed: number): World {
  const r = rng(seed);
  const waves = [
    { amp: 45 + r() * 50, freq: (1 + r() * 1.5) / W },
    { amp: 18 + r() * 25, freq: (3 + r() * 3) / W },
    { amp: 5 + r() * 7, freq: (10 + r() * 8) / W },
  ].map((w) => ({ ...w, phase: r() * Math.PI * 2 }));
  const base = 120 + r() * 70;
  const ground = Array.from({ length: W }, (_, x) => {
    const h = waves.reduce((sum, w) => sum + w.amp * Math.sin(w.freq * Math.PI * 2 * x + w.phase), base);
    return Math.round(Math.min(MAX_GROUND - 60, Math.max(40, h)));
  });
  const xs = [70 + Math.floor(r() * 110), W - 70 - Math.floor(r() * 110)];
  for (const tx of xs) {
    const level = ground[tx];
    for (let x = tx - 14; x <= tx + 14; x++) ground[x] = level;
  }
  return {
    seed: seed >>> 0,
    ground,
    tanks: [freshTank(xs[0], 45), freshTank(xs[1], 135)],
    turn: 0,
    shots: 0,
    round: 0,
    wind: windFor(seed, 0),
    over: null,
  };
}

export const groundAt = (ground: number[], x: number) => ground[Math.max(0, Math.min(W - 1, Math.floor(x)))];

/** Where a tank's barrel turns, and its middle (what shells must hit). */
export const pivotOf = (ground: number[], t: Tank) => ({
  x: t.x,
  y: groundAt(ground, t.x) + 10,
});
const middleOf = (ground: number[], t: Tank) => ({
  x: t.x,
  y: groundAt(ground, t.x) + 6,
});
export const BARREL = 16;

const clone = (w: World): World => ({
  ...w,
  ground: w.ground.slice(),
  tanks: [
    { ...w.tanks[0], ammo: { ...w.tanks[0].ammo } },
    { ...w.tanks[1], ammo: { ...w.tanks[1].ammo } },
  ],
  over: w.over && { ...w.over },
});

export const ammoOf = (t: Tank, id: WeaponId) => (weapon(id).count === Infinity ? Infinity : (t.ammo[id] ?? 0));

/** Why `side` can't take `shot` now, or null if it can. */
export function shotError(w: World, side: Side, shot: Shot): string | null {
  if (w.over) return "the battle is over.";
  if (w.turn !== side) return "it's not your turn.";
  if (!isWeapon(shot.weapon)) return "no such weapon.";
  if (!Number.isInteger(shot.angle) || shot.angle < 0 || shot.angle > 180) return "the angle runs from 0 to 180.";
  if (!Number.isInteger(shot.power) || shot.power < 0 || shot.power > 100) return "the power runs from 0 to 100.";
  if (ammoOf(w.tanks[side], shot.weapon) <= 0) return `you're out of ${weapon(shot.weapon).name}.`;
  return null;
}

// ---- One shot, tick by tick ----

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weapon: WeaponId;
  radius: number;
  damage: number;
  /** Rolling along the ground (a roller after it lands), and which way. */
  rolling: number;
  rolled: number;
  bounces: number;
  /** A cluster that has already split, or one of its pieces. */
  split: boolean;
  age: number;
  dead: boolean;
  /** Recent positions, for the trail. */
  trail: { x: number; y: number }[];
}

export interface Boom {
  x: number;
  y: number;
  radius: number;
  tick: number;
  dirt: boolean;
}
export interface Hit {
  tank: Side;
  damage: number;
  tick: number;
  /** From falling into a crater rather than the blast. */
  fall: boolean;
}

export interface Sim {
  world: World;
  by: Side;
  shot: Shot;
  bullets: Bullet[];
  booms: Boom[];
  hits: Hit[];
  /** Ticks at which a bouncer bounced. */
  bounces: number[];
  tick: number;
  done: boolean;
  /** Goes up whenever the ground changes, so the screen knows to redraw it. */
  groundVersion: number;
}

function launch(x: number, y: number, angle: number, speed: number, wpn: Weapon): Bullet {
  const a = (angle * Math.PI) / 180;
  return {
    x,
    y,
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed,
    weapon: wpn.id,
    radius: wpn.radius,
    damage: wpn.damage,
    rolling: 0,
    rolled: 0,
    bounces: wpn.id === "bouncer" ? 3 : 0,
    split: false,
    age: 0,
    dead: false,
    trail: [],
  };
}

export const speedOf = (power: number, id: WeaponId) => (30 + power * 5.4) * (id === "sniper" ? 1.6 : 1);

/** Starts `w.turn`'s shot. The world inside is a copy: `w` itself is left alone. */
export function startShot(w: World, shot: Shot): Sim {
  const world = clone(w);
  const by = world.turn;
  const tank = world.tanks[by];
  tank.angle = shot.angle;
  tank.power = shot.power;
  if (weapon(shot.weapon).count !== Infinity) tank.ammo[shot.weapon] = ammoOf(tank, shot.weapon) - 1;
  const p = pivotOf(world.ground, tank);
  const a = (shot.angle * Math.PI) / 180;
  const x = p.x + Math.cos(a) * BARREL;
  const y = p.y + Math.sin(a) * BARREL;
  const wpn = weapon(shot.weapon);
  const speed = speedOf(shot.power, shot.weapon);
  const angles = shot.weapon === "triple" ? [shot.angle - 4, shot.angle, shot.angle + 4] : [shot.angle];
  return {
    world,
    by,
    shot,
    bullets: angles.map((angle) => launch(x, y, angle, speed, wpn)),
    booms: [],
    hits: [],
    bounces: [],
    tick: 0,
    done: false,
    groundVersion: 0,
  };
}

function carve(ground: number[], cx: number, cy: number, r: number) {
  for (let x = Math.max(0, Math.ceil(cx - r)); x <= Math.min(W - 1, Math.floor(cx + r)); x++) {
    const dy = Math.sqrt(r * r - (x - cx) * (x - cx));
    const bottom = cy - dy;
    if (ground[x] <= bottom) continue;
    // The ground inside the blast is gone; anything above it falls into the hole.
    const removed = Math.min(ground[x], cy + dy) - bottom;
    ground[x] = Math.max(MIN_GROUND, Math.round(ground[x] - removed));
  }
}

function pile(ground: number[], cx: number, cy: number, r: number) {
  for (let x = Math.max(0, Math.ceil(cx - r)); x <= Math.min(W - 1, Math.floor(cx + r)); x++) {
    const top = cy + Math.sqrt(r * r - (x - cx) * (x - cx));
    ground[x] = Math.min(MAX_GROUND, Math.max(ground[x], Math.round(top)));
  }
}

function explode(s: Sim, b: Bullet, x: number, y: number) {
  b.dead = true;
  const { ground, tanks } = s.world;
  const dirt = b.weapon === "dirt";
  s.booms.push({ x, y, radius: b.radius, tick: s.tick, dirt });
  const before = tanks.map((t) => groundAt(ground, t.x));
  if (!dirt) {
    tanks.forEach((t, i) => {
      if (t.hp <= 0) return;
      const m = middleOf(ground, t);
      const reach = b.radius + TANK_R;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d >= reach) return;
      const damage = Math.round(b.damage * (1 - (0.6 * d) / reach));
      t.hp = Math.max(0, t.hp - damage);
      s.hits.push({ tank: i as Side, damage, tick: s.tick, fall: false });
    });
    carve(ground, x, y, b.radius);
  } else pile(ground, x, y, b.radius);
  s.groundVersion++;
  // A tank whose ground is blown away drops into the crater, and a long drop hurts.
  tanks.forEach((t, i) => {
    const drop = before[i] - groundAt(ground, t.x);
    if (drop <= 15 || t.hp <= 0) return;
    const damage = Math.round((drop - 15) / 4);
    t.hp = Math.max(0, t.hp - damage);
    s.hits.push({ tank: i as Side, damage, tick: s.tick, fall: true });
  });
}

/** The tank a bullet at (x, y) is touching, if any. A shell can't hit its own tank as it leaves the barrel. */
function touching(s: Sim, b: Bullet, x: number, y: number, extra = 0): Side | null {
  for (const i of [0, 1] as const) {
    if (i === s.by && b.age < 30) continue;
    const m = middleOf(s.world.ground, s.world.tanks[i]);
    if (Math.hypot(m.x - x, m.y - y) < TANK_R + extra) return i;
  }
  return null;
}

/** Moves every bullet on by one tick. Returns false once the shot is over. */
export function step(s: Sim): boolean {
  if (s.done) return false;
  s.tick++;
  const { ground, wind } = s.world;
  const born: Bullet[] = [];
  for (const b of s.bullets) {
    if (b.dead) continue;
    b.age++;
    if (b.rolling) {
      const nx = b.x + b.rolling * 140 * DT;
      if (nx < 0 || nx > W - 1) {
        b.dead = true; // rolled off the edge
        continue;
      }
      // It stops (and goes off) at the bottom of a dip, or against a tank, or after rolling a long way.
      if ((b.rolled > 4 && groundAt(ground, nx) > groundAt(ground, b.x)) || b.rolled > 260 || touching(s, b, nx, groundAt(ground, nx) + 3, 4) !== null) {
        explode(s, b, b.x, groundAt(ground, b.x) + 3);
        continue;
      }
      b.rolled += Math.abs(nx - b.x);
      b.x = nx;
      b.y = groundAt(ground, nx) + 3;
    } else {
      b.vy -= GRAVITY * DT;
      b.vx += wind * WIND_ACC * DT;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      if (b.x < -60 || b.x > W + 60 || b.y < -20 || b.age > MAX_FLIGHT * HZ) {
        b.dead = true; // flew off the field
        continue;
      }
      // A cluster splits into five at the top of its arc.
      if (b.weapon === "cluster" && !b.split && b.vy <= 0 && b.age > 10) {
        b.dead = true;
        for (let k = -2; k <= 2; k++)
          born.push({
            ...b,
            vx: b.vx + k * 45,
            split: true,
            dead: false,
            trail: [],
          });
        continue;
      }
      const hitTank = touching(s, b, b.x, b.y);
      if (hitTank !== null) {
        explode(s, b, b.x, b.y);
        continue;
      }
      if (b.x >= 0 && b.x < W && b.y <= ground[Math.floor(b.x)]) {
        const gy = ground[Math.floor(b.x)];
        if (b.bounces > 0) {
          // Off the slope like a ball, losing some speed.
          const slope = (groundAt(ground, b.x + 2) - groundAt(ground, b.x - 2)) / 4;
          const len = Math.hypot(slope, 1);
          const nx = -slope / len;
          const ny = 1 / len;
          const dot = b.vx * nx + b.vy * ny;
          if (dot < 0) {
            b.vx = (b.vx - 2 * dot * nx) * 0.65;
            b.vy = (b.vy - 2 * dot * ny) * 0.65;
          }
          b.y = gy + 1;
          b.bounces--;
          s.bounces.push(s.tick);
          if (Math.hypot(b.vx, b.vy) < 40) explode(s, b, b.x, gy);
        } else if (b.weapon === "roller") {
          const left = groundAt(ground, b.x - 3);
          const right = groundAt(ground, b.x + 3);
          b.rolling = left < right ? -1 : right < left ? 1 : b.vx < 0 ? -1 : 1;
          b.y = gy + 3;
        } else explode(s, b, b.x, gy);
      }
    }
    if (!b.dead) {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 14) b.trail.shift();
    }
  }
  s.bullets.push(...born);
  s.done = s.bullets.every((b) => b.dead);
  return !s.done;
}

/** Hands the turn over once the shot is done (and decides the battle, if this shot ended it). */
export function finish(s: Sim): World {
  const w = clone(s.world);
  w.tanks[s.by].skips = 0;
  w.shots++;
  return nextTurn(w);
}

function nextTurn(w: World): World {
  w.turn = w.turn === 0 ? 1 : 0;
  w.round++;
  w.wind = windFor(w.seed, w.round);
  const [a, b] = w.tanks;
  if (a.hp <= 0 && b.hp <= 0) w.over = { winner: null, reason: "both tanks destroyed" };
  else if (a.hp <= 0 || b.hp <= 0) w.over = { winner: a.hp <= 0 ? 1 : 0, reason: "destroyed" };
  else if (w.shots >= MAX_SHOTS)
    w.over = {
      winner: a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1,
      reason: "out of shots",
    };
  return w;
}

/** The whole shot at once: the world after it. */
export function fire(w: World, shot: Shot): World {
  const s = startShot(w, shot);
  while (step(s));
  return finish(s);
}

/** The side to move drives `dir` (-1 left, 1 right). Null if it can't (no drives left, or the way is blocked). */
export function drive(w: World, dir: -1 | 1): World | null {
  if (w.over) return null;
  const me = w.tanks[w.turn];
  const them = w.tanks[w.turn === 0 ? 1 : 0];
  if (me.moves <= 0) return null;
  let x = Math.max(15, Math.min(W - 15, me.x + dir * MOVE_DIST));
  // Stop short of the other tank rather than drive through it.
  if (Math.abs(x - them.x) < MIN_GAP || Math.sign(x - them.x) !== Math.sign(me.x - them.x)) x = them.x - Math.sign(them.x - me.x) * MIN_GAP;
  if (Math.abs(x - me.x) < 1) return null;
  const next = clone(w);
  next.tanks[w.turn] = {
    ...next.tanks[w.turn],
    x: Math.round(x),
    moves: me.moves - 1,
  };
  return next;
}

/** The side to move lets its turn go (online: it ran out of time). */
export function skip(w: World): World {
  const next = clone(w);
  next.tanks[w.turn].skips++;
  return nextTurn(next);
}

/** The side to move gives up. */
export function surrender(w: World, side: Side, reason = "surrendered"): World {
  return { ...clone(w), over: { winner: side === 0 ? 1 : 0, reason } };
}

// ---- The computer ----

export type Level = "easy" | "medium" | "hard";

/** Where a plain shot from `side` at `angle`/`power` first lands (or null if it leaves the field). */
function landing(w: World, side: Side, angle: number, power: number, id: WeaponId) {
  const s = startShot({ ...w, turn: side }, { weapon: id === "sniper" ? "sniper" : "shell", angle, power });
  const b = s.bullets[0];
  b.weapon = "shell";
  const { ground } = s.world;
  for (let i = 0; i < MAX_FLIGHT * HZ; i++) {
    b.vy -= GRAVITY * DT;
    b.vx += w.wind * WIND_ACC * DT;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.age++;
    if (b.x < -60 || b.x > W + 60 || b.y < -20) return null;
    if (touching(s, b, b.x, b.y) !== null || (b.x >= 0 && b.x < W && b.y <= ground[Math.floor(b.x)])) return { x: b.x, y: b.y };
  }
  return null;
}

/**
 * The computer's shot for `side`: it searches angles and powers for the one that lands nearest the other tank,
 * then misses by a little on purpose (by a lot on easy). `random` makes the misses and weapon choice.
 */
export function aim(w: World, side: Side, level: Level, random: () => number = Math.random): Shot {
  const me = w.tanks[side];
  const them = w.tanks[side === 0 ? 1 : 0];
  const right = them.x > me.x;
  const options = WEAPONS.filter((x) => ammoOf(me, x.id) > 0 && x.id !== "dirt");
  // Specials now and then (more often the harder it plays); the nuke when it's sure.
  const chance = { easy: 0.25, medium: 0.35, hard: 0.45 }[level];
  let pick: WeaponId = "shell";
  if (random() < chance) pick = options[Math.floor(random() * options.length)].id;
  let best = { angle: right ? 45 : 135, power: 60, miss: Infinity };
  for (let a = 20; a <= 80; a += 3) {
    const angle = right ? a : 180 - a;
    for (let power = 20; power <= 100; power += 2) {
      const at = landing(w, side, angle, power, pick);
      if (!at) continue;
      const miss = Math.abs(at.x - them.x);
      if (miss < best.miss) best = { angle, power, miss };
    }
  }
  if (level === "hard" && best.miss < 10 && ammoOf(me, "nuke") > 0 && random() < 0.25) pick = "nuke";
  const spread = { easy: [9, 10], medium: [4, 5], hard: [2, 3] }[level];
  const jitter = (n: number) => (random() * 2 - 1) * n;
  return {
    weapon: pick,
    angle: Math.round(Math.max(0, Math.min(180, best.angle + jitter(spread[0])))),
    power: Math.round(Math.max(0, Math.min(100, best.power + jitter(spread[1])))),
  };
}
