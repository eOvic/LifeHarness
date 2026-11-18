// Time helpers. Dates are "YYYY-MM-DD" strings, times are minutes from local midnight.
// Calendar maths uses UTC so the server's own timezone never leaks in.
import { DAYS, type Day } from "./types";

const HM = /^([01]?\d|2[0-4]):([0-5]\d)$/;

export function isHM(s: unknown): s is string {
  return typeof s === "string" && HM.test(s.trim());
}

export function toMin(hm: string): number {
  const m = HM.exec(hm.trim());
  if (!m) throw new Error(`Bad time "${hm}" (expected HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 1440 -> "24:00"; values past midnight wrap (1500 -> "01:00"). */
export function fmt(min: number): string {
  let m = Math.round(min);
  if (m !== 1440) m = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Bad date "${date}"`);
  return [y, m, d];
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayOf(date: string): Day {
  const [y, m, d] = parts(date);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** The first day of the week containing `date`. */
export function weekStartOf(date: string, weekStart: Day = "mon"): string {
  const back = (DAYS.indexOf(dayOf(date)) - DAYS.indexOf(weekStart) + 7) % 7;
  return addDays(date, -back);
}

/** The 7 weekday names in order, starting at weekStart. */
export function weekDays(weekStart: Day = "mon"): Day[] {
  const i = DAYS.indexOf(weekStart);
  return [...DAYS.slice(i), ...DAYS.slice(0, i)];
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function zonedParts(instant: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    min: Number(p.hour) * 60 + Number(p.minute),
    sec: Number(p.second),
  };
}

/** Today's date and the current minute in a timezone. */
export function nowIn(tz: string, at: Date = new Date()): { date: string; min: number } {
  const z = zonedParts(at, tz);
  return { date: z.date, min: z.min };
}

/** Local date + minutes in a timezone, as minutes-from-midnight of that same date. */
export function instantToLocalMin(instant: Date, tz: string): { date: string; min: number } {
  return nowIn(tz, instant);
}

/** Convert a local wall-clock time (date + minutes) in `tz` to a UTC instant. Handles DST. */
export function zonedToUtc(date: string, min: number, tz: string): Date {
  const [y, m, d] = parts(date);
  const guess = Date.UTC(y, m - 1, d, 0, min);
  let utc = guess;
  for (let i = 0; i < 3; i++) {
    const z = zonedParts(new Date(utc), tz);
    const [zy, zm, zd] = parts(z.date);
    const asIfUtc = Date.UTC(zy, zm - 1, zd, 0, z.min, z.sec);
    const offset = asIfUtc - utc; // tz offset at this instant
    const next = guess - offset;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}
