// Turn the profile + versioned plans into concrete days.
// Each adopted plan version carries a snapshot of the profile and applies from its adoption date on,
// so adopting a new plan never rewrites past days (or their tracking).
import { snapshotOf } from "../core/profile";
import { weekReport, type WeekReport } from "../core/report";
import { buildWeek } from "../core/scheduler";
import { addDays, nowIn, weekStartOf } from "../core/time";
import type { DaySchedule, Plan, Profile, WeekSchedule } from "../core/types";
import { getPlans, getProfile, getTracking } from "./store";

export function clock(profile: Profile = getProfile()) {
  const tz = profile.timezone || "UTC";
  const now = nowIn(tz);
  return { tz, today: now.date, nowMin: now.min, weekStart: profile.weekStart ?? "mon" };
}

function adoptedOn(plan: Plan, tz: string): string {
  return nowIn(tz, new Date(plan.adoptedAt!)).date;
}

/** The plan version in force on a date (latest adopted on or before it), or null. */
export function planFor(date: string, plans: Plan[], tz: string): Plan | null {
  let found: Plan | null = null;
  for (const p of plans) {
    if (p.adoptedAt && adoptedOn(p, tz) <= date) found = p;
  }
  return found;
}

export function scheduleWeek(start?: string, profile: Profile = getProfile()): WeekSchedule & { today: string; nowMin: number; tz: string } {
  const { tz, today, nowMin, weekStart } = clock(profile);
  const from = start ?? weekStartOf(today, weekStart);
  const plans = getPlans().filter((p) => p.adoptedAt);
  const live = snapshotOf(profile);
  const builds = new Map<number, WeekSchedule>();
  const build = (plan: Plan | null) => {
    const k = plan?.version ?? 0;
    if (!builds.has(k)) builds.set(k, buildWeek({ snapshot: plan?.snapshot ?? live, plan }, from));
    return builds.get(k)!;
  };
  const days: DaySchedule[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    // Past and present days use the version in force then; future days use the latest adopted plan.
    const plan = date <= today ? planFor(date, plans, tz) : (plans[plans.length - 1] ?? null);
    days.push(build(plan).days[i]);
  }
  const main = build(plans[plans.length - 1] ?? null);
  return { ...main, start: from, days, today, nowMin, tz };
}

export function weekReportFor(start?: string): WeekReport & { schedule: ReturnType<typeof scheduleWeek> } {
  const schedule = scheduleWeek(start);
  return { ...weekReport(schedule.days, getTracking(), schedule.today, schedule.nowMin), schedule };
}

/** N consecutive weeks of days (for the .ics export). */
export function scheduleDays(weeks: number): { days: DaySchedule[]; tz: string } {
  const profile = getProfile();
  const { tz, today, weekStart } = clock(profile);
  const first = weekStartOf(today, weekStart);
  const days: DaySchedule[] = [];
  for (let w = 0; w < weeks; w++) days.push(...scheduleWeek(addDays(first, 7 * w), profile).days);
  return { days, tz };
}
