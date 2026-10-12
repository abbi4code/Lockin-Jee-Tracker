import { describe, expect, it } from "vitest";
import { lastDay, scrollMode } from "./announcements";

describe("rules scroll", () => {
  it("opens the first time anywhere", () => expect(scrollMode(undefined, "2026-10-12", false, 10)).toBe("first"));
  it("opens once on a new device within the 10 days", () => expect(scrollMode("2026-10-12", "2026-10-15", false, 10)).toBe("reopen"));
  it("stays rolled up once seen on this device", () => expect(scrollMode("2026-10-12", "2026-10-21", true, 10)).toBe("rolled"));
  it("is gone from day 11", () => expect(scrollMode("2026-10-12", "2026-10-22", true, 10)).toBe("gone"));
  it("last day is day 10", () => expect(lastDay("2026-10-12", 10)).toBe("2026-10-21"));
});
