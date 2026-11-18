// Deterministic weekly scheduler.
// The AI decides WHAT matters (goals and block specs). This code decides WHERE it goes:
// sleep -> fixed commitments -> prayers (optional) -> flexible blocks, with no overlaps.
// Anything that doesn't fit is reported (with the reason) instead of silently squeezed in.
import { prayerTimes, PRAYER_LABEL } from "./prayer";
import { addDays, dayOf, fmt, isHM, toMin, weekDays } from "./time";
import {
  CATEGORIES,
  type BlockSpec,
  type BlockWindow,
  type Category,
  type DaySchedule,
  type Day,
  type Plan,
  type PrayerName,
  type ProfileSnapshot,
  type SalahName,
  type ScheduledBlock,
  type TimeRule,
  type Unplaced,
  type WeekSchedule,
} from "./types";

type Interval = [number, number];

export const WINDOW_RANGES: Record<Exclude<BlockWindow, "peak" | "any">, Interval> = {
  morning: [5 * 60, 12 * 60],
  midday: [11 * 60, 14 * 60 + 30],
  afternoon: [13 * 60, 18 * 60],
  evening: [17 * 60, 23 * 60 + 30],
};
const DEFAULT_PEAK: Interval = [8 * 60, 12 * 60];
const DEFAULT_BED = 23 * 60;
const DEFAULT_WAKE = 7 * 60;
const SALAH: SalahName[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const UNTRACKED: Category[] = ["routine", "rest", "sleep"];

export function isTracked(category: Category): boolean {
  return !UNTRACKED.includes(category);
}

export function normalizeCategory(c: unknown): Category {
  return typeof c === "string" && c in CATEGORIES ? (c as Category) : "personal";
}

interface DayCtx extends DaySchedule {
  busy: Interval[];
  anchors: Map<string, Interval>; // "wake", "fajr", "block:x", "fixed:y" -> interval
}

/** Same-week spread patterns (indices into the week, which starts on profile.weekStart). Workdays first. */
const SPREAD: Record<number, number[]> = {
  1: [2],
  2: [1, 4],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function overlaps(a: Interval, b: Interval): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

function freeIntervals(busy: Interval[], lo: number, hi: number): Interval[] {
  const out: Interval[] = [];
  let cur = lo;
  for (const [s, e] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (e <= cur) continue;
    if (s >= hi) break;
    if (s > cur) out.push([cur, Math.min(s, hi)]);
    cur = Math.max(cur, e);
    if (cur >= hi) break;
  }
  if (cur < hi) out.push([cur, hi]);
  return out.filter(([s, e]) => e > s);
}

function resolveRule(rule: TimeRule | undefined, prayers?: Record<PrayerName, number>): number | undefined {
  if (rule == null) return undefined;
  if (typeof rule === "string") return isHM(rule) ? toMin(rule) : undefined;
  if (prayers && rule.anchor in prayers) return prayers[rule.anchor] + (Number(rule.offsetMin) || 0);
  return undefined;
}

export interface ScheduleInput {
  snapshot: ProfileSnapshot;
  plan: Pick<Plan, "blocks" | "version"> | null;
}

export function buildWeek(input: ScheduleInput, weekStartDate: string): WeekSchedule {
  const { snapshot, plan } = input;
  const tz = snapshot.timezone || "UTC";
  const weekWarnings = new Set<string>();
  const faith = snapshot.faith;
  const loc = snapshot.location;
  const faithOn = !!faith?.enabled && typeof loc?.lat === "number" && typeof loc?.lon === "number";
  if (faith?.enabled && !faithOn) weekWarnings.add("Prayer times need a location (lat/lon); prayers are not placed yet.");

  // ---- prayer times (cached per date) --------------------------------------------------
  const prayerCache = new Map<string, Record<PrayerName, number> | undefined>();
  const prayersOn = (date: string) => {
    if (!faithOn) return undefined;
    if (!prayerCache.has(date)) prayerCache.set(date, prayerTimes(date, loc!.lat!, loc!.lon!, tz, faith!.prayers));
    return prayerCache.get(date);
  };

  // ---- sleep -------------------------------------------------------------------------------
  const sleep = snapshot.sleep;
  const ruleFor = (date: string, which: "bed" | "wake") => {
    const o = sleep?.override;
    if (o && o.days?.includes(dayOf(date)) && o[which] != null) return o[which];
    return sleep?.[which];
  };
  const bedAbs = (date: string): number => {
    let b = resolveRule(ruleFor(date, "bed"), prayersOn(date));
    if (b == null) {
      if (sleep?.bed != null) weekWarnings.add("Bedtime rule could not be resolved; using 23:00.");
      b = DEFAULT_BED;
    }
    return b < 12 * 60 ? b + 1440 : b; // "00:30" means after midnight
  };
  const wakeOf = (date: string): number => {
    const w = resolveRule(ruleFor(date, "wake"), prayersOn(date));
    if (w != null) return w;
    if (sleep?.hours) return bedAbs(addDays(date, -1)) + Math.round(sleep.hours * 60) - 1440;
    if (sleep) weekWarnings.add("Wake time could not be resolved; using 07:00.");
    return DEFAULT_WAKE;
  };

  // ---- skeleton days: sleep, fixed, prayers --------------------------------------------
  const order = weekDays(snapshot.weekStart ?? "mon");
  const days: DayCtx[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartDate, i);
    const day = dayOf(date);
    const prayers = prayersOn(date);
    const wake = wakeOf(date);
    const bed = bedAbs(date);
    const ctx: DayCtx = {
      date,
      day,
      wake,
      bed,
      prayers: prayers ? { ...prayers } : undefined,
      blocks: [],
      warnings: [],
      busy: [],
      anchors: new Map(),
      planVersion: plan?.version,
    };
    const add = (b: ScheduledBlock, busy = true) => {
      ctx.blocks.push(b);
      if (busy) ctx.busy.push([b.start, b.end]);
    };

    // Sleep: the tail of last night, and tonight until midnight.
    const prevSpill = Math.max(0, bedAbs(addDays(date, -1)) - 1440);
    if (wake <= prevSpill) ctx.warnings.push(`${date}: wake ${fmt(wake)} is not after last night's bedtime ${fmt(prevSpill)}`);
    const sleepParts: Interval[] = [];
    if (wake > prevSpill) sleepParts.push([prevSpill, wake]);
    if (prevSpill > 0) ctx.busy.push([0, prevSpill]); // late previous evening: not schedulable
    if (bed < 1440) sleepParts.push([bed, 1440]);
    ctx.anchors.set("wake", [wake, wake]);
    ctx.anchors.set("bed", [Math.min(bed, 1440), Math.min(bed, 1440)]);

    // Fixed commitments
    for (const f of snapshot.fixed ?? []) {
      if (!f.days?.includes(day) || !isHM(f.start) || !isHM(f.end)) continue;
      const s = toMin(f.start);
      let e = toMin(f.end);
      if (e <= s) {
        e = 1440;
        weekWarnings.add(`"${f.title}" runs past midnight; it is cut at 24:00.`);
      }
      const cat = normalizeCategory(f.category ?? "work");
      const travel = Math.max(0, Math.round(f.travelMin ?? 0));
      if (travel) {
        add({ key: `travel:${f.id}:pre`, start: s - travel, end: s, title: "Travel", category: "routine", source: "fixed", refId: f.id, core: false, tracked: false, note: `Commute to ${f.title}` });
        add({ key: `travel:${f.id}:post`, start: e, end: e + travel, title: "Travel", category: "routine", source: "fixed", refId: f.id, core: false, tracked: false, note: `Commute from ${f.title}` });
      }
      add({ key: `fixed:${f.id}`, start: s, end: e, title: f.title, category: cat, source: "fixed", refId: f.id, core: cat !== "routine", tracked: isTracked(cat), note: f.note });
      ctx.anchors.set(`fixed:${f.id}`, [s, e]);
    }

    // Prayers (optional faith module)
    if (prayers) {
      const p = faith!.prayers ?? {};
      const pre = p.preMin ?? 5;
      const jumuah = day === "fri" && p.jumuah !== false;
      // Each prayer's time window ends at the next adhan (Isha: midnight, as an approximation).
      const windowEnd: Record<SalahName, number> = {
        fajr: prayers.sunrise,
        dhuhr: prayers.asr,
        asr: prayers.maghrib,
        maghrib: prayers.isha,
        isha: 1440,
      };
      for (const name of SALAH) {
        const adhan = prayers[name];
        let s: number;
        let e: number;
        let title = PRAYER_LABEL[name];
        let note = `Adhan ${fmt(adhan)}`;
        if (name === "dhuhr" && jumuah) {
          s = adhan - 45;
          e = adhan + 35;
          title = "Jumu'ah";
          note = `Go early; khutbah around ${fmt(adhan)}`;
        } else {
          s = adhan - pre;
          e = s + (p.durations?.[name] ?? 20);
        }
        let overlay = false;
        // Woken by the alarm a few minutes after the prayer block would start? Start at wake instead.
        if (name === "fajr" && s < wake && e > wake && wake - s <= 10) {
          e += wake - s;
          s = wake;
        }
        // Inside a fixed commitment? Pray right after it if the prayer's window is still open
        // by then (after any travel); otherwise it's a short prayer break inside the commitment.
        const clash = ctx.blocks.find((b) => b.source === "fixed" && b.key.startsWith("fixed:") && overlaps([s, e], [b.start, b.end]));
        if (clash) {
          const len = e - s;
          const travel = (snapshot.fixed ?? []).find((f) => f.id === clash.refId)?.travelMin ?? 0;
          let after = clash.end + Math.max(0, travel);
          for (const b of [...ctx.blocks].sort((x, y) => x.start - y.start)) {
            if (b.source !== "sleep" && !b.overlay && overlaps([after, after + len], [b.start, b.end])) after = b.end;
          }
          if (after + len <= windowEnd[name]) {
            s = after;
            e = after + len;
            note += ` (during ${clash.title}; pray right after it)`;
          } else {
            overlay = true;
            note += ` (prayer break during ${clash.title})`;
          }
        }
        // Inside sleep? Keep the prayer and split the sleep around it.
        const sp = sleepParts.findIndex((iv) => overlaps(iv, [s, e]));
        if (sp >= 0) {
          const [a, b] = sleepParts[sp];
          sleepParts.splice(sp, 1, ...([[a, s], [e, b]] as Interval[]).filter(([x, y]) => y - x >= 10));
          note += name === "fajr" ? " (before your wake time; sleep resumes after)" : " (inside your sleep window)";
          if (name === "fajr") weekWarnings.add("Fajr falls before the wake time on some days; sleep is split around it.");
        }
        add({ key: `prayer:${name}`, start: s, end: e, title, category: "prayer", source: "prayer", core: true, tracked: true, note, overlay }, !overlay);
        ctx.anchors.set(name, [s, e]);
      }
      ctx.anchors.set("sunrise", [prayers.sunrise, prayers.sunrise]);
    }

    for (const [k, [s, e]] of sleepParts.entries()) {
      add({ key: `sleep:${k}`, start: s, end: e, title: "Sleep", category: "sleep", source: "sleep", core: false, tracked: false });
    }
    days.push(ctx);
  }

  // ---- flexible blocks ----------------------------------------------------------------------
  const unplaced: Unplaced[] = [];
  const blocks = sortBlocks(plan?.blocks ?? [], weekWarnings);
  const peak: Interval = (() => {
    const pk = snapshot.energy?.peak;
    return pk && isHM(pk.start) && isHM(pk.end) ? [toMin(pk.start), toMin(pk.end)] : DEFAULT_PEAK;
  })();

  for (const block of blocks) {
    const dur = Math.max(5, Math.min(600, Math.round(block.durationMin || 30)));
    const placedDays: number[] = [];
    const reasons: string[] = [];
    const tryDay = (i: number): boolean => {
      const r = placeOn(days[i], block, dur, peak);
      if (typeof r === "string") {
        reasons.push(`${days[i].day}: ${r}`);
        return false;
      }
      placedDays.push(i);
      return true;
    };

    let wanted: number;
    if (block.days?.length) {
      const idx = [...new Set(block.days)].map((d) => order.indexOf(d)).filter((i) => i >= 0);
      wanted = idx.length;
      idx.forEach(tryDay);
    } else {
      wanted = Math.max(1, Math.min(7, Math.round(block.timesPerWeek ?? 7)));
      const tried = new Set<number>();
      for (const i of SPREAD[wanted]) {
        tried.add(i);
        tryDay(i);
      }
      // Fallback: other days, most free time first.
      const rest = [0, 1, 2, 3, 4, 5, 6]
        .filter((i) => !tried.has(i))
        .sort((a, b) => freeOf(days[b]) - freeOf(days[a]));
      for (const i of rest) {
        if (placedDays.length >= wanted) break;
        tryDay(i);
      }
    }
    if (placedDays.length < wanted) {
      unplaced.push({ blockId: block.id, title: block.title, wanted, placed: placedDays.length, reasons: reasons.slice(0, 4) });
    }
  }

  // ---- finish ---------------------------------------------------------------------------------
  const out: DaySchedule[] = days.map((d) => {
    d.blocks.sort((a, b) => a.start - b.start || a.end - b.end);
    const solid = d.blocks.filter((b) => b.source !== "sleep" && !b.overlay);
    for (let i = 1; i < solid.length; i++) {
      if (solid[i].start < solid[i - 1].end) {
        d.warnings.push(`${d.date}: "${solid[i - 1].title}" overlaps "${solid[i].title}" at ${fmt(solid[i].start)}`);
      }
    }
    const { busy: _b, anchors: _a, ...rest } = d;
    return rest;
  });
  return { start: weekStartDate, days: out, unplaced, stats: weekStats(out), warnings: [...weekWarnings] };
}

function freeOf(d: DayCtx): number {
  return freeIntervals(d.busy, d.wake, Math.min(d.bed, 1440)).reduce((s, [a, b]) => s + b - a, 0);
}

/** Anchored blocks first, then core, priority, energy, length; a block always after the block it is anchored to. */
function sortBlocks(blocks: BlockSpec[], warnings: Set<string>): BlockSpec[] {
  const energyRank = { high: 0, medium: 1, low: 2 } as const;
  const key = (b: BlockSpec) => [
    b.after || b.before ? 0 : 1,
    b.core ? 0 : 1,
    b.priority ?? 2,
    energyRank[b.energy ?? "medium"],
    -(b.durationMin || 0),
  ];
  const sorted = [...blocks].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
  // Topological pass for block:<id> anchors.
  const ids = new Set(sorted.map((b) => b.id));
  const deps = (b: BlockSpec) =>
    [b.after?.ref, b.before?.ref]
      .filter((r): r is string => typeof r === "string")
      .map((r) => (r.startsWith("block:") ? r.slice(6) : r))
      .filter((r) => ids.has(r) && r !== b.id);
  const out: BlockSpec[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const byId = new Map(sorted.map((b) => [b.id, b]));
  const visit = (b: BlockSpec) => {
    if (done.has(b.id)) return;
    if (visiting.has(b.id)) {
      warnings.add(`Anchor cycle involving "${b.title}"; its anchor is ignored.`);
      return;
    }
    visiting.add(b.id);
    for (const d of deps(b)) visit(byId.get(d)!);
    visiting.delete(b.id);
    done.add(b.id);
    out.push(b);
  };
  sorted.forEach(visit);
  return out;
}

function anchorOf(ctx: DayCtx, ref: string): Interval | undefined {
  const r = ref.trim();
  if (ctx.anchors.has(r)) return ctx.anchors.get(r);
  const lower = r.toLowerCase();
  if (ctx.anchors.has(lower)) return ctx.anchors.get(lower);
  if (ctx.anchors.has(`block:${r}`)) return ctx.anchors.get(`block:${r}`);
  if (ctx.anchors.has(`fixed:${r}`)) return ctx.anchors.get(`fixed:${r}`);
  return undefined;
}

/** Place one occurrence of a block on a day. Returns a reason string on failure. */
function placeOn(ctx: DayCtx, block: BlockSpec, dur: number, peak: Interval): ScheduledBlock | string {
  const key = `block:${block.id}`;
  if (ctx.blocks.some((b) => b.key === key)) return "already placed this day";
  const awakeEnd = Math.min(ctx.bed, 1440);
  let lo = ctx.wake;
  let hi = awakeEnd;
  let latest = false;

  if (!block.after && !block.before) {
    const w = block.window ?? "any";
    const range: Interval | undefined = w === "peak" ? peak : w === "any" ? undefined : WINDOW_RANGES[w];
    if (range) {
      lo = Math.max(lo, range[0]);
      hi = Math.min(hi, range[1]);
    }
  }
  if (isHM(block.earliest)) lo = Math.max(lo, toMin(block.earliest));
  if (isHM(block.latest)) hi = Math.min(hi, toMin(block.latest));
  if (block.after) {
    const a = anchorOf(ctx, block.after.ref);
    if (!a) return `anchor "${block.after.ref}" doesn't exist on this day`;
    const from = a[1] + (block.after.gapMin ?? 0);
    lo = Math.max(lo, from);
    if (!block.before && !block.fill) hi = Math.min(hi, from + (block.after.maxDelayMin ?? 30) + dur);
  }
  if (block.before) {
    const b = anchorOf(ctx, block.before.ref);
    if (!b) return `anchor "${block.before.ref}" doesn't exist on this day`;
    hi = Math.min(hi, b[0] - (block.before.gapMin ?? 0));
    if (!block.after) latest = true;
  }
  if (hi - lo < dur) {
    return `allowed time ${fmt(lo)}-${fmt(Math.max(lo, hi))} is shorter than ${dur} min`;
  }
  const free = freeIntervals(ctx.busy, lo, hi);
  const fits = free.filter(([s, e]) => e - s >= dur);
  if (!fits.length) {
    const biggest = free.reduce((m, [s, e]) => Math.max(m, e - s), 0);
    return `no free ${dur}-min slot in ${fmt(lo)}-${fmt(hi)} (largest gap ${biggest} min)`;
  }
  let start: number;
  let end: number;
  if (block.fill) {
    [start, end] = fits[0];
  } else if (latest) {
    end = fits[fits.length - 1][1];
    start = end - dur;
  } else {
    start = fits[0][0];
    end = start + dur;
  }
  const category = normalizeCategory(block.category);
  const sb: ScheduledBlock = {
    key,
    start,
    end,
    title: block.title,
    category,
    source: "block",
    refId: block.id,
    goalId: block.goalId,
    core: !!block.core,
    tracked: isTracked(category),
    note: block.note,
    ifThen: block.ifThen,
  };
  ctx.blocks.push(sb);
  ctx.busy.push([start, end]);
  ctx.anchors.set(key, [start, end]);
  return sb;
}

function weekStats(days: DaySchedule[]): WeekSchedule["stats"] {
  let awake = 0;
  let scheduled = 0;
  const byCategory: Partial<Record<Category, number>> = {};
  const byGoal: Record<string, number> = {};
  const freeByDay: Record<string, number> = {};
  for (const d of days) {
    const a = Math.max(0, Math.min(d.bed, 1440) - d.wake);
    let s = 0;
    for (const b of d.blocks) {
      if (b.source === "sleep" || b.overlay) continue;
      const len = Math.max(0, Math.min(b.end, 1440) - Math.max(b.start, d.wake));
      s += len;
      byCategory[b.category] = (byCategory[b.category] ?? 0) + (b.end - b.start);
      if (b.goalId) byGoal[b.goalId] = (byGoal[b.goalId] ?? 0) + (b.end - b.start);
    }
    awake += a;
    scheduled += Math.min(s, a);
    freeByDay[d.date] = Math.max(0, a - s);
  }
  const free = Math.max(0, awake - scheduled);
  return {
    awakeMin: awake,
    scheduledMin: scheduled,
    freeMin: free,
    freePct: awake ? Math.round((free / awake) * 100) : 0,
    byCategory,
    byGoal,
    freeByDay,
  };
}

/** Validate a plan's block specs before scheduling. Returns human-readable problems (empty = ok). */
export function validateBlocks(blocks: BlockSpec[], fixedIds: string[], goalIds: string[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const anchorOk = (ref: string) => {
    const r = ref.trim();
    if (["wake", "bed", "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].includes(r.toLowerCase())) return true;
    const id = r.replace(/^(block|fixed):/, "");
    return blocks.some((b) => b.id === id) || fixedIds.includes(id);
  };
  for (const b of blocks) {
    if (!b.id || !/^[a-z0-9][a-z0-9_-]*$/.test(b.id)) errs.push(`block "${b.title}": id must be lowercase a-z0-9_- (got "${b.id}")`);
    if (ids.has(b.id)) errs.push(`duplicate block id "${b.id}"`);
    ids.add(b.id);
    if (!b.title) errs.push(`block "${b.id}": missing title`);
    if (!(b.durationMin > 0)) errs.push(`block "${b.id}": durationMin must be > 0`);
    if (b.category && !(b.category in CATEGORIES)) errs.push(`block "${b.id}": unknown category "${b.category}"`);
    for (const t of [b.earliest, b.latest]) if (t != null && !isHM(t)) errs.push(`block "${b.id}": bad time "${t}"`);
    if (b.after && !anchorOk(b.after.ref)) errs.push(`block "${b.id}": unknown anchor "${b.after.ref}"`);
    if (b.before && !anchorOk(b.before.ref)) errs.push(`block "${b.id}": unknown anchor "${b.before.ref}"`);
    if (b.goalId && goalIds.length && !goalIds.includes(b.goalId)) errs.push(`block "${b.id}": unknown goalId "${b.goalId}"`);
    if (b.days?.some((d) => !["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(d as Day))) errs.push(`block "${b.id}": bad day in ${JSON.stringify(b.days)}`);
  }
  return errs;
}
