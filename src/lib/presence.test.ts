import { describe, expect, it } from "vitest";
import { lastSeenLabel } from "./presence";

describe("lastSeenLabel", () => {
  const now = new Date("2026-10-12T18:00:00").getTime();
  it("just now within a minute", () => expect(lastSeenLabel(now - 30_000, now)).toBe("last seen just now"));
  it("today with the time", () => expect(lastSeenLabel(new Date("2026-10-12T16:12:00").getTime(), now)).toMatch(/^last seen today 4:12\s?pm$/));
  it("yesterday with the time", () => expect(lastSeenLabel(new Date("2026-10-11T21:10:00").getTime(), now)).toMatch(/^last seen yesterday 9:10\s?pm$/));
  it("older: just the date", () => expect(lastSeenLabel(new Date("2026-10-05T09:00:00").getTime(), now)).toBe("last seen 5 oct"));
});
