import { describe, expect, it } from "vitest";
import { toIcs } from "@/src/core/ics";
import { prayerTimes } from "@/src/core/prayer";
import { coverage, mergeProfile } from "@/src/core/profile";
import { weekReport } from "@/src/core/report";
import { buildWeek } from "@/src/core/scheduler";
import { addDays, dayOf, fmt, toMin, weekStartOf, zonedToUtc } from "@/src/core/time";
import type { BlockSpec, DaySchedule, Profile, ProfileSnapshot } from "@/src/core/types";

const blocksOf = (d: DaySchedule) => d.blocks.filter((b) => b.source !== "sleep" && !b.overlay);
function noOverlaps(days: DaySchedule[]) {
  for (const d of days) {
    const bl = blocksOf(d);
    for (let i = 1; i < bl.length; i++) expect(bl[i].start, `${d.date} ${bl[i - 1].title}/${bl[i].title}`).toBeGreaterThanOrEqual(bl[i - 1].end);
  }
}

describe("time", () => {
  it("does calendar maths in UTC", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayOf("2026-11-18")).toBe("wed");
    expect(weekStartOf("2026-11-18", "sun")).toBe("2026-11-15");
    expect(weekStartOf("2026-11-18", "mon")).toBe("2026-11-16");
    expect(fmt(1440)).toBe("24:00");
    expect(fmt(toMin("07:05"))).toBe("07:05");
  });
  it("converts wall-clock time to UTC across DST", () => {
    expect(zonedToUtc("2026-11-18", 8 * 60, "Europe/Istanbul").toISOString()).toBe("2026-11-18T05:00:00.000Z");
    expect(zonedToUtc("2026-07-01", 9 * 60, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", 9 * 60, "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
});

describe("prayer times", () => {
  // Reference: api.aladhan.com, method 5 (Egyptian General Authority of Survey), Cairo, 18 Nov 2026:
  // 04:52 06:22 11:40 14:38 16:58 18:18. adhan-js rounds and pads Dhuhr slightly differently: within a minute.
  it("agrees with an independent timetable (AlAdhan, Egyptian method, Cairo) to within a minute", () => {
    const t = prayerTimes("2026-11-18", 30.0444, 31.2357, "Africa/Cairo", { method: "Egyptian" });
    const reference = ["04:52", "06:22", "11:40", "14:38", "16:58", "18:18"].map(toMin);
    [t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha].forEach((v, i) => expect(Math.abs(v - reference[i]), `prayer #${i}`).toBeLessThanOrEqual(1));
  });
  it("applies per-prayer minute adjustments (to match a local mosque or app)", () => {
    const base = prayerTimes("2026-11-18", 30.0444, 31.2357, "Africa/Cairo", { method: "Egyptian" });
    const adj = prayerTimes("2026-11-18", 30.0444, 31.2357, "Africa/Cairo", { method: "Egyptian", adjustments: { fajr: 2, isha: -3 } });
    expect([adj.fajr - base.fajr, adj.dhuhr - base.dhuhr, adj.isha - base.isha]).toEqual([2, 0, -3]);
  });
});

const student: ProfileSnapshot = {
  timezone: "Europe/Berlin",
  weekStart: "mon",
  sleep: { bed: "23:00", wake: "07:00" },
  energy: { peak: { start: "08:00", end: "12:00" } },
  fixed: [{ id: "lectures", title: "Lecture", days: ["mon", "thu"], start: "08:45", end: "10:15", category: "class" }],
};
const studentBlocks: BlockSpec[] = [
  { id: "deep", title: "Deep work: thesis", category: "deep", durationMin: 90, timesPerWeek: 5, window: "peak", core: true, energy: "high", goalId: "thesis" },
  { id: "gym", title: "Workout", category: "health", durationMin: 60, timesPerWeek: 3, window: "afternoon" },
  { id: "plan", title: "Plan tomorrow", category: "admin", durationMin: 10, before: { ref: "bed", gapMin: 30 } },
];

describe("scheduler", () => {
  it("places blocks around sleep and fixed commitments without overlaps", () => {
    const w = buildWeek({ snapshot: student, plan: { version: 1, blocks: studentBlocks } }, "2026-11-16");
    noOverlaps(w.days);
    expect(w.unplaced).toEqual([]);
    const mon = w.days[0];
    expect(mon.day).toBe("mon");
    const deep = mon.blocks.find((b) => b.key === "block:deep")!;
    expect(fmt(deep.start)).toBe("10:15"); // peak 08-12, lecture 08:45-10:15 -> first 90-min gap
    const plan = mon.blocks.find((b) => b.key === "block:plan")!;
    expect([fmt(plan.start), fmt(plan.end)]).toEqual(["22:20", "22:30"]); // as late as possible, 30 min before bed
    expect(w.days.filter((d) => d.blocks.some((b) => b.key === "block:gym")).length).toBe(3);
    expect(w.stats.freePct).toBeGreaterThan(0);
  });

  it("reports what does not fit, with a reason", () => {
    const tooBig: BlockSpec[] = [{ id: "huge", title: "Huge", category: "deep", durationMin: 300, timesPerWeek: 2, window: "peak" }];
    const w = buildWeek({ snapshot: student, plan: { version: 1, blocks: tooBig } }, "2026-11-16");
    expect(w.unplaced[0].blockId).toBe("huge");
    expect(w.unplaced[0].placed).toBe(0);
    expect(w.unplaced[0].reasons[0]).toMatch(/shorter than 300 min/);
  });

  it("handles a bedtime after midnight", () => {
    const owl: ProfileSnapshot = { ...student, sleep: { bed: "00:30", wake: "08:30" }, fixed: [] };
    const w = buildWeek({ snapshot: owl, plan: null }, "2026-11-16");
    const tue = w.days[1];
    const sleep = tue.blocks.filter((b) => b.source === "sleep");
    expect(sleep.map((b) => [fmt(b.start), fmt(b.end)])).toEqual([["00:30", "08:30"]]);
    expect(tue.bed).toBe(1440 + 30);
  });

  it("anchors a day to prayers: chains after Fajr, a fill from Maghrib to Isha, sleep relative to Isha, Asr after a long commitment, Jumu'ah", () => {
    // A fictional persona (Cairo; prayer times cross-checked against AlAdhan above).
    const persona: ProfileSnapshot = {
      timezone: "Africa/Cairo",
      weekStart: "sat",
      location: { city: "Cairo", lat: 30.0444, lon: 31.2357 },
      faith: { enabled: true, prayers: { method: "Egyptian", durations: { fajr: 20, dhuhr: 20, asr: 20, maghrib: 20, isha: 20 } } },
      sleep: { bed: { anchor: "isha", offsetMin: 180 }, hours: 7 },
      fixed: [
        { id: "shift", title: "Pharmacy shift", days: ["sun", "tue"], start: "08:00", end: "11:00", category: "work" },
        { id: "course", title: "Evening course", days: ["mon", "wed"], start: "13:00", end: "16:00", category: "class" },
      ],
    };
    const blocks: BlockSpec[] = [
      { id: "recite", title: "Morning recitation", category: "faith", durationMin: 30, after: { ref: "fajr" }, core: true },
      { id: "journal", title: "Journal", category: "personal", durationMin: 15, after: { ref: "block:recite" }, core: true },
      { id: "family", title: "Family time", category: "relationships", durationMin: 30, after: { ref: "maghrib" }, before: { ref: "isha" }, fill: true, core: true },
      { id: "reading", title: "Evening reading", category: "learn", durationMin: 45, after: { ref: "isha" }, core: true },
      { id: "notes", title: "Shift notes", category: "work", durationMin: 30, days: ["sun", "tue"], after: { ref: "fixed:shift" }, core: true },
    ];
    const w = buildWeek({ snapshot: persona, plan: { version: 1, blocks } }, "2026-11-14");
    noOverlaps(w.days);
    expect(w.unplaced).toEqual([]);
    const day = (date: string) => w.days.find((d) => d.date === date)!;
    const at = (date: string, k: string) => {
      const b = day(date).blocks.find((x) => x.key === k)!;
      return `${fmt(b.start)}-${fmt(b.end)}`;
    };
    const wed = "2026-11-18";
    expect(at(wed, "prayer:fajr")).toBe("04:47-05:07"); // adhan 04:52, 5-min lead, 20 min
    expect(at(wed, "block:recite")).toBe("05:07-05:37");
    expect(at(wed, "block:journal")).toBe("05:37-05:52"); // chained after the recitation
    expect(at(wed, "prayer:asr")).toBe("16:00-16:20"); // adhan 14:37 falls inside the 3-h course: right after it
    expect(at(wed, "prayer:maghrib")).toBe("16:53-17:13");
    expect(at(wed, "block:family")).toBe("17:13-18:13"); // fills Maghrib -> Isha
    expect(at(wed, "prayer:isha")).toBe("18:13-18:33");
    expect(at(wed, "block:reading")).toBe("18:33-19:18");
    expect(fmt(day(wed).bed)).toBe("21:18"); // Isha adhan + 3 h
    expect(fmt(day("2026-11-19").wake)).toBe("04:18"); // 7 h later
    expect(at("2026-11-17", "block:notes")).toBe("11:00-11:30"); // after the shift
    expect(day("2026-11-20").blocks.some((b) => b.title === "Jumu'ah")).toBe(true);
  });
});

describe("prayers inside commitments", () => {
  it("keeps Dhuhr/Asr as prayer breaks inside a 9-5 job (their windows close before you're home)", () => {
    const worker: ProfileSnapshot = {
      timezone: "Asia/Amman",
      weekStart: "sun",
      location: { city: "Amman", lat: 31.9516, lon: 35.924 },
      faith: { enabled: true, prayers: { method: "MuslimWorldLeague" } },
      sleep: { bed: "23:30", wake: { anchor: "fajr", offsetMin: 0 } },
      fixed: [{ id: "work", title: "Work", days: ["sun", "mon", "tue", "wed", "thu"], start: "09:00", end: "17:00", travelMin: 30, category: "work" }],
    };
    const w = buildWeek({ snapshot: worker, plan: { version: 1, blocks: [{ id: "q", title: "Quran", category: "faith", durationMin: 20, after: { ref: "fajr" } }] } }, "2026-11-15");
    noOverlaps(w.days);
    const sun = w.days[0];
    const dhuhr = sun.blocks.find((b) => b.key === "prayer:dhuhr")!;
    const asr = sun.blocks.find((b) => b.key === "prayer:asr")!;
    expect(dhuhr.overlay && asr.overlay).toBe(true);
    expect(dhuhr.start).toBeLessThan(sun.prayers!.asr!); // still inside its window
    expect(dhuhr.note).toMatch(/prayer break during Work/);
    expect(sun.warnings).toEqual([]);
    // Wake is anchored to Fajr: the Fajr block starts at wake instead of splitting sleep.
    expect(sun.blocks.find((b) => b.key === "prayer:fajr")!.start).toBe(sun.wake);
    expect(w.warnings).toEqual([]);
    // Friday: no work, Jumu'ah instead of Dhuhr.
    expect(w.days.find((d) => d.day === "fri")!.blocks.some((b) => b.title === "Jumu'ah" && !b.overlay)).toBe(true);
  });
});

describe("profile", () => {
  it("merges partial updates and supports removal", () => {
    let p: Profile = {};
    p = mergeProfile(p, { goals: [{ id: "run", horizon: "year", title: "Run a half marathon" }], obstacles: ["phone in bed"] }).profile;
    p = mergeProfile(p, { goals: [{ id: "run", horizon: "year", title: "Run a half marathon", measure: "finish under 2h", confidence: 140 }], obstacles: ["Phone in bed", "late meetings"] }).profile;
    expect(p.goals).toHaveLength(1);
    expect(p.goals![0].measure).toBe("finish under 2h");
    expect(p.goals![0].confidence).toBe(100);
    expect(p.obstacles).toEqual(["phone in bed", "late meetings"]);
    p = mergeProfile(p, { remove: { obstacles: ["late meetings"], goals: ["run"] } }).profile;
    expect(p.obstacles).toEqual(["phone in bed"]);
    expect(p.goals).toEqual([]);
  });
  it("flags the strands the scheduler cannot work without", () => {
    const crit = coverage({}).filter((s) => s.critical && !s.done).map((s) => s.id);
    expect(crit).toEqual(["goals", "sleep", "fixed", "faith", "weekStart"]);
    const full: Profile = {
      goals: [{ id: "g", horizon: "year", title: "x", measure: "y" }],
      sleep: { bed: "23:00", wake: "07:00" },
      fixedConfirmed: true,
      faith: { enabled: false },
      weekStart: "mon",
    };
    expect(coverage(full).filter((s) => s.critical && !s.done)).toEqual([]);
  });
});

describe("report", () => {
  it("scores marked blocks and finds the weakest", () => {
    const w = buildWeek({ snapshot: student, plan: { version: 1, blocks: studentBlocks } }, "2026-11-16");
    const mon = w.days[0];
    const deepKey = "block:deep";
    const r = weekReport(w.days, {
      [mon.date]: {
        [deepKey]: { status: "skip", at: "", title: "Deep work: thesis", core: true, category: "deep" },
        "fixed:lectures": { status: "done", at: "", title: "Lecture", core: true, category: "class" },
      },
    }, "2026-11-16", 23 * 60);
    expect(r.days[0].score).toBe(50);
    expect(r.weakest?.title).toBe("Deep work: thesis");
    expect(r.unmarked).toBeGreaterThan(0); // Plan tomorrow etc. started but unmarked
  });
});

describe("ics", () => {
  it("writes valid folded events in UTC and merges overnight sleep", () => {
    const w = buildWeek({ snapshot: student, plan: { version: 1, blocks: studentBlocks } }, "2026-11-16");
    const ics = toIcs(w.days, "Europe/Berlin");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    // Monday 23:00 Berlin (UTC+1) -> Tuesday 07:00
    expect(ics).toContain("DTSTART:20261116T220000Z\r\nDTEND:20261117T060000Z\r\nSUMMARY:Sleep");
  });
});
