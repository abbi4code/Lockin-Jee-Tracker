import confetti from "canvas-confetti";

const COLORS = { physics: "#8f7cff", chemistry: "#b8f34c", maths: "#ff7a45" } as const;

/** Confetti burst for finishing a chapter, in the subject's colours. */
export function celebrate(subject: keyof typeof COLORS) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate?.([20, 40, 30]);
  const colors = [COLORS[subject], "#ff3fa4", "#ffffff"];
  const fire = (x: number, angle: number) =>
    confetti({ particleCount: 70, spread: 70, startVelocity: 55, angle, origin: { x, y: 0.85 }, colors, scalar: 1.1, ticks: 220, disableForReducedMotion: true });
  fire(0.1, 60);
  fire(0.9, 120);
  const emoji = confetti.shapeFromText({ text: "🔥", scalar: 2.2 });
  setTimeout(() => confetti({ particleCount: 16, spread: 100, startVelocity: 35, origin: { y: 0.6 }, shapes: [emoji], scalar: 2.2, ticks: 160 }), 220);
}
