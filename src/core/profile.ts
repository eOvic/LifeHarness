// The life map: merging the interviewer's partial updates, and measuring what is still unknown.
import { isHM } from "./time";
import type { FixedCommitment, Goal, Profile, ProfileSnapshot } from "./types";

export interface ProfilePatch extends Partial<Omit<Profile, "updatedAt" | "lessons">> {
  remove?: {
    goals?: string[];
    fixed?: string[];
    values?: string[];
    obstacles?: string[];
    history?: string[];
    preferences?: string[];
    constraintsNotes?: string[];
    ifThen?: string[];
    habitsRunning?: string[];
    habitsWanted?: string[];
  };
}

function upsertById<T extends { id: string }>(list: T[] = [], items: T[] = [], label: string, changes: string[], name: (t: T) => string): T[] {
  const out = [...list];
  for (const it of items) {
    if (!it || typeof it.id !== "string" || !it.id) continue;
    const i = out.findIndex((x) => x.id === it.id);
    if (i >= 0) {
      out[i] = { ...out[i], ...stripUndefined(it) };
      changes.push(`${label} ~${it.id}`);
    } else {
      out.push(it);
      changes.push(`${label} +${it.id} "${name(it)}"`);
    }
  }
  return out;
}

function unionStrings(list: string[] = [], items: unknown, label: string, changes: string[]): string[] {
  const out = [...list];
  const arr = Array.isArray(items) ? items : typeof items === "string" ? [items] : [];
  for (const s of arr) {
    if (typeof s !== "string" || !s.trim()) continue;
    if (!out.some((x) => x.toLowerCase() === s.trim().toLowerCase())) {
      out.push(s.trim());
      changes.push(`${label} +"${s.trim().slice(0, 60)}"`);
    }
  }
  return out;
}

function removeStrings(list: string[] | undefined, rm: string[] | undefined): string[] | undefined {
  if (!list || !rm?.length) return list;
  const r = rm.map((s) => s.toLowerCase());
  return list.filter((x) => !r.includes(x.toLowerCase()));
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function mergeProfile(p: Profile, patch: ProfilePatch): { profile: Profile; changes: string[] } {
  const changes: string[] = [];
  const next: Profile = { ...p };
  const scalar = ["name", "about", "timezone", "vision", "weekStart", "fixedConfirmed", "goalsConfirmed"] as const;
  for (const k of scalar) {
    if (patch[k] !== undefined && patch[k] !== null) {
      (next as Record<string, unknown>)[k] = patch[k];
      changes.push(`${k} set`);
    }
  }
  for (const k of ["location", "capacity"] as const) {
    if (patch[k] && typeof patch[k] === "object") {
      next[k] = { ...(p[k] ?? {}), ...stripUndefined(patch[k] as object) } as never;
      changes.push(`${k} updated`);
    }
  }
  if (patch.energy && typeof patch.energy === "object") {
    next.energy = { ...(p.energy ?? {}), ...stripUndefined(patch.energy) };
    changes.push("energy updated");
  }
  if (patch.sleep && typeof patch.sleep === "object") {
    next.sleep = { ...(p.sleep ?? { bed: "23:00" }), ...stripUndefined(patch.sleep) };
    changes.push("sleep updated");
  }
  if (patch.faith && typeof patch.faith === "object") {
    next.faith = {
      ...(p.faith ?? { enabled: false }),
      ...stripUndefined(patch.faith),
      prayers: { ...(p.faith?.prayers ?? {}), ...(patch.faith.prayers ?? {}) },
    };
    changes.push(`faith module ${next.faith.enabled ? "on" : "off"}`);
  }
  if (patch.values) {
    const vals = [...(p.values ?? [])];
    for (const v of patch.values) {
      if (!v?.name) continue;
      const i = vals.findIndex((x) => x.name.toLowerCase() === v.name.toLowerCase());
      if (i >= 0) vals[i] = { ...vals[i], ...stripUndefined(v) };
      else {
        vals.push(v);
        changes.push(`value +"${v.name}"`);
      }
    }
    next.values = vals;
  }
  if (patch.goals) next.goals = upsertById<Goal>(p.goals, patch.goals.map(normalizeGoal), "goal", changes, (g) => g.title);
  if (patch.fixed) next.fixed = upsertById<FixedCommitment>(p.fixed, patch.fixed, "fixed", changes, (f) => f.title);
  if (patch.ifThen) next.ifThen = upsertById(p.ifThen, patch.ifThen, "if-then", changes, (x) => x.then);
  for (const k of ["obstacles", "history", "preferences", "constraintsNotes"] as const) {
    if (patch[k] !== undefined) next[k] = unionStrings(p[k], patch[k], k, changes);
  }
  if (patch.habits) {
    next.habits = {
      running: unionStrings(p.habits?.running, patch.habits.running, "habit(running)", changes),
      wanted: unionStrings(p.habits?.wanted, patch.habits.wanted, "habit(wanted)", changes),
    };
  }

  const rm = patch.remove;
  if (rm) {
    if (rm.goals?.length) next.goals = next.goals?.filter((g) => !rm.goals!.includes(g.id));
    if (rm.fixed?.length) next.fixed = next.fixed?.filter((f) => !rm.fixed!.includes(f.id));
    if (rm.ifThen?.length) next.ifThen = next.ifThen?.filter((f) => !rm.ifThen!.includes(f.id));
    if (rm.values?.length) {
      const r = rm.values.map((s) => s.toLowerCase());
      next.values = next.values?.filter((v) => !r.includes(v.name.toLowerCase()));
    }
    next.obstacles = removeStrings(next.obstacles, rm.obstacles);
    next.history = removeStrings(next.history, rm.history);
    next.preferences = removeStrings(next.preferences, rm.preferences);
    next.constraintsNotes = removeStrings(next.constraintsNotes, rm.constraintsNotes);
    if (next.habits) {
      next.habits = {
        running: removeStrings(next.habits.running, rm.habitsRunning),
        wanted: removeStrings(next.habits.wanted, rm.habitsWanted),
      };
    }
    changes.push("removed: " + Object.entries(rm).filter(([, v]) => v?.length).map(([k, v]) => `${k}(${v!.length})`).join(", "));
  }
  next.updatedAt = new Date().toISOString();
  return { profile: next, changes };
}

function normalizeGoal(g: Goal): Goal {
  const out = { ...g };
  if (out.confidence != null) out.confidence = Math.max(0, Math.min(100, Math.round(Number(out.confidence))));
  if (!out.status) out.status = "active";
  return out;
}

export function snapshotOf(p: Profile): ProfileSnapshot {
  const { timezone, location, weekStart, sleep, fixed, energy, faith } = p;
  return structuredClone({ timezone, location, weekStart, sleep, fixed, energy, faith });
}

export interface Strand {
  id: string;
  label: string;
  done: boolean;
  /** Required before the intake can conclude (the scheduler cannot work without it). */
  critical: boolean;
  hint: string;
}

/** What the life map still lacks. Drives the interviewer's next question and gates `intake_done`. */
export function coverage(p: Profile): Strand[] {
  const active = (p.goals ?? []).filter((g) => (g.status ?? "active") === "active");
  const year = active.filter((g) => g.horizon === "year");
  const near = active.filter((g) => g.horizon === "month" || g.horizon === "week" || g.horizon === "quarter");
  const vague = active.filter((g) => !g.measure);
  const noWhy = year.filter((g) => !g.why);
  const noConf = year.filter((g) => g.confidence == null);
  const faithDecided = typeof p.faith?.enabled === "boolean";
  const needsLoc = !!p.faith?.enabled && (typeof p.location?.lat !== "number" || typeof p.location?.lon !== "number");
  const sleepOk = !!p.sleep && p.sleep.bed != null && (p.sleep.wake != null || !!p.sleep.hours);
  const peakOk = !!p.energy?.peak && isHM(p.energy.peak.start) && isHM(p.energy.peak.end);
  return [
    { id: "direction", label: "Values & life direction", done: !!p.values?.length && !!p.vision, critical: false, hint: "top 3 values in their words, and what a good life looks like in ~3-5 years" },
    { id: "goalList", label: "All goals listed & ranked", done: !!p.goalsConfirmed && year.length > 0, critical: true, hint: "record EVERY want they mention as a year-goal stub immediately; ask if the list is complete and which matters most; then set goalsConfirmed=true" },
    { id: "goals", label: "Concrete goals (measure + deadline)", done: active.some((g) => g.measure) && !vague.length, critical: true, hint: vague.length ? `make concrete (measure/deadline): ${vague.map((g) => g.id).join(", ")}` : "at least one goal with a specific measure" },
    { id: "year", label: "Year goals (max ~3) with why + confidence", done: year.length > 0 && !noWhy.length && !noConf.length, critical: false, hint: !year.length ? "what they want to achieve this year" : `missing why: ${noWhy.map((g) => g.id).join(", ") || "-"}; missing confidence: ${noConf.map((g) => g.id).join(", ") || "-"}` },
    { id: "near", label: "This month / this week", done: near.length > 0, critical: false, hint: "decompose: month milestone and this week's first visible step per year goal" },
    { id: "sleep", label: "Sleep (bed + wake or hours)", done: sleepOk, critical: true, hint: "current vs desired bed/wake; consistency on weekends" },
    { id: "fixed", label: "Fixed commitments", done: !!p.fixedConfirmed, critical: true, hint: "work/classes/family/commute with days + HH:MM; set fixedConfirmed=true when the list is complete (even if empty)" },
    { id: "faith", label: "Faith / spiritual practices", done: faithDecided && !needsLoc, critical: true, hint: needsLoc ? "need their city (lat/lon) for prayer times" : "ask once, neutrally, whether any religious/spiritual practice should anchor the schedule" },
    { id: "weekStart", label: "First day of their week", done: !!p.weekStart, critical: true, hint: "e.g. Sunday in Saudi Arabia, Monday in Europe" },
    { id: "energy", label: "Energy & focus pattern", done: peakOk, critical: false, hint: "peak window (HH:MM-HH:MM), slump, longest focus stretch" },
    { id: "history", label: "Track record", done: !!p.history?.length, critical: false, hint: "what they tried before for the main goal and what they actually sustained" },
    { id: "obstacles", label: "Main obstacles", done: !!p.obstacles?.length, critical: false, hint: "the inner obstacle that usually wins, and what derails a day" },
    { id: "capacity", label: "Capacity edge", done: !!p.capacity?.weeklyFreeHours || !!p.capacity?.notes, critical: false, hint: "the weekly load for the top goal they'd keep even on a bad week" },
  ];
}

export function coverageText(p: Profile): string {
  const c = coverage(p);
  const open = c.filter((s) => !s.done);
  if (!open.length) return "All strands covered.";
  return open.map((s) => `- [${s.critical ? "required" : "open"}] ${s.label}: ${s.hint}`).join("\n");
}
