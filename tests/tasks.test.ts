// Daily tasks and deadlines: the rules (src/core/tasks.ts) and every place they reach: the life map,
// the weekly report, reminders, the Google calendar and the .ics export.
import { describe, expect, it } from "vitest";
import { calendarEvents, DEADLINE_EVENT_REMINDERS } from "@/src/core/calendar-events";
import { toIcs } from "@/src/core/ics";
import { mergeProfile } from "@/src/core/profile";
import { reminderSettings, remindersFor } from "@/src/core/reminders";
import { weekReport } from "@/src/core/report";
import { countdown, daysLeft, deadlineAlerts, taskApplies, taskKey, taskStats, upcomingDeadlines } from "@/src/core/tasks";
import type { DaySchedule, Deadline, ScheduledBlock, Task, Tracking } from "@/src/core/types";

const TZ = "Europe/Istanbul"; // UTC+3, no daylight saving
const block = (key: string, start: number, end: number): ScheduledBlock =>
  ({ key, title: key, category: "deep", source: "block", core: false, tracked: true, start, end }) as ScheduledBlock;
const day = (date: string, blocks: ScheduledBlock[] = []) => ({ date, day: "fri", wake: 360, bed: 1380, blocks, warnings: [], planVersion: 1 }) as unknown as DaySchedule;
const duha: Task = { id: "duha", title: "Pray Duha" };

describe("daily tasks", () => {
  it("apply every day, or only on their weekdays, and never before the day they were added", () => {
    expect(taskApplies(duha, "2026-11-27")).toBe(true);
    const fridays: Task = { id: "kahf", title: "Read al-Kahf", days: ["fri"] };
    expect(taskApplies(fridays, "2026-11-27")).toBe(true); // a Friday
    expect(taskApplies(fridays, "2026-11-28")).toBe(false);
    expect(taskApplies({ ...duha, since: "2026-11-27" }, "2026-11-26")).toBe(false);
  });

  it("the life map adds them with the day they started, updates them by id, and removes them", () => {
    const { profile, changes } = mergeProfile({}, { tasks: [{ id: "duha", title: "Pray Duha", days: ["fri", "xyz" as never] }] });
    expect(profile.tasks).toEqual([{ id: "duha", title: "Pray Duha", days: ["fri"], since: new Date().toISOString().slice(0, 10) }]);
    expect(changes[0]).toContain('task +duha "Pray Duha"');
    const renamed = mergeProfile(profile, { tasks: [{ id: "duha", title: "Duha prayer" }] }).profile;
    expect(renamed.tasks?.[0]).toMatchObject({ title: "Duha prayer", since: profile.tasks![0].since }); // its start day stays
    expect(mergeProfile(renamed, { remove: { tasks: ["duha"] } }).profile.tasks).toEqual([]);
  });

  it("are counted on their own in the weekly report, never as plan blocks", () => {
    const days = [day("2026-11-26", [block("block:read", 600, 660)]), day("2026-11-27", [block("block:read", 600, 660)])];
    const tracking: Tracking = {
      "2026-11-26": { "block:read": { status: "done", at: "", title: "block:read", core: false, category: "deep" }, [taskKey("duha")]: { status: "done", at: "", title: "Pray Duha", core: false, category: "routine" } },
      "2026-11-27": { "block:read": { status: "skip", at: "", title: "block:read", core: false, category: "deep" } },
    };
    const r = weekReport(days, tracking, "2026-11-27", 1000, [duha]);
    expect(r.blocks.map((b) => b.title)).toEqual(["block:read"]); // the tick isn't an extra "block"
    expect(r.score).toBe(50);
    expect(r.tasks).toEqual([{ id: "duha", title: "Pray Duha", done: 1, due: 2 }]);
    expect(taskStats([duha], tracking, ["2026-11-27", "2026-11-28"], "2026-11-27")).toEqual([{ id: "duha", title: "Pray Duha", done: 0, due: 1 }]); // tomorrow isn't due yet
  });

  it("the evening check-in names the tasks still to tick, even when every block is marked", () => {
    const d = day("2026-11-27", []);
    const at = new Date("2026-11-27T18:00:00Z"); // 21:00 there
    const [r] = remindersFor([d], {}, reminderSettings({ eveningAt: "21:30" }), TZ, at, 36 * 3_600_000, { tasks: [duha] });
    expect(r).toMatchObject({ id: "evening:2026-11-27", title: "Mark today", body: "Still to tick: Pray Duha." });
    const ticked: Tracking = { "2026-11-27": { [taskKey("duha")]: { status: "done", at: "", title: "Pray Duha", core: false, category: "routine" } } };
    expect(remindersFor([d], ticked, reminderSettings(), TZ, at, 36 * 3_600_000, { tasks: [duha] })).toEqual([]);
  });
});

describe("deadlines", () => {
  const hw: Deadline = { id: "dsp-hw4", title: "DSP HW4", date: "2026-12-04", time: "23:59" };

  it("count down in whole days", () => {
    expect([daysLeft(hw, "2026-11-27"), daysLeft(hw, "2026-12-04"), daysLeft(hw, "2026-12-06")]).toEqual([7, 0, -2]);
    expect([countdown(0), countdown(1), countdown(7), countdown(-2)]).toEqual(["today", "tomorrow", "in 7 days", "2 days ago"]);
    const list = upcomingDeadlines([hw, { id: "old", title: "Old", date: "2026-10-01" }, { id: "done", title: "Done", date: "2026-12-01", done: true }, { id: "exam", title: "Exam", date: "2026-11-30" }], "2026-11-27");
    expect(list.map((d) => [d.id, d.left])).toEqual([["exam", 3], ["dsp-hw4", 7]]); // soonest first; done and long-past left out
  });

  it("need a title and a real date to be added", () => {
    expect(() => mergeProfile({}, { deadlines: [{ id: "x", title: "X", date: "next friday" }] })).toThrow(/YYYY-MM-DD/);
    const { profile } = mergeProfile({}, { deadlines: [{ ...hw, time: "late" }] });
    expect(profile.deadlines).toEqual([{ id: "dsp-hw4", title: "DSP HW4", date: "2026-12-04" }]); // a bad time is dropped
    expect(mergeProfile(profile, { deadlines: [{ id: "dsp-hw4", done: true } as Deadline] }).profile.deadlines?.[0].done).toBe(true); // marking done needs only the id
  });

  it("remind 7 days before, the day before and on the day, at 09:00 local; never once done", () => {
    expect(deadlineAlerts([hw]).map((a) => [a.date, a.title])).toEqual([
      ["2026-11-27", "Due in 7 days: DSP HW4"],
      ["2026-12-03", "Due tomorrow: DSP HW4"],
      ["2026-12-04", "Due today: DSP HW4"],
    ]);
    const [r] = remindersFor([], {}, reminderSettings({ evening: false }), TZ, new Date("2026-11-27T05:00:00Z"), 36 * 3_600_000, { deadlines: [hw] });
    expect(r).toMatchObject({ id: "deadline:dsp-hw4:2026-12-04:7", at: "2026-11-27T06:00:00.000Z", body: "Deadline 2026-12-04 at 23:59" });
    expect(deadlineAlerts([{ ...hw, done: true }])).toEqual([]);
  });

  it("go to the Google calendar as all-day events with reminders a week and a day before, at 09:00", () => {
    const o = { tz: TZ, from: "2026-11-27", to: "2026-12-11", reminders: reminderSettings(), deadlines: [hw, { id: "far", title: "Far", date: "2027-01-01" }] };
    const [e] = calendarEvents([], o);
    expect(e).toEqual({
      key: "deadline:dsp-hw4",
      summary: "Due: DSP HW4 (23:59)",
      description: "A deadline from LifeHarness.",
      start: { date: "2026-12-04" },
      end: { date: "2026-12-05" },
      reminderMin: null,
      reminderMins: [7 * 1440 - 540, 1440 - 540],
    });
    expect(calendarEvents([], o)).toHaveLength(1); // only the deadlines inside the window
  });

  it("are in the .ics export as all-day events with two alerts", () => {
    const ics = toIcs([day("2026-11-27")], TZ, "LifeHarness", [hw]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261204");
    expect(ics).toContain("DTEND;VALUE=DATE:20261205");
    expect(ics).toContain("SUMMARY:Due: DSP HW4 (23:59)");
    for (const m of DEADLINE_EVENT_REMINDERS) expect(ics).toContain(`TRIGGER:-PT${m}M`);
  });
});
