// The events LifeHarness keeps in its own Google calendar: your plan blocks for the next days (and
// prayers, when you want prayer reminders), each with a phone reminder that follows Settings ->
// Reminders. Fixed commitments and sleep stay out: your calendar has those already, and they aren't
// the plan. Pure, so it's tested without Google (src/server/google-calendar.ts sends them).
import type { ReminderSettings } from "./reminders";
import { addDays } from "./time";
import type { DaySchedule } from "./types";

export interface CalendarEvent {
  /** Stable: "<date>:<block key>" (the server turns it into the event's id). */
  key: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  /** A phone reminder this many minutes before the start, or null for none. */
  reminderMin: number | null;
}

/** Wall-clock date-time for minutes from a day's 00:00 (past midnight runs into the next day). */
export function localDateTime(date: string, min: number): string {
  const d = addDays(date, Math.floor(min / 1440));
  const m = ((min % 1440) + 1440) % 1440;
  return `${d}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
}

/** Events for the days in [from, to). */
export function calendarEvents(days: DaySchedule[], o: { tz: string; from: string; to: string; reminders: ReminderSettings }): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const d of days) {
    if (d.date < o.from || d.date >= o.to) continue;
    for (const b of d.blocks) {
      const isBlock = b.source === "block";
      if (!isBlock && !(b.source === "prayer" && o.reminders.prayers)) continue;
      const lines = [b.ifThen && `If-then: ${b.ifThen}`, b.note, "From your LifeHarness plan."].filter(Boolean);
      out.push({
        key: `${d.date}:${b.key}`,
        summary: b.title,
        description: lines.join("\n"),
        start: { dateTime: localDateTime(d.date, b.start), timeZone: o.tz },
        end: { dateTime: localDateTime(d.date, b.end), timeZone: o.tz },
        reminderMin: isBlock ? (o.reminders.blocks ? Math.max(0, o.reminders.before) : null) : 0,
      });
    }
  }
  return out;
}
