// Tank battle sounds (Web Audio, no files): a thump when a tank fires, a noisy boom for every blast (deeper for
// the nuke), a soft thud for dirt, a knock for each bounce, a clang when a tank is hit, an engine rumble for a
// drive, a ping when it's your turn, and a phrase for winning or losing. On by default; the switch on the tanks
// page is remembered on this device.

const KEY = "lockin-tanks-sound";

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

export type TankSound = "fire" | "boom" | "big" | "dirt" | "bounce" | "hit" | "drive" | "turn" | "win" | "lose";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Browsers only allow sound after the page has been touched: call this from a tap or click. */
export function unlockSound() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    // No audio here.
  }
}

function tone(c: AudioContext, at: number, from: number, to: number, length: number, gain: number, wave: OscillatorType) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + length);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** White noise through a low-pass filter that closes as it fades: an explosion. */
function burst(c: AudioContext, at: number, length: number, gain: number, from: number, to: number) {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + length);
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + length + 0.05);
}

export function playSound(sound: TankSound) {
  if (!soundOn()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const c = ctx;
    const t = c.currentTime + 0.01;
    switch (sound) {
      case "fire":
        tone(c, t, 160, 45, 0.25, 0.35, "triangle");
        burst(c, t, 0.18, 0.25, 2400, 300);
        break;
      case "boom":
        burst(c, t, 0.7, 0.5, 1800, 80);
        tone(c, t, 90, 35, 0.5, 0.35, "sine");
        break;
      case "big":
        burst(c, t, 1.8, 0.6, 1400, 40);
        tone(c, t, 70, 25, 1.4, 0.45, "sine");
        break;
      case "dirt":
        burst(c, t, 0.35, 0.3, 500, 80);
        break;
      case "bounce":
        tone(c, t, 420, 150, 0.09, 0.25, "triangle");
        break;
      case "hit":
        tone(c, t, 330, 300, 0.25, 0.1, "square");
        tone(c, t + 0.02, 495, 460, 0.2, 0.07, "square");
        break;
      case "drive":
        tone(c, t, 55, 75, 0.45, 0.18, "sawtooth");
        burst(c, t, 0.45, 0.12, 300, 150);
        break;
      case "turn":
        tone(c, t, 659, 659, 0.15, 0.14, "sine");
        tone(c, t + 0.11, 988, 988, 0.3, 0.14, "sine");
        break;
      case "win":
        [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.13, f, f, i === 3 ? 0.6 : 0.22, 0.16, "sine"));
        break;
      case "lose":
        [587, 440, 349].forEach((f, i) => tone(c, t + i * 0.18, f, f, i === 2 ? 0.5 : 0.25, 0.15, "sine"));
        break;
    }
  } catch {
    // Audio blocked or unavailable.
  }
}
