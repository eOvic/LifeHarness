// What to remind, and when (src/core/reminders.ts). Pure: no clock, no server.
import { describe, expect, it } from "vitest";
import { reminderSettings, remindersFor, REMINDER_DEFAULTS } from "@/src/core/reminders";
import { CATEGORY_KEYS, type DaySchedule, type ScheduledBlock, type Tracking } from "@/src/core/types";

const DATE = "2026-11-20";
const block = (b: Partial<ScheduledBlock> & { key: string; start: number; end: number }): ScheduledBlock => ({
  title: b.key,
  category: CATEGORY_KEYS[0],
  source: "block",
  core: false,
  tracked: true,
  ...b,
});
const day = (blocks: ScheduledBlock[], date = DATE): DaySchedule => ({ date, day: "fri", wake: 360, bed: 1380, blocks, warnings: [] }) as DaySchedule;
const at = (hm: string, date = DATE) => new Date(`${date}T${hm}:00Z`);
const run = (blocks: ScheduledBlock[], now: string, s = {}, tracking: Tracking = {}, tz = "UTC") =>
  remindersFor([day(blocks)], tracking, reminderSettings(s), tz, at(now));

describe("reminders", () => {
  it("a plan block: at its start, with its if-then plan", () => {
    const r = run([block({ key: "block:read", title: "Read", start: 540, end: 600, ifThen: "If coffee is ready, I open the book" })], "08:00", { evening: false });
    expect(r).toEqual([{ id: `block:${DATE}:block:read:0`, at: "2026-11-20T09:00:00.000Z", title: "Read", body: "09:00–10:00 · If coffee is ready, I open the book", path: "/today" }]);
  });

  it("minutes before, when asked", () => {
    const [r] = run([block({ key: "block:read", title: "Read", start: 540, end: 600 })], "08:00", { before: 10, evening: false });
    expect(r).toMatchObject({ at: "2026-11-20T08:50:00.000Z", title: "In 10 min: Read", body: "09:00–10:00" });
  });

  it("nothing for fixed commitments or sleep; prayers only when asked", () => {
    const blocks = [
      block({ key: "fixed:work", source: "fixed", start: 540, end: 1020 }),
      block({ key: "sleep:night", source: "sleep", start: 1380, end: 1800 }),
      block({ key: "prayer:dhuhr", source: "prayer", title: "Dhuhr", start: 700, end: 720 }),
    ];
    expect(run(blocks, "08:00", { evening: false })).toEqual([]);
    expect(run(blocks, "08:00", { evening: false, prayers: true }).map((r) => r.title)).toEqual(["Dhuhr"]);
  });

  it("nothing for a block already marked", () => {
    const tracking: Tracking = { [DATE]: { "block:read": { status: "done", at: "", title: "Read", core: false, category: CATEGORY_KEYS[0] } } };
    expect(run([block({ key: "block:read", start: 540, end: 600 })], "08:00", { evening: false }, tracking)).toEqual([]);
  });

  it("evening check-in: only while blocks before it are unmarked, and it counts them", () => {
    const blocks = [
      block({ key: "block:a", start: 540, end: 600 }),
      block({ key: "block:b", start: 700, end: 760 }),
      block({ key: "block:late", start: 1320, end: 1350 }), // after the 21:30 check-in: not counted
      block({ key: "prayer:asr", source: "prayer", start: 900, end: 920, overlay: true }), // inside another block: not counted
    ];
    const mark = (key: string): Tracking => ({ [DATE]: { [key]: { status: "done", at: "", title: key, core: false, category: CATEGORY_KEYS[0] } } });
    const evening = (t: Tracking) => run(blocks, "20:00", { blocks: false }, t).find((r) => r.id.startsWith("evening:"));
    expect(evening({})).toMatchObject({ at: "2026-11-20T21:30:00.000Z", title: "Mark today", body: "2 of 2 blocks aren't marked yet." });
    expect(evening(mark("block:a"))?.body).toBe("1 of 2 blocks isn't marked yet.");
    expect(evening({ [DATE]: { ...mark("block:a")[DATE], ...mark("block:b")[DATE] } })).toBeUndefined();
  });

  it("time window: just due (2 min) still shows; older ones are dropped", () => {
    const blocks = [block({ key: "block:early", start: 480, end: 540 }), block({ key: "block:now", start: 540, end: 600 })];
    expect(run(blocks, "09:01", { evening: false }).map((r) => r.id)).toEqual([`block:${DATE}:block:now:0`]);
  });

  it("times are the profile's wall clock (Cairo is UTC+2 in November)", () => {
    const [r] = run([block({ key: "block:read", start: 540, end: 600 })], "06:00", { evening: false }, {}, "Africa/Cairo");
    expect(r.at).toBe("2026-11-20T07:00:00.000Z");
  });

  it("saved settings fill in the defaults", () => {
    expect(reminderSettings({ before: 5 })).toEqual({ ...REMINDER_DEFAULTS, before: 5 });
    expect(REMINDER_DEFAULTS).toMatchObject({ blocks: true, evening: true, prayers: false, eveningAt: "21:30" });
  });
});
