// Prayer times (optional faith module) via the `adhan` library.
// Returned as minutes from local midnight in the user's timezone.
import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from "adhan";
import { instantToLocalMin } from "./time";
import { PRAYERS, type FaithSettings, type PrayerMethod, type PrayerName } from "./types";

export const PRAYER_METHODS: PrayerMethod[] = [
  "UmmAlQura",
  "MuslimWorldLeague",
  "Egyptian",
  "Karachi",
  "Dubai",
  "Kuwait",
  "Qatar",
  "Singapore",
  "Turkey",
  "Tehran",
  "NorthAmerica",
  "MoonsightingCommittee",
];

export const PRAYER_LABEL: Record<PrayerName, string> = {
  fajr: "Fajr",
  sunrise: "Sunrise",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export function prayerTimes(
  date: string,
  lat: number,
  lon: number,
  tz: string,
  opts: FaithSettings["prayers"] = {},
): Record<PrayerName, number> {
  const method = opts.method && PRAYER_METHODS.includes(opts.method) ? opts.method : "MuslimWorldLeague";
  const params = CalculationMethod[method]();
  params.madhab = opts.madhab === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;
  for (const [k, v] of Object.entries(opts.adjustments ?? {})) {
    if (typeof v === "number" && k in params.adjustments) {
      (params.adjustments as Record<string, number>)[k] = v;
    }
  }
  // adhan reads the calendar date from the Date's local Y/M/D components.
  const [y, m, d] = date.split("-").map(Number);
  const pt = new PrayerTimes(new Coordinates(lat, lon), new Date(y, m - 1, d), params);
  const out = {} as Record<PrayerName, number>;
  for (const p of PRAYERS) {
    const local = instantToLocalMin(pt[p], tz);
    // A prayer can land on the previous/next local date in extreme timezones; keep it on this day's scale.
    const shift = local.date < date ? -1440 : local.date > date ? 1440 : 0;
    out[p] = local.min + shift;
  }
  return out;
}
