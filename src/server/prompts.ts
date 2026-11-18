// System prompt = base doctrine + phase doctrine + shared fragments + live context.
// Static text first (cache-friendly), the person's current state last.
import fs from "node:fs";
import path from "node:path";
import { coverageText } from "../core/profile";
import { reportText } from "../core/report";
import { fmt, nowIn } from "../core/time";
import type { Plan, Profile } from "../core/types";
import { weekReportFor, clock } from "./schedule";
import { currentPlan, getProfile, type ChatRecord, type Phase } from "./store";

const PROMPTS_DIR = process.env.LIFEHARNESS_PROMPTS_DIR || path.join(process.cwd(), "prompts");
const PHASE_FILE: Record<Phase, string> = { intake: "intake.md", plan: "planner.md", review: "review.md" };

function read(rel: string): string {
  return fs.readFileSync(path.join(/*turbopackIgnore: true*/ PROMPTS_DIR, rel), "utf8").trim();
}

function shared(): string[] {
  const dir = path.join(/*turbopackIgnore: true*/ PROMPTS_DIR, "shared");
  return fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => /^\d+-[\w.-]+\.md$/.test(f))
    .sort()
    .map((f) => read(`shared/${f}`));
}

export function doctrine(phase: Phase): string {
  return [read("base.md"), read(PHASE_FILE[phase]), ...shared()].join("\n\n---\n\n");
}

function planText(plan: Plan, tz: string): string {
  const at = plan.adoptedAt ? nowIn(tz, new Date(plan.adoptedAt)) : null;
  const adopted = at ? `${at.date} ${fmt(at.min)} (${tz})` : undefined;
  return JSON.stringify({ version: plan.version, adopted, approach: plan.approach, goals: plan.goals, blocks: plan.blocks }, null, 1);
}

export function liveContext(rec: ChatRecord, profile: Profile = getProfile()): string {
  const { tz, today, nowMin } = clock(profile);
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const { updatedAt: _u, ...map } = profile;
  const parts = [
    "# Current context",
    `Now: ${weekday} ${today}, ${fmt(nowMin)} (${tz}).`,
    `Session: ${rec.kind}, phase: ${rec.phase}.`,
    "## Life map (JSON)",
    "```json\n" + JSON.stringify(map, null, 1) + "\n```",
  ];
  if (rec.phase === "intake") parts.push("## Open strands", coverageText(profile));
  const plan = currentPlan();
  if (plan) parts.push(`## Adopted plan (v${plan.version})`, "```json\n" + planText(plan, tz) + "\n```");
  else parts.push("## Adopted plan", "None yet.");
  if (rec.intakeSummary && rec.phase !== "intake") parts.push("## Intake summary", JSON.stringify(rec.intakeSummary, null, 1));
  if (rec.phase === "review") {
    const r = weekReportFor();
    parts.push("## This week's tracking report", reportText(r));
  }
  return parts.join("\n\n");
}

export function systemPrompt(rec: ChatRecord): string {
  return `${doctrine(rec.phase)}\n\n---\n\n${liveContext(rec)}`;
}
