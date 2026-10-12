import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SESSION_MIN } from "../lib/sessions";
import { today, useProgress } from "./progress";

const CHAPTER = "phy-motion-1d";
const s = () => useProgress.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T18:00:00"));
  s().reset();
  useProgress.setState({ dirty: [], activity: [] });
});
afterEach(() => vi.useRealTimers());

describe("adding time by hand", () => {
  it("logs a manual session, counts the day for the streak and queues both for sync", () => {
    const added = s().addSession({ chapterId: CHAPTER, startedAt: new Date("2026-10-10T16:00:00").toISOString(), minutes: 90 });
    expect(added).toMatchObject({ source: "manual", subject: "physics", minutes: 90, mode: "stopwatch" });
    expect(s().sessions).toHaveLength(1);
    expect(s().activity).toEqual(["2026-10-10"]);
    expect(s().dirty).toEqual(expect.arrayContaining([`session:${added.id}`, "state"]));
  });

  it("keeps sessions sorted by start and the activity list sorted", () => {
    s().addSession({ chapterId: null, startedAt: new Date("2026-10-12T09:00:00").toISOString(), minutes: 30 });
    s().addSession({ chapterId: null, startedAt: new Date("2026-10-08T09:00:00").toISOString(), minutes: 30 });
    expect(s().sessions.map((x) => x.startedAt.slice(0, 10))).toEqual(["2026-10-08", "2026-10-12"].map((d) => new Date(`${d}T09:00:00`).toISOString().slice(0, 10)));
    expect(s().activity).toEqual(["2026-10-08", "2026-10-12"]);
  });

  it("clamps the length to 1 minute … 12 hours", () => {
    expect(s().addSession({ chapterId: null, startedAt: new Date().toISOString(), minutes: 5000 }).minutes).toBe(MAX_SESSION_MIN);
    expect(s().addSession({ chapterId: null, startedAt: new Date().toISOString(), minutes: 0 }).minutes).toBe(1);
  });
});

describe("fixing a timer session", () => {
  it("marks a timer session as edited and bumps updatedAt", () => {
    s().timerStart({ mode: "stopwatch", chapterId: null });
    vi.advanceTimersByTime(40 * 60_000);
    const logged = s().timerStop()!;
    useProgress.setState({ dirty: [] });
    vi.advanceTimersByTime(1000);
    s().editSession(logged.id, { minutes: 25, chapterId: CHAPTER });
    const edited = s().sessions[0];
    expect(edited).toMatchObject({ minutes: 25, chapterId: CHAPTER, subject: "physics", edited: true, source: "timer" });
    expect(edited.updatedAt).toBeGreaterThan(logged.updatedAt!);
    expect(s().dirty).toEqual([`session:${logged.id}`]);
  });

  it("a manual session stays 'manual', not 'edited'", () => {
    const added = s().addSession({ chapterId: null, startedAt: new Date().toISOString(), minutes: 30 });
    s().editSession(added.id, { minutes: 45 });
    expect(s().sessions[0]).toMatchObject({ source: "manual", minutes: 45 });
    expect(s().sessions[0].edited).toBeFalsy();
  });

  it("deleting keeps a tombstone until it syncs", () => {
    const added = s().addSession({ chapterId: null, startedAt: new Date().toISOString(), minutes: 30 });
    s().deleteSession(added.id);
    expect(s().sessions).toEqual([]);
    expect(s().removedSessions[added.id]).toMatchObject({ id: added.id, minutes: 30 });
    expect(s().dirty).toContain(`session:${added.id}`);
  });
});

describe("timer limits", () => {
  it("a forgotten stopwatch is capped at 12 hours", () => {
    s().timerStart({ mode: "stopwatch" });
    vi.advanceTimersByTime(20 * 3600_000);
    expect(s().timerStop()!.minutes).toBe(MAX_SESSION_MIN);
  });

  it("a pomodoro never logs more than its length", () => {
    s().timerStart({ mode: "pomodoro", target: 25 });
    vi.advanceTimersByTime(3 * 3600_000);
    expect(s().timerStop()!.minutes).toBe(25);
  });

  it("under a minute isn't logged", () => {
    s().timerStart({ mode: "stopwatch" });
    vi.advanceTimersByTime(20_000);
    expect(s().timerStop()).toBeNull();
  });
});

describe("markClean", () => {
  it("clears a synced session, but keeps it dirty if it changed again during the upload", () => {
    const a = s().addSession({ chapterId: null, startedAt: new Date().toISOString(), minutes: 30 });
    const b = s().addSession({ chapterId: null, startedAt: new Date(Date.now() - 3600_000).toISOString(), minutes: 30 });
    const syncedAt = { [`session:${a.id}`]: a.updatedAt!, [`session:${b.id}`]: b.updatedAt! };
    vi.advanceTimersByTime(1000);
    s().editSession(b.id, { minutes: 40 }); // edited while the upload was in flight
    s().markClean([`session:${a.id}`, `session:${b.id}`], syncedAt);
    expect(s().dirty).not.toContain(`session:${a.id}`);
    expect(s().dirty).toContain(`session:${b.id}`);
  });

  it("clears a synced deletion", () => {
    const a = s().addSession({ chapterId: null, startedAt: new Date().toISOString(), minutes: 30 });
    vi.advanceTimersByTime(1000);
    s().deleteSession(a.id);
    const at = s().removedSessions[a.id].updatedAt;
    s().markClean([`session:${a.id}`], { [`session:${a.id}`]: at });
    expect(s().dirty).not.toContain(`session:${a.id}`);
  });
});

it("today() is the local date", () => {
  expect(today()).toBe("2026-10-12");
});
