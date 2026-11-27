// Reminders: what to notify you of, and when. Pure (no clock, no server), so it's tested directly.
//   - a plan block: when it starts, or `before` minutes earlier, with its if-then plan;
//   - prayers, if you want them;
//   - an evening check-in, only while some of the day's tracked blocks or daily tasks are still open;
//   - deadlines: 7 days before, the day before and on the day, at 09:00 (src/core/tasks.ts).
// Fixed commitments (work, classes) and sleep get none, and nothing is sent for a block already marked.
// The server lists them (app/api/reminders); the desktop shell shows them (electron/main.cjs).
import { DEADLINE_REMIND_AT, deadlineAlerts, taskKey, tasksFor } from "./tasks";
import { fmt, toMin, zonedToUtc } from "./time";
import type { DaySchedule, Deadline, Task, Tracking } from "./types";

export interface ReminderSettings {
  /** When a plan block starts. */
  blocks: boolean;
  /** Minutes before the start (0: at the start). */
  before: number;
  /** Prayer times too (if prayer times are on). */
  prayers: boolean;
  /** The evening check-in. */
  evening: boolean;
  /** "HH:MM", in the profile's timezone. */
  eveningAt: string;
}

// electron/main.cjs repeats these defaults (blocks and evening on) to decide whether to keep running.
export const REMINDER_DEFAULTS: ReminderSettings = { blocks: true, before: 0, prayers: false, evening: true, eveningAt: "21:30" };
export const BEFORE_OPTIONS = [0, 5, 10, 15];

export interface Reminder {
  /** Stable: the shell shows each id once. */
  id: string;
  /** ISO instant. */
  at: string;
  title: string;
  body: string;
  /** Page to open when the notification is clicked. */
  path: string;
}

export const reminderSettings = (saved?: Partial<ReminderSettings>): ReminderSettings => ({ ...REMINDER_DEFAULTS, ...(saved ?? {}) });

/** Reminders due from 2 minutes ago (just due, still worth showing) to `horizonMs` ahead, in time order. */
export function remindersFor(
  days: DaySchedule[],
  tracking: Tracking,
  s: ReminderSettings,
  tz: string,
  now: Date,
  horizonMs = 36 * 3_600_000,
  extra: { tasks?: Task[]; deadlines?: Deadline[] } = {},
): Reminder[] {
  const from = now.getTime() - 2 * 60_000;
  const to = now.getTime() + horizonMs;
  const out: Reminder[] = [];
  const add = (r: Omit<Reminder, "at">, at: Date) => {
    if (at.getTime() >= from && at.getTime() <= to) out.push({ ...r, at: at.toISOString() });
  };
  for (const d of days) {
    const marks = tracking[d.date] ?? {};
    for (const b of d.blocks) {
      if (marks[b.key]) continue; // already marked: nothing left to remind
      const time = `${fmt(b.start)}–${fmt(b.end)}`;
      if (b.source === "block" && s.blocks) {
        const lead = Math.max(0, s.before);
        add(
          { id: `block:${d.date}:${b.key}:${lead}`, title: lead ? `In ${lead} min: ${b.title}` : b.title, body: b.ifThen ? `${time} · ${b.ifThen}` : time, path: "/today" },
          zonedToUtc(d.date, b.start - lead, tz),
        );
      } else if (b.source === "prayer" && s.prayers) {
        add({ id: `prayer:${d.date}:${b.key}`, title: b.title, body: time, path: "/today" }, zonedToUtc(d.date, b.start, tz));
      }
    }
    if (s.evening) {
      const at = toMin(s.eveningAt);
      const due = d.blocks.filter((b) => b.tracked && !b.overlay && b.start < at);
      const open = due.filter((b) => !marks[b.key]);
      const tasks = tasksFor(extra.tasks, d.date);
      const openTasks = tasks.filter((t) => !marks[taskKey(t.id)]);
      const parts = [
        open.length && `${open.length} of ${due.length} ${due.length === 1 ? "block" : "blocks"} ${open.length === 1 ? "isn't" : "aren't"} marked yet.`,
        openTasks.length && `Still to tick: ${openTasks.map((t) => t.title).join(", ")}.`,
      ].filter(Boolean);
      if (parts.length) add({ id: `evening:${d.date}`, title: "Mark today", body: parts.join(" "), path: "/today" }, zonedToUtc(d.date, at, tz));
    }
  }
  for (const a of deadlineAlerts(extra.deadlines)) {
    add({ id: a.id, title: a.title, body: a.body, path: "/today" }, zonedToUtc(a.date, toMin(DEADLINE_REMIND_AT), tz));
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
