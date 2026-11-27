// Agent tools: JSON-schema definitions + server-side executors.
import type { Tool } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { coverage, mergeProfile, snapshotOf, type ProfilePatch } from "../core/profile";
import { buildWeek, validateBlocks } from "../core/scheduler";
import { fmt, fmtDuration, nowIn, weekStartOf } from "../core/time";
import { CATEGORY_KEYS, DAYS, HORIZONS, PRAYERS, type BlockSpec, type Goal, type WeekSchedule } from "../core/types";
import { PRAYER_METHODS } from "../core/prayer";
import { getProfile, saveProfile, type ChatRecord, type Phase } from "./store";

// ---------------------------------------------------------------------------- schemas
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: "number", ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: object, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });
const enm = (values: readonly string[], description?: string) => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const obj = (properties: Record<string, object>, required: string[] = [], description?: string) => ({
  type: "object",
  properties,
  required,
  ...(description ? { description } : {}),
});

const SALAH = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const hm = str('Time "HH:MM" (24h)');
const day = enm(DAYS);
const timeRule = {
  description: '"HH:MM", or relative to a prayer time (faith module only): {"anchor":"isha","offsetMin":90}',
  anyOf: [{ type: "string" }, obj({ anchor: enm(PRAYERS), offsetMin: num() }, ["anchor", "offsetMin"])],
};

const goalSchema = obj(
  {
    id: str('Stable lowercase slug, e.g. "half-marathon". Reuse ids to update.'),
    horizon: enm(HORIZONS),
    title: str(),
    measure: str("How they will know it is done (specific)"),
    deadline: str("YYYY-MM-DD or plain text"),
    why: str("The value it serves, in their words"),
    parentId: str("Parent goal id (year -> quarter/month -> week)"),
    area: str("Life area, e.g. health, career, study, faith, family, finance"),
    kind: enm(["outcome", "learning", "habit"]),
    confidence: num("0-100 self-efficacy"),
    status: enm(["active", "paused", "done", "dropped"]),
  },
  ["id", "horizon", "title"],
);

const fixedSchema = obj(
  {
    id: str("Stable slug"),
    title: str(),
    days: arr(day),
    start: hm,
    end: hm,
    category: enm(CATEGORY_KEYS),
    travelMin: num("Commute minutes blocked before and after"),
    note: str(),
  },
  ["id", "title", "days", "start", "end"],
);

const blockSchema = obj(
  {
    id: str('Stable lowercase slug, e.g. "deep-thesis"'),
    title: str("Short, concrete: 'Deep work: thesis draft'"),
    category: enm(CATEGORY_KEYS),
    goalId: str("The goal this block serves"),
    durationMin: num(),
    days: arr(day, "Exact days, only when the day matters"),
    timesPerWeek: num("1-7; spread automatically (workdays first). Default 7 = daily."),
    window: enm(["peak", "morning", "midday", "afternoon", "evening", "any"]),
    earliest: hm,
    latest: hm,
    after: obj({ ref: str('Anchor: "wake" | "bed" | a prayer | "block:<id>" | "fixed:<id>"'), gapMin: num(), maxDelayMin: num("Max minutes after the anchor (default 30)") }, ["ref"]),
    before: obj({ ref: str("Anchor (as above)"), gapMin: num() }, ["ref"]),
    fill: bool("Span the whole free gap between after and before"),
    priority: num("1 protect, 2 normal, 3 nice-to-have"),
    core: bool("Non-negotiable"),
    energy: enm(["high", "medium", "low"]),
    ifThen: str("If <cue>, then <action>"),
    note: str(),
  },
  ["id", "title", "category", "durationMin"],
);

export const TOOLS: Record<string, Tool> = {
  ask_question: {
    name: "ask_question",
    description:
      "Ask the person ONE question and end your turn. They answer in a dock with your options, an 'Other' field, a thinking field, and optionally a confidence slider. Their answer comes back as this tool's result.",
    parameters: obj(
      {
        question: str("The question (markdown). Exactly one question."),
        why: str("Optional one-line reason, shown small under the question"),
        kind: enm(["single", "multi", "text"], "single = pick one option, multi = pick any, text = open answer"),
        options: arr(obj({ label: str(), description: str() }, ["label"]), "2-6 options for single/multi. Never include an 'Other' option (always available)."),
        askConfidence: bool("Show a 0-100% confidence slider"),
        confidenceLabel: str("Slider label, e.g. 'How sure are you that you would keep this on a bad week?'"),
        placeholder: str("Placeholder for the free-text field"),
      },
      ["question"],
    ),
  },
  update_profile: {
    name: "update_profile",
    description:
      "Record what you learned in the person's life map (partial update; lists of goals/fixed are upserted by id, string lists are appended). Use `remove` to delete wrong entries. Returns what changed and the strands still open.",
    parameters: obj({
      name: str(),
      about: str("Life situation in a sentence or two (role, stage, context)"),
      timezone: str("IANA timezone, e.g. Europe/Berlin"),
      location: obj({ city: str(), country: str(), lat: num(), lon: num() }, [], "Needed for prayer times. City + country is enough (geocoded)."),
      weekStart: day,
      values: arr(obj({ name: str(), why: str() }, ["name"]), "Top values in their words"),
      vision: str("What a good life looks like for them in ~3-5 years, in their words"),
      goals: arr(goalSchema),
      goalsConfirmed: bool("True once they confirmed the list of year goals is complete and ranked"),
      sleep: obj({ bed: timeRule, wake: timeRule, hours: num("Sleep length; used when wake is not given"), override: obj({ days: arr(day), bed: timeRule, wake: timeRule }, ["days"], "Different times on some days") }, [], "Desired sleep"),
      fixed: arr(fixedSchema, "Fixed commitments (work, classes, family duties, commute)"),
      fixedConfirmed: bool("True once they confirmed the fixed list is complete (even if empty)"),
      constraintsNotes: arr(str(), "Other constraints in their words"),
      energy: obj({ chronotype: enm(["morning", "evening", "neither"]), peak: obj({ start: hm, end: hm }, ["start", "end"]), low: obj({ start: hm, end: hm }, ["start", "end"]), focusMaxMin: num("Longest single focus stretch in minutes"), notes: str() }),
      capacity: obj({ weeklyFreeHours: num(), notes: str("e.g. the load they'd keep on a bad week") }),
      habits: obj({ running: arr(str(), "Habits that already run reliably"), wanted: arr(str(), "Habits they want") }),
      tasks: arr(
        obj(
          { id: str('Stable slug, e.g. "duha"'), title: str("Short: 'Pray Duha'"), days: arr(day, "Only on these days; omit for every day"), goalId: str(), note: str() },
          ["id", "title"],
        ),
        "Daily tasks: untimed things to tick on Today (not placed in the schedule). Use when they want to track something without a time slot.",
      ),
      deadlines: arr(
        obj(
          { id: str("Stable slug"), title: str("What is due: 'DSP HW4'"), date: str("YYYY-MM-DD"), time: hm, goalId: str(), note: str(), done: bool("True once it's handed in / over") },
          ["id", "title", "date"],
        ),
        "Dated deadlines (exams, homework, applications). Counted down on Today and reminded 7 days, 1 day and 0 days before.",
      ),
      obstacles: arr(str(), "Main inner obstacles / what derails a day"),
      history: arr(str(), "Track record: past attempts and what really happened"),
      preferences: arr(str()),
      faith: obj({
        enabled: bool("Religious/spiritual practice anchors the schedule (prayer times)"),
        prayers: obj({
          method: enm(PRAYER_METHODS),
          madhab: enm(["shafi", "hanafi"]),
          adjustments: obj(Object.fromEntries(PRAYERS.map((p) => [p, num()])), [], "Minute offsets per prayer to match a local app, e.g. {\"fajr\":1}"),
          durations: obj(Object.fromEntries(SALAH.map((p) => [p, num()])), [], "Block minutes per prayer (default 20)"),
          preMin: num("Start this many minutes before the adhan (default 5)"),
          jumuah: bool("Friday Jumu'ah instead of Dhuhr (default true)"),
        }),
        notes: str(),
      }),
      remove: obj({
        goals: arr(str()),
        fixed: arr(str()),
        values: arr(str()),
        obstacles: arr(str()),
        history: arr(str()),
        preferences: arr(str()),
        constraintsNotes: arr(str()),
        ifThen: arr(str()),
        habitsRunning: arr(str()),
        habitsWanted: arr(str()),
        tasks: arr(str(), "Task ids"),
        deadlines: arr(str(), "Deadline ids"),
      }),
    }),
  },
  intake_done: {
    name: "intake_done",
    description: "Conclude the interview once every required strand is covered. Refused (with the missing list) otherwise. The planner takes over right after.",
    parameters: obj(
      {
        summary: str("A few sentences: who they are, what they want, what constrains them"),
        strands: arr(obj({ name: str(), current: str(), target: str(), notes: str() }, ["name"])),
        risks: arr(str(), "What is most likely to break the plan"),
      },
      ["summary"],
    ),
  },
  propose_plan: {
    name: "propose_plan",
    description:
      "Send the full plan (goal tree + recurring blocks). The system runs the scheduler on their real week and returns placements, unplaced blocks with reasons, hours per goal, free time and each day's layout. Iterate until clean, then present. The person adopts it with a button.",
    parameters: obj(
      {
        approach: str("For them: what the week is built around and why, trade-offs, what was parked"),
        goals: arr(goalSchema, "The goal tree this plan serves (reuse life-map ids)"),
        blocks: arr(blockSchema, "Recurring time blocks (not sleep, fixed commitments or prayers: those are placed automatically)"),
      },
      ["approach", "goals", "blocks"],
    ),
  },
  add_if_then: {
    name: "add_if_then",
    description: "Save an implementation intention (if-then plan) to the life map.",
    parameters: obj({ if: str("The cue/situation"), then: str("The action"), blockId: str("Block it supports, if any") }, ["if", "then"]),
  },
  add_lesson: {
    name: "add_lesson",
    description: "Save a durable lesson about how this person works, with the evidence. Future plans start from these.",
    parameters: obj({ text: str(), evidence: str() }, ["text"]),
  },
};

export const PHASE_TOOLS: Record<Phase, string[]> = {
  intake: ["ask_question", "update_profile", "intake_done"],
  plan: ["ask_question", "update_profile", "propose_plan", "add_if_then"],
  review: ["ask_question", "update_profile", "propose_plan", "add_if_then", "add_lesson"],
};

export const TOOL_LABELS: Record<string, string> = {
  update_profile: "Updated your life map",
  intake_done: "Interview complete",
  propose_plan: "Drafted a plan (scheduler run)",
  add_if_then: "Saved an if-then plan",
  add_lesson: "Saved a lesson",
};

// ---------------------------------------------------------------------------- executors
export interface ToolOutcome {
  text: string;
  isError?: boolean;
  detail?: string;
}

async function geocode(city: string, country?: string): Promise<{ lat: number; lon: number; label: string } | null> {
  try {
    const q = encodeURIComponent([city, country].filter(Boolean).join(", "));
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
      headers: { "User-Agent": `LifeHarness/${process.env.LIFEHARNESS_VERSION ?? "dev"} (local-first planner)` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!hit) return null;
    // ~1 km is plenty for prayer times, and the profile (with these numbers) goes to the AI provider.
    return { lat: Math.round(Number(hit.lat) * 100) / 100, lon: Math.round(Number(hit.lon) * 100) / 100, label: hit.display_name };
  } catch {
    return null;
  }
}

function openStrands(): string {
  const open = coverage(getProfile()).filter((s) => !s.done);
  if (!open.length) return "All strands covered.";
  return "Still open:\n" + open.map((s) => `- [${s.critical ? "required" : "open"}] ${s.label}: ${s.hint}`).join("\n");
}

export async function execUpdateProfile(args: ProfilePatch): Promise<ToolOutcome> {
  const before = getProfile();
  const { profile, changes } = mergeProfile(before, args);
  const notes: string[] = [];
  const loc = profile.location;
  const locChanged = args.location && (args.location.city || args.location.country) && args.location.lat == null;
  if (loc && locChanged && loc.city) {
    const hit = await geocode(loc.city, loc.country);
    if (hit) {
      profile.location = { ...loc, lat: hit.lat, lon: hit.lon };
      notes.push(`Geocoded "${loc.city}" -> ${hit.lat}, ${hit.lon} (${hit.label}).`);
      if (!args.timezone) notes.push(`Timezone on file is ${profile.timezone ?? "unset"}. If that isn't where they live, set the IANA timezone (e.g. Asia/Amman).`);
    } else {
      const { lat: _lat, lon: _lon, ...rest } = loc;
      profile.location = rest; // never keep the previous city's coordinates
      notes.push(`Could not geocode "${loc.city}". Ask for a nearby larger city, or set lat/lon directly.`);
    }
  }
  saveProfile(profile);
  // Deadlines go to the Google calendar (all-day events with phone reminders): send them now.
  if (args.deadlines || args.remove?.deadlines) void import("./google-calendar").then((g) => g.syncSoon()).catch(() => {});
  return {
    text: [`Saved: ${changes.join("; ") || "no changes"}.`, ...notes, openStrands()].join("\n"),
    detail: changes.join("; "),
  };
}

export function execIntakeDone(rec: ChatRecord, args: NonNullable<ChatRecord["intakeSummary"]>): ToolOutcome {
  const missing = coverage(getProfile()).filter((s) => s.critical && !s.done);
  if (missing.length) {
    return { isError: true, text: `Refused: required strands missing:\n${missing.map((s) => `- ${s.label}: ${s.hint}`).join("\n")}\nAsk about these first.` };
  }
  rec.intakeSummary = args;
  rec.phase = "plan";
  return { text: "Intake recorded. You are now the planner: design the plan (propose_plan), iterate until clean, then present it." };
}

export function summarizeWeek(w: WeekSchedule, goals: Goal[], blocks: BlockSpec[]): string {
  const wanted = blocks.reduce((s, b) => s + (b.days?.length || Math.min(7, Math.max(1, Math.round(b.timesPerWeek ?? 7)))), 0);
  const missing = w.unplaced.reduce((s, u) => s + (u.wanted - u.placed), 0);
  const title = new Map(goals.map((g) => [g.id, g.title]));
  const lines: string[] = [];
  lines.push(`Scheduler result for the week of ${w.start}: placed ${wanted - missing}/${wanted} block sessions.`);
  if (w.unplaced.length) {
    lines.push("UNPLACED:");
    for (const u of w.unplaced) lines.push(`- ${u.blockId} "${u.title}": placed ${u.placed}/${u.wanted}. ${u.reasons.join(" | ")}`);
  }
  const core = blocks.filter((b) => b.core).map((b) => b.id);
  const coreMissing = w.unplaced.filter((u) => core.includes(u.blockId)).map((u) => u.blockId);
  if (coreMissing.length) lines.push(`CORE blocks not fully placed: ${coreMissing.join(", ")}. Fix before presenting.`);
  lines.push(
    `Free (unallocated awake) time: ${fmtDuration(w.stats.freeMin)} = ${w.stats.freePct}% of awake time${w.stats.freePct < 15 ? " (BELOW the 15% slack target)" : ""}.`,
  );
  lines.push("Free per day: " + Object.entries(w.stats.freeByDay).map(([d, m]) => `${d.slice(5)} ${fmtDuration(m)}`).join(" · "));
  lines.push("Hours per goal: " + (Object.entries(w.stats.byGoal).map(([g, m]) => `${title.get(g) ?? g} ${fmtDuration(m)}`).join(" · ") || "none"));
  const goalless = goals.filter((g) => (g.status ?? "active") === "active" && g.horizon === "year" && !w.stats.byGoal[g.id] && !goals.some((c) => c.parentId === g.id && w.stats.byGoal[c.id]));
  if (goalless.length) lines.push(`Year goals with NO scheduled time: ${goalless.map((g) => g.id).join(", ")}.`);
  lines.push("Hours per category: " + Object.entries(w.stats.byCategory).filter(([c]) => c !== "sleep").map(([c, m]) => `${c} ${fmtDuration(m!)}`).join(" · "));
  if (w.warnings.length) lines.push("Warnings: " + w.warnings.join(" | "));
  lines.push("Layout:");
  for (const d of w.days) {
    const items = d.blocks.filter((b) => b.source !== "sleep").map((b) => `${fmt(b.start)}-${fmt(b.end)} ${b.title}${b.core ? "*" : ""}`);
    lines.push(`${d.day} ${d.date.slice(5)} (wake ${fmt(d.wake)}, bed ${fmt(d.bed)}): ${items.join(" | ")}`);
    if (d.warnings.length) lines.push(`  ! ${d.warnings.join(" | ")}`);
  }
  return lines.join("\n");
}

export function execProposePlan(rec: ChatRecord, toolCallId: string, args: { approach: string; goals: Goal[]; blocks: BlockSpec[] }): ToolOutcome {
  const profile = getProfile();
  const goals = (args.goals ?? []).map((g) => ({ ...g, status: g.status ?? "active" }));
  const blocks = (args.blocks ?? []).map((b) => ({ ...b, id: String(b.id ?? "").trim() }));
  const goalIds = [...new Set([...goals.map((g) => g.id), ...(profile.goals ?? []).map((g) => g.id)])];
  const errors = validateBlocks(blocks, (profile.fixed ?? []).map((f) => f.id), goalIds);
  if (!blocks.length) errors.push("No blocks.");
  if (errors.length) return { isError: true, text: `Plan rejected, fix and resend:\n- ${errors.join("\n- ")}` };

  const tz = profile.timezone || "UTC";
  const start = weekStartOf(nowIn(tz).date, profile.weekStart ?? "mon");
  const preview = buildWeek({ snapshot: snapshotOf(profile), plan: { version: 0, blocks } }, start);
  rec.proposal = { toolCallId, proposedAt: new Date().toISOString(), approach: args.approach ?? "", goals, blocks, preview };
  return { text: summarizeWeek(preview, goals, blocks) + "\n\n(The person sees this week and the goal tree beside your message once you present.)" };
}

export function execAddIfThen(args: { if: string; then: string; blockId?: string }): ToolOutcome {
  const p = getProfile();
  const item = { id: `it_${randomUUID().slice(0, 8)}`, if: args.if, then: args.then, blockId: args.blockId, createdAt: new Date().toISOString() };
  p.ifThen = [...(p.ifThen ?? []), item];
  saveProfile(p);
  return { text: `Saved if-then ${item.id}.`, detail: `If ${args.if}, then ${args.then}` };
}

export function execAddLesson(args: { text: string; evidence?: string }): ToolOutcome {
  const p = getProfile();
  p.lessons = [...(p.lessons ?? []), { id: `l_${randomUUID().slice(0, 8)}`, text: args.text, evidence: args.evidence, date: new Date().toISOString().slice(0, 10) }];
  saveProfile(p);
  return { text: "Lesson saved.", detail: args.text };
}
