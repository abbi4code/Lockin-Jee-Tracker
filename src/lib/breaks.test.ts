import { describe, expect, it } from "vitest";
import { breakPhase, endDue, extendBreak, newBreak, ringNow, RING_WINDOW_MS, STALE_MS, suggestedBreak } from "./breaks";

const MIN = 60_000;
const NOW = 1_000_000_000;

describe("a break", () => {
  it("runs for its length, clamped to 1–60 minutes", () => {
    expect(newBreak(5, NOW)).toEqual({ startedAt: NOW, endsAt: NOW + 5 * MIN, minutes: 5, rung: false });
    expect(newBreak(0, NOW).minutes).toBe(1);
    expect(newBreak(500, NOW).minutes).toBe(60);
  });

  it("is on, then over, then forgotten after an hour over", () => {
    const b = newBreak(5, NOW);
    expect(breakPhase(b, NOW + 4 * MIN)).toBe("on");
    expect(breakPhase(b, NOW + 5 * MIN)).toBe("over");
    expect(breakPhase(b, NOW + 5 * MIN + STALE_MS)).toBe("over");
    expect(breakPhase(b, NOW + 5 * MIN + STALE_MS + 1)).toBe("stale");
  });

  it("rings once, only right after it ends", () => {
    const b = newBreak(5, NOW);
    const end = NOW + 5 * MIN;
    expect(ringNow(b, end - 1)).toBe(false);
    expect(ringNow(b, end)).toBe(true);
    expect(ringNow(b, end + RING_WINDOW_MS)).toBe(true);
    // Opened the app long after: handled quietly.
    expect(ringNow(b, end + RING_WINDOW_MS + 1)).toBe(false);
    expect(endDue(b, end + RING_WINDOW_MS + 1)).toBe(true);
    expect(endDue({ ...b, rung: true }, end)).toBe(false);
  });

  it("gets more time added to what's left, or from now once it's over, and rings again", () => {
    const b = newBreak(5, NOW);
    expect(extendBreak(b, 2, NOW + MIN)).toMatchObject({ endsAt: NOW + 7 * MIN, minutes: 7 });
    const over = { ...b, rung: true };
    const later = extendBreak(over, 5, NOW + 8 * MIN);
    expect(later).toMatchObject({ endsAt: NOW + 13 * MIN, minutes: 13, rung: false });
  });
});

describe("the suggested length", () => {
  it("grows with the session and every 4th pomodoro gets a long one", () => {
    expect(suggestedBreak(25, 1)).toBe(5);
    expect(suggestedBreak(50, 1)).toBe(10);
    expect(suggestedBreak(90, 2)).toBe(15);
    expect(suggestedBreak(25, 4)).toBe(15);
    expect(suggestedBreak(25, 8)).toBe(15);
    expect(suggestedBreak(25, 0)).toBe(5);
  });
});
