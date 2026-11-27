// Daily tasks and deadlines: pure rules (no clock, no server), tested in tests/tasks.test.ts.
//   Tasks: untimed things to tick each day ("Pray Duha"), on every day or only some weekdays. A tick
//   is a tracking mark under "task:<id>". They never enter the schedule or the block score.
//   Deadlines: a date (and maybe a time); counted down on Today, reminded 7 days before, the day before
//   and on the day, and put in the calendars as all-day events.
import { addDays, dayOf, isHM } from "./time";
import { TASK_PREFIX, type Day, type Deadline, type Task, type Tracking } from "./types";

export const taskKey = (id: string) => `${TASK_PREFIX}${id}`;
export const isTaskKey = (key: string) => key.startsWith(TASK_PREFIX);

/** Does this task apply on `date`? (Its weekdays, and not before the day it was added.) */
export function taskApplies(t: Task, date: string): boolean {
  if (t.since && date < t.since) return false;
  return !t.days?.length || t.days.includes(dayOf(date) as Day);
}

export const tasksFor = (tasks: Task[] = [], date: string) => tasks.filter((t) => taskApplies(t, date));

export interface TaskStat {
  id: string;
  title: string;
  done: number;
  /** Days it applied on, up to today. */
  due: number;
}

/** How each task went over `dates` (days after `today` don't count). */
export function taskStats(tasks: Task[] = [], tracking: Tracking, dates: string[], today: string): TaskStat[] {
  return tasks.map((t) => {
    const days = dates.filter((d) => d <= today && taskApplies(t, d));
    return { id: t.id, title: t.title, due: days.length, done: days.filter((d) => tracking[d]?.[taskKey(t.id)]?.status === "done").length };
  });
}

/** Whole days from `today` to the deadline (negative: overdue). */
export function daysLeft(d: Deadline, today: string): number {
  return Math.round((Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function countdown(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Open deadlines from `overdueDays` ago up to `horizonDays` ahead, soonest first. */
export function upcomingDeadlines(deadlines: Deadline[] = [], today: string, horizonDays = 60, overdueDays = 14): (Deadline & { left: number })[] {
  return deadlines
    .filter((d) => !d.done && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .map((d) => ({ ...d, left: daysLeft(d, today) }))
    .filter((d) => d.left >= -overdueDays && d.left <= horizonDays)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

/** When to remind of a deadline: days before it, at 09:00 local. */
export const DEADLINE_LEADS = [7, 1, 0];
export const DEADLINE_REMIND_AT = "09:00";

export interface DeadlineAlert {
  id: string;
  date: string;
  title: string;
  body: string;
}

export function deadlineAlerts(deadlines: Deadline[] = []): DeadlineAlert[] {
  const out: DeadlineAlert[] = [];
  for (const d of deadlines) {
    if (d.done || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    const due = d.time && isHM(d.time) ? `${d.date} at ${d.time}` : d.date;
    for (const lead of DEADLINE_LEADS) {
      out.push({
        id: `deadline:${d.id}:${d.date}:${lead}`,
        date: addDays(d.date, -lead),
        title: lead === 0 ? `Due today: ${d.title}` : lead === 1 ? `Due tomorrow: ${d.title}` : `Due in ${lead} days: ${d.title}`,
        body: [`Deadline ${due}`, d.note].filter(Boolean).join(" · "),
      });
    }
  }
  return out;
}
