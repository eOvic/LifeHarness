// .ics export (RFC 5545).
// Times are written in UTC so any calendar app shows them correctly without a VTIMEZONE block.
// Stable UIDs (<date>-<block key>) let a re-import update events in place.
import { DEADLINE_EVENT_REMINDERS } from "./calendar-events";
import { addDays, zonedToUtc } from "./time";
import type { DaySchedule, Deadline, ScheduledBlock } from "./types";

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold to 75 octets per line (continuation lines start with a space), UTF-8 safe. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    const limit = out.length ? 74 : 75;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Minutes before the block for a phone notification, or null for none. Prayers: none (a prayer app does it better). */
export function alertMinutes(b: ScheduledBlock): number | null {
  if (b.source === "prayer") return null;
  if (b.source === "fixed") return b.category === "routine" ? null : 10;
  if (b.category === "sleep") return 0;
  if (b.category === "health") return 5;
  if (b.core) return 0;
  return null;
}

/** Deadlines become all-day events with alerts at 09:00 a week before and the day before. */
export function toIcs(days: DaySchedule[], tz: string, calName = "LifeHarness", deadlines: Deadline[] = []): string {
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LifeHarness//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
    `X-WR-TIMEZONE:${tz}`,
  ];
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const d of days) {
    for (const b of d.blocks) {
      if (b.source === "sleep" && b.start === 0) continue; // covered by last night's event
      let endDate = d.date;
      let endMin = b.end;
      if (b.source === "sleep" && b.end === 1440) {
        const next = byDate.get(addDays(d.date, 1));
        const morning = next?.blocks.find((x) => x.source === "sleep" && x.start === 0);
        if (morning) {
          endDate = next!.date;
          endMin = morning.end;
        }
      }
      const desc = [b.note, b.ifThen ? `If-then: ${b.ifThen}` : "", b.core ? "★ non-negotiable" : ""].filter(Boolean).join("\n");
      const uid = `${d.date.replace(/-/g, "")}-${b.key.replace(/[^a-z0-9]+/gi, "-")}@lifeharness`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(zonedToUtc(d.date, b.start, tz))}`,
        `DTEND:${stamp(zonedToUtc(endDate, endMin, tz))}`,
        `SUMMARY:${esc(b.title)}`,
        `CATEGORIES:${esc(b.category)}`,
        "TRANSP:TRANSPARENT",
      );
      if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
      const alert = alertMinutes(b);
      if (alert != null) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(b.title)}`, `TRIGGER:-PT${alert}M`, "END:VALARM");
      lines.push("END:VEVENT");
    }
  }
  const from = days[0]?.date ?? "";
  for (const dl of deadlines) {
    if (dl.done || !/^\d{4}-\d{2}-\d{2}$/.test(dl.date) || dl.date < from) continue;
    const title = `Due: ${dl.title}${dl.time ? ` (${dl.time})` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:deadline-${dl.id.replace(/[^a-z0-9]+/gi, "-")}@lifeharness`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dl.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(dl.date, 1).replace(/-/g, "")}`,
      `SUMMARY:${esc(title)}`,
      "TRANSP:TRANSPARENT",
    );
    if (dl.note) lines.push(`DESCRIPTION:${esc(dl.note)}`);
    for (const m of DEADLINE_EVENT_REMINDERS) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, `TRIGGER:-PT${m}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
