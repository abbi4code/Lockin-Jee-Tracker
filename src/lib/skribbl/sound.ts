// Short skribbl sounds (Web Audio, no files), like lib/chime.ts. On by default; the mute switch in the game is
// remembered on this device.

const KEY = "lockin-skribbl-sound";

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

const NOTES: Record<"turn" | "guessed" | "mine" | "tick" | "end", [freq: number, at: number, length: number][]> = {
  /** Your turn to pick a word. */
  turn: [
    [523, 0, 0.18],
    [784, 0.12, 0.3],
  ],
  /** Someone else got it. */
  guessed: [[880, 0, 0.16]],
  /** You got it. */
  mine: [
    [660, 0, 0.14],
    [990, 0.1, 0.14],
    [1320, 0.2, 0.3],
  ],
  /** The last seconds. */
  tick: [[1200, 0, 0.05]],
  /** Time's up / the word is shown. */
  end: [
    [440, 0, 0.2],
    [330, 0.16, 0.35],
  ],
};

let ctx: AudioContext | null = null;

export function play(sound: keyof typeof NOTES) {
  if (!soundOn()) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    for (const [freq, at, length] of NOTES[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + at;
      osc.type = sound === "tick" ? "square" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(sound === "tick" ? 0.04 : 0.14, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
  } catch {
    // Audio blocked or unavailable.
  }
}
