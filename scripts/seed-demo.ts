// Deterministic demo data (no model calls): a persona's profile, an adopted plan with a few days of
// tracking, and a finished onboarding session. For screenshots, UI testing and desktop QA.
//   npx tsx scripts/seed-demo.ts <data-dir> [--adopted-days-ago 3] [--theme paper] [--scene week|interview]
// --scene interview: an interview in progress (two answers, one open question), no plan yet.
import fs from "node:fs";
import path from "node:path";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { mergeProfile, snapshotOf } from "../src/core/profile";
import { buildWeek } from "../src/core/scheduler";
import { addDays, nowIn, weekStartOf } from "../src/core/time";
import type { BlockSpec, Goal, Plan, Profile, Tracking } from "../src/core/types";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: tsx scripts/seed-demo.ts <data-dir> [--adopted-days-ago N] [--theme id]");
  process.exit(1);
}
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const agoDays = Number(flag("--adopted-days-ago") ?? 3);
const theme = flag("--theme");
const scene = flag("--scene") ?? "week";

const tz = "Africa/Cairo";
const now = new Date();
const today = nowIn(tz, now).date;
const at = (daysAgo: number, hh = 8) => new Date(now.getTime() - daysAgo * 86400000 - (now.getUTCHours() - hh) * 3600000).toISOString();

// A fictional persona. (Keep demo data invented: screenshots of it end up in the README.)
const goals: Goal[] = [
  { id: "board-exam", horizon: "year", title: "Pass the clinical pharmacy board exam", measure: "Pass on the first attempt", deadline: "2027-06-15", why: "Mastery: be the pharmacist doctors trust", area: "career", kind: "outcome", confidence: 75, status: "active" },
  { id: "quran-daily", horizon: "year", title: "Read Quran every morning", measure: "15 minutes after Fajr, 6 days a week", why: "Faith first, before the day takes over", area: "faith", kind: "habit", confidence: 85, status: "active" },
  { id: "run-10k", horizon: "quarter", title: "Run a 10K", measure: "10 km under 60 minutes", deadline: "2027-02-28", why: "Energy for long shifts", area: "health", kind: "outcome", confidence: 65, status: "active" },
  { id: "french", horizon: "year", title: "Learn French to A2", area: "learning", kind: "habit", confidence: 50, status: "paused" },
  { id: "podcast", horizon: "year", title: "Start a pharmacy podcast", area: "creative", kind: "outcome", confidence: 40, status: "paused" },
];

const base: Profile = {
  name: "Amira",
  about: "Hospital pharmacist; studying for the clinical board exam on the side.",
  timezone: tz,
  location: { city: "Cairo", country: "Egypt", lat: 30.04, lon: 31.24 },
  weekStart: "sat",
  values: [
    { name: "Faith", why: "Prayer keeps the day honest" },
    { name: "Mastery", why: "Patients depend on getting it right" },
    { name: "Family", why: "Dinner with my parents most nights" },
  ],
  vision: "A calm, competent pharmacist: board-certified, fit, and present with family in the evenings.",
  goalsConfirmed: true,
  sleep: { bed: "22:15", wake: "04:30" },
  fixed: [{ id: "shift", title: "Hospital shift", days: ["sun", "mon", "tue", "wed", "thu"], start: "08:00", end: "16:00", category: "work", travelMin: 30 }],
  fixedConfirmed: true,
  energy: { chronotype: "morning", peak: { start: "05:00", end: "08:00" }, focusMaxMin: 75 },
  obstacles: ["Scrolling in bed after a long shift pushes sleep late, and then the morning study session dies"],
  history: ["Studied for the board last spring in evenings after work: kept it up 2 weeks"],
  faith: { enabled: true, prayers: { method: "Egyptian", madhab: "shafi", jumuah: true } },
};

const blocks: BlockSpec[] = [
  { id: "quran-morning", title: "Quran reading", category: "faith", goalId: "quran-daily", durationMin: 20, after: { ref: "fajr", gapMin: 0 }, core: true, priority: 1, ifThen: "If Fajr is done, then I stay on the prayer mat and read for 15 minutes." },
  { id: "board-study", title: "Board exam study", category: "deep", goalId: "board-exam", durationMin: 60, days: ["sun", "mon", "tue", "wed", "thu"], after: { ref: "block:quran-morning", gapMin: 5 }, window: "peak", core: true, priority: 1, ifThen: "If the Quran reading is done and the kettle is on, then I open the question bank at yesterday's chapter." },
  { id: "board-long", title: "Board exam: long session", category: "deep", goalId: "board-exam", durationMin: 120, days: ["fri", "sat"], window: "morning", priority: 1 },
  { id: "run", title: "Run", category: "health", goalId: "run-10k", durationMin: 45, days: ["sat", "mon", "wed"], after: { ref: "isha", gapMin: 10 }, priority: 2 },
  { id: "family-dinner", title: "Dinner with family", category: "relationships", durationMin: 60, after: { ref: "maghrib", gapMin: 0 }, before: { ref: "isha" }, fill: true, priority: 2 },
  { id: "weekly-review", title: "Weekly review", category: "admin", durationMin: 40, days: ["fri"], earliest: "15:00", latest: "18:00", priority: 2 },
];

const { profile } = mergeProfile(base, { goals });
const adoptedAt = at(agoDays, 9);
const plan: Plan = {
  version: 1,
  createdAt: adoptedAt,
  adoptedAt,
  approach:
    "Your week protects the one window that's really yours: the early morning. Quran right after Fajr, then an hour on the question bank before the shift, every workday, plus two long sessions on the weekend.\n\nPrayers during the shift stay as short breaks inside it. Runs go after Isha three times a week, when the air is cooler. French and the podcast are **parked** until the board exam is done.",
  goals,
  blocks,
  snapshot: snapshotOf(profile),
  chatId: "chat_demo_onboarding",
};

// Tracking: every tracked block on the days since adoption, before now (a realistic mix).
const tracking: Tracking = {};
const nowMin = nowIn(tz, now).min;
const pattern = ["done", "done", "half", "done", "skip", "done"] as const;
let k = 0;
for (let d = agoDays; d >= 0; d--) {
  const date = addDays(today, -d);
  const week = buildWeek({ snapshot: plan.snapshot!, plan }, weekStartOf(date, profile.weekStart));
  const day = week.days.find((x) => x.date === date);
  if (!day) continue;
  for (const b of day.blocks) {
    if (!b.tracked || (d === 0 && b.end > nowMin)) continue;
    const status = pattern[k++ % pattern.length];
    (tracking[date] ??= {})[b.key] = { status, at: adoptedAt, title: b.title, core: b.core, category: b.category };
  }
}

// A finished onboarding session (abridged transcript) with the adopted proposal.
const ts = Date.parse(adoptedAt) - 3600000;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const asst = (content: AssistantMessage["content"], i: number): AssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "demo",
  model: "demo",
  usage,
  stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
  timestamp: ts + i * 60000,
});
const result = (id: string, name: string, text: string, i: number): ToolResultMessage => ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false, timestamp: ts + i * 60000 });
const user = (text: string, i: number): UserMessage => ({ role: "user", content: text, timestamp: ts + i * 60000 });

const q1 = { question: "What would make this year a success, looking back next December?", kind: "multi" as const, options: [{ label: "Board exam passed" }, { label: "A daily Quran habit" }, { label: "Running again" }, { label: "Learning French" }], askConfidence: false };
const q2 = { question: "When do you do your best thinking?", kind: "single" as const, options: [{ label: "Early morning, before work" }, { label: "During breaks at work" }, { label: "Evening" }, { label: "Late night" }], askConfidence: true, confidenceLabel: "How sure are you?" };
const preview = buildWeek({ snapshot: snapshotOf(profile), plan: { version: 0, blocks } }, weekStartOf(today, profile.weekStart));
const messages: Message[] = [
  user("[[session start: onboarding]]", 0),
  asst([{ type: "text", text: "Welcome, Amira. This is a focused interview of about 15 questions, then a plan for your week you can adopt." }, { type: "toolCall", id: "q1", name: "ask_question", arguments: q1 }], 1),
  result("q1", "ask_question", "Answer: Board exam passed; A daily Quran habit; Running again", 2),
  asst([{ type: "toolCall", id: "q2", name: "ask_question", arguments: q2 }], 3),
  result("q2", "ask_question", "Answer: Early morning, before work (confidence 85)", 4),
  asst([{ type: "toolCall", id: "done1", name: "intake_done", arguments: { summary: "Morning person on a fixed 8-to-4 shift; three active goals; protect the early mornings." } }], 5),
  result("done1", "intake_done", "Intake recorded.", 6),
  asst([{ type: "toolCall", id: "plan1", name: "propose_plan", arguments: { approach: plan.approach } }], 7),
  result("plan1", "propose_plan", "Week: 6 blocks placed, 0 not placed.", 8),
  asst([{ type: "text", text: `## Your week is ready\n\n${plan.approach}\n\n**Adopt this plan** when you're ready, or tell me what to change.` }], 9),
];
const chat = {
  id: "chat_demo_onboarding",
  kind: "onboarding",
  title: "Getting to know you",
  phase: "plan",
  createdAt: new Date(ts).toISOString(),
  updatedAt: adoptedAt,
  messages,
  pending: null,
  questions: { q1, q2 },
  answers: { q1: { selected: ["Board exam passed", "A daily Quran habit", "Running again"] }, q2: { selected: ["Early morning, before work"], confidence: 85 } },
  proposal: { toolCallId: "plan1", proposedAt: adoptedAt, approach: plan.approach, goals, blocks, preview, adoptedVersion: 1 },
  usage: { cost: 0, input: 0, output: 0, calls: 0 },
};

fs.mkdirSync(path.join(dir, "chats"), { recursive: true });
const write = (rel: string, v: unknown) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(v, null, 1));
if (scene === "interview") {
  const qa = { question: "What's going on in your life right now, and what made you want to try this?", kind: "text" as const, placeholder: "A few sentences is plenty" };
  const qb = { question: "What matters most to you in how you spend your life? Pick up to three.", why: "Goals get more sustained effort when they connect to your own values.", kind: "multi" as const, options: [{ label: "Faith" }, { label: "Health" }, { label: "Mastery at work" }, { label: "Family" }, { label: "Freedom" }] };
  const qc = {
    question: "When do you do your best focused work?",
    why: "Your hardest goal gets your best hours.",
    kind: "single" as const,
    options: [{ label: "Early morning, before work", description: "05:00–08:00" }, { label: "Late morning", description: "on days off" }, { label: "After work", description: "17:00–20:00" }, { label: "Late at night", description: "after 22:00" }],
    askConfidence: true,
    confidenceLabel: "How sure are you?",
  };
  const t0 = Date.now() - 20 * 60000;
  const say = (content: AssistantMessage["content"], i: number): AssistantMessage => ({ ...asst(content, i), timestamp: t0 + i * 60000 });
  const interview = {
    id: "chat_demo_interview",
    kind: "onboarding",
    title: "Getting to know you",
    phase: "intake",
    createdAt: new Date(t0).toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      user("[[session start: onboarding]]", 0),
      say([{ type: "text", text: "Welcome. I'll ask about 15 questions, one at a time, then build a week that fits your real life." }, { type: "toolCall", id: "qa", name: "ask_question", arguments: qa }], 1),
      { ...result("qa", "ask_question", "Answer: hospital pharmacist, board exam this year, wants to run again", 2), timestamp: t0 + 120000 },
      say([{ type: "toolCall", id: "qb", name: "ask_question", arguments: qb }], 3),
      { ...result("qb", "ask_question", "Answer: Faith; Mastery at work; Family", 4), timestamp: t0 + 240000 },
      say([{ type: "toolCall", id: "qc", name: "ask_question", arguments: qc }], 5),
    ],
    pending: { toolCallId: "qc", args: qc },
    questions: { qa, qb, qc },
    answers: {
      qa: { other: "I'm a hospital pharmacist. I want to pass my board exam this year, get back to running, and stop losing my evenings to my phone." },
      qb: { selected: ["Faith", "Mastery at work", "Family"], thinking: "Family is the one I keep sacrificing." },
    },
    proposal: null,
    usage: { cost: 0, input: 0, output: 0, calls: 3, billing: "subscription" },
  };
  write("profile.json", { name: "Amira", timezone: tz, values: base.values, vision: base.vision, about: base.about });
  write(`chats/${interview.id}.json`, interview);
  if (theme) write("settings.json", { theme });
  console.log(`seeded ${dir}: an interview in progress (chat_demo_interview)`);
  process.exit(0);
}
write("profile.json", profile);
write("plans.json", [plan]);
write("tracking.json", tracking);
write("chats/chat_demo_onboarding.json", chat);
if (theme) write("settings.json", { theme });
const marks = Object.values(tracking).reduce((n, d) => n + Object.keys(d).length, 0);
console.log(`seeded ${dir}: plan v1 adopted ${agoDays}d ago, ${marks} marks, 1 session`);
