import { describe, expect, it } from "vitest";
import type { StudySession } from "../store/progress";
import { clampAim, clampSolved, focusDay, focusQuestionsByDay, focusQuestionsOn, focusQuestionStats, formatPace, pace, questionLabel, questionStatus, resultLine, sessionToAsk } from "./focus";

const DAY = "2026-11-25";
/** A session starting at `hh:mm` local time on DAY. */
const s = (id: string, hhmm: string, patch: Partial<StudySession> = {}): StudySession => ({
  id,
  chapterId: null,
  subject: null,
  mode: "pomodoro",
  startedAt: new Date(`${DAY}T${hhmm}:00`).toISOString(),
  minutes: 25,
  updatedAt: 1,
  source: "timer",
  ...patch,
});
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00`).getTime();

describe("questionStatus and labels", () => {
  it("tells an answered aim from a pending one, and questions without an aim", () => {
    expect(questionStatus({ aim: null, solved: null })).toBe("none");
    expect(questionStatus({ aim: 10, solved: null })).toBe("pending");
    expect(questionStatus({ aim: 10, solved: 10 })).toBe("hit");
    expect(questionStatus({ aim: 10, solved: 14 })).toBe("hit");
    expect(questionStatus({ aim: 10, solved: 7 })).toBe("short");
    expect(questionStatus({ aim: 10, solved: 0 })).toBe("short");
    expect(questionStatus({ aim: null, solved: 6 })).toBe("solved");
    // Sessions from before questions existed have neither field.
    expect(questionStatus({})).toBe("none");
  });

  it("labels: 8/10, ?/10, 6, or nothing", () => {
    expect(questionLabel({ aim: 10, solved: 8 })).toBe("8/10");
    expect(questionLabel({ aim: 10, solved: null })).toBe("?/10");
    expect(questionLabel({ aim: null, solved: 6 })).toBe("6");
    expect(questionLabel({ aim: null, solved: null })).toBeNull();
  });

  it("clamps to the limits, rounding and treating junk as 0", () => {
    expect(clampAim(250)).toBe(200);
    expect(clampAim(-3)).toBe(0);
    expect(clampAim(7.6)).toBe(8);
    expect(clampAim(Number.NaN)).toBe(0);
    expect(clampSolved(900)).toBe(500);
  });
});

describe("pace", () => {
  it("minutes per question, none when nothing was solved", () => {
    expect(pace(25, 10)).toBe(2.5);
    expect(pace(25, 0)).toBeNull();
    expect(pace(25, null)).toBeNull();
  });

  it("reads naturally", () => {
    expect(formatPace(2.5)).toBe("2.5 min a question");
    expect(formatPace(3.333)).toBe("3.3 min a question");
    expect(formatPace(12.4)).toBe("12 min a question");
    expect(formatPace(0.5)).toBe("30 sec a question");
    expect(formatPace(0.01)).toBe("5 sec a question");
  });
});

describe("a day of focus sessions", () => {
  const sessions = [
    s("a", "09:00", { aim: 10, solved: 10, minutes: 25 }),
    s("b", "10:00", { aim: 10, solved: 6, minutes: 25 }),
    s("c", "11:00", { aim: 15, solved: null }), // not answered yet
    s("d", "12:00", { aim: null, solved: 4, minutes: 20 }), // no aim, but said
    s("e", "13:00", { aim: null, solved: null }), // theory
    s("x", "09:00", { aim: 10, solved: 9 }),
  ];
  sessions[5].startedAt = new Date("2026-11-24T09:00:00").toISOString(); // another day

  it("adds up solved, compares answered aims, counts hits/shorts/pending, and the pace", () => {
    const d = focusDay(sessions, DAY);
    expect(d.solved).toBe(20);
    expect(d.aimSolved).toBe(16);
    expect(d.aim).toBe(20);
    expect(d.hit).toBe(1);
    expect(d.short).toBe(1);
    expect(d.pending).toBe(1);
    // 70 minutes over 20 questions, counting only sessions that solved any.
    expect(d.pace).toBeCloseTo(3.5, 5);
  });

  it("an empty day is all zeros, no pace", () => {
    expect(focusDay(sessions, "2026-11-20")).toEqual({ solved: 0, aimSolved: 0, aim: 0, hit: 0, short: 0, pending: 0, pace: null });
  });

  it("totals per day for the daily question count", () => {
    expect(focusQuestionsOn(sessions, DAY)).toBe(20);
    expect(focusQuestionsOn(sessions, "2026-11-24")).toBe(9);
    expect(Object.fromEntries(focusQuestionsByDay(sessions))).toEqual({ [DAY]: 20, "2026-11-24": 9 });
  });
});

describe("which session to ask about", () => {
  it("the latest timed session with an unanswered aim", () => {
    const list = [s("a", "09:00", { aim: 10 }), s("b", "10:00", { aim: 5 }), s("c", "11:00", { aim: 10, solved: 3 })];
    expect(sessionToAsk(list, at("12:00"))?.id).toBe("b");
  });

  it("not answered ones put off on this device, sessions added by hand, or without an aim", () => {
    const list = [s("a", "09:00", { aim: 10 }), s("b", "10:00", { aim: 5 }), s("m", "11:00", { aim: 5, source: "manual" }), s("n", "11:30", { aim: null })];
    expect(sessionToAsk(list, at("12:00"), new Set(["b"]))?.id).toBe("a");
    expect(sessionToAsk(list, at("12:00"), new Set(["a", "b"]))).toBeNull();
  });

  it("stops asking 12 hours after a session ended", () => {
    const list = [s("a", "09:00", { aim: 10, minutes: 25 })];
    expect(sessionToAsk(list, at("09:25") + 12 * 3_600_000 - 1000)?.id).toBe("a");
    expect(sessionToAsk(list, at("09:25") + 12 * 3_600_000 + 1000)).toBeNull();
  });
});

describe("after answering", () => {
  it("says whether the aim was hit, by how much it fell short, and the pace", () => {
    expect(resultLine({ aim: 10, minutes: 25 }, 10)).toBe("aim hit · 10 of 10 · 2.5 min a question");
    expect(resultLine({ aim: 10, minutes: 25 }, 12)).toBe("aim hit · 12 of 10 · 2.1 min a question");
    expect(resultLine({ aim: 10, minutes: 24 }, 8)).toBe("2 short · 8 of 10 · 3 min a question");
    expect(resultLine({ aim: 10, minutes: 25 }, 0)).toBe("10 short · 0 of 10");
    expect(resultLine({ aim: null, minutes: 30 }, 6)).toBe("6 solved · 5 min a question");
    expect(resultLine({ aim: null, minutes: 30 }, 0)).toBe("no questions solved");
  });

  it("several days at once (the admin's last 30) add up the same way", () => {
    const list = [s("a", "09:00", { aim: 10, solved: 10 }), s("b", "10:00", { aim: 10, solved: 4 })];
    expect(focusQuestionStats(list, [DAY])).toMatchObject({ solved: 14, hit: 1, short: 1, aim: 20 });
    expect(focusQuestionStats(list, ["2026-11-01"]).solved).toBe(0);
  });
});
