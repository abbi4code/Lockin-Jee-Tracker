// Chess sounds (Web Audio, no files), so you hear the other side move even when you're not looking: a wooden "tok"
// for a move, a heavier double knock for a capture, a sharp two-note ping for check, a rising four-note fanfare for
// checkmate, and a falling phrase for any other ending (draw, resignation, time). On by default; the switch on the
// chess page is remembered on this device.

const KEY = "lockin-chess-sound";

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode: the switch just isn't remembered.
  }
}

export type ChessSound = "move" | "capture" | "check" | "mate" | "end" | "start" | "low";

interface Note {
  /** Start and end frequency (a drop makes it knock, not ring). */
  from: number;
  to?: number;
  at: number;
  length: number;
  gain: number;
  wave: OscillatorType;
}

const knock = (at: number, from: number, gain = 0.32): Note => ({ from, to: from * 0.35, at, length: 0.09, gain, wave: "triangle" });

const SOUNDS: Record<ChessSound, Note[]> = {
  move: [knock(0, 520)],
  capture: [knock(0, 380, 0.4), knock(0.05, 260, 0.34)],
  check: [
    { from: 988, at: 0, length: 0.12, gain: 0.12, wave: "square" },
    { from: 1319, at: 0.1, length: 0.16, gain: 0.12, wave: "square" },
  ],
  mate: [
    { from: 523, at: 0, length: 0.22, gain: 0.16, wave: "sine" },
    { from: 659, at: 0.13, length: 0.22, gain: 0.16, wave: "sine" },
    { from: 784, at: 0.26, length: 0.22, gain: 0.16, wave: "sine" },
    { from: 1047, at: 0.39, length: 0.6, gain: 0.18, wave: "sine" },
  ],
  end: [
    { from: 587, at: 0, length: 0.25, gain: 0.15, wave: "sine" },
    { from: 440, at: 0.18, length: 0.25, gain: 0.15, wave: "sine" },
    { from: 349, at: 0.36, length: 0.5, gain: 0.15, wave: "sine" },
  ],
  /** The opponent joined: the game is on. */
  start: [
    { from: 659, at: 0, length: 0.15, gain: 0.14, wave: "sine" },
    { from: 988, at: 0.11, length: 0.3, gain: 0.14, wave: "sine" },
  ],
  /** Your clock just went under ten seconds. */
  low: [
    { from: 1500, at: 0, length: 0.05, gain: 0.06, wave: "square" },
    { from: 1500, at: 0.12, length: 0.05, gain: 0.06, wave: "square" },
  ],
};

let ctx: AudioContext | null = null;

/** Browsers only allow sound after the page has been touched: call this from a tap or click. */
export function unlockSound() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    // No audio here.
  }
}

export function playSound(sound: ChessSound) {
  if (!soundOn()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    for (const n of SOUNDS[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + n.at;
      osc.type = n.wave;
      osc.frequency.setValueAtTime(n.from, t);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.length);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(n.gain, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.length + 0.05);
    }
  } catch {
    // Audio blocked or unavailable: the vibration still happens.
  }
}

/** Which sound a move makes, from the position after it. */
export function moveSound(after: { isCheckmate(): boolean; isGameOver(): boolean; inCheck(): boolean }, captured: boolean): ChessSound {
  if (after.isCheckmate()) return "mate";
  if (after.isGameOver()) return "end";
  if (after.inCheck()) return "check";
  return captured ? "capture" : "move";
}
