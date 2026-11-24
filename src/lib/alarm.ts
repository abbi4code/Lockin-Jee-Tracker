// The end-of-break alarm (Web Audio, no files): a bright two-note beep, three times, repeated three rounds
// (about 8 s) unless it's stopped sooner. Phones only allow sound from a context that was started by a tap,
// so `unlockAlarm` is called from the "start break" tap and the same context plays the alarm later.
// The on/off switch is remembered on this device.

const KEY = "lockin-break-sound";

export function breakSoundOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBreakSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode: the switch just isn't remembered.
  }
}

let ctx: AudioContext | null = null;

/** Call from a tap: makes (or wakes) the audio context the alarm will play on. */
export function unlockAlarm() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    // No audio here.
  }
}

function beep(c: AudioContext, at: number, freq: number, length: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.22, at + 0.01);
  g.gain.setValueAtTime(0.22, at + length * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
  return osc;
}

/** Plays the alarm. Returns a function that stops it early. */
export function playAlarm(rounds = 3): () => void {
  const playing: OscillatorNode[] = [];
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.05;
    for (let r = 0; r < rounds; r++)
      for (let b = 0; b < 3; b++) {
        const at = t0 + r * 2.8 + b * 0.36;
        playing.push(beep(ctx, at, 880, 0.14), beep(ctx, at + 0.15, 1175, 0.16));
      }
  } catch {
    // Audio blocked or unavailable: the vibration and notification still happen.
  }
  return () => {
    for (const o of playing) {
      try {
        o.stop();
      } catch {
        // Already stopped.
      }
    }
  };
}

/** A short preview when the sound is switched on. */
export const previewAlarm = () => playAlarm(1);
