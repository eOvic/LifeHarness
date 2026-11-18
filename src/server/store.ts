// Local-first storage: plain JSON files under DATA_DIR (default ./data), like LearnHarness.
// One server process owns the data directory. Writes go to a temp file and are renamed into place.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import { systemTimezone } from "../core/time";
import type { BlockSpec, Goal, Plan, Profile, Tracking, WeekSchedule } from "../core/types";

export const DATA_DIR = process.env.LIFEHARNESS_DATA_DIR || path.join(process.cwd(), "data");

function file(...p: string[]) {
  return path.join(/*turbopackIgnore: true*/ DATA_DIR, ...p);
}

export function readJson<T>(rel: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file(rel), "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Life data is private: files 0600, folders 0700 (readable by you only, whatever the umask).
let privateChecked = false;
function ensurePrivate() {
  if (privateChecked) return;
  privateChecked = true;
  for (const d of [DATA_DIR, file("chats")]) {
    try {
      if ((fs.statSync(/*turbopackIgnore: true*/ d).mode & 0o077) !== 0) fs.chmodSync(/*turbopackIgnore: true*/ d, 0o700);
    } catch {
      /* not created yet */
    }
  }
}

export function writeJson(rel: string, value: unknown) {
  const f = file(rel);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(f), { recursive: true, mode: 0o700 });
  ensurePrivate();
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
  fs.renameSync(/*turbopackIgnore: true*/ tmp, f);
}

// ---- settings ---------------------------------------------------------------------------
export interface Settings {
  /** "provider/modelId" */
  model?: string;
  reasoning?: "minimal" | "low" | "medium" | "high";
  /** Theme id (src/core/themes.ts) */
  theme?: string;
}
export const getSettings = () => readJson<Settings>("settings.json", {});
export const saveSettings = (s: Settings) => writeJson("settings.json", s);

// ---- profile (the life map) -------------------------------------------------------------
export function getProfile(): Profile {
  const p = readJson<Profile | null>("profile.json", null);
  return p ?? { timezone: systemTimezone() };
}
export const saveProfile = (p: Profile) => writeJson("profile.json", p);

// ---- plans (versioned; each adopted version applies from its adoption date) --------------
export const getPlans = () => readJson<Plan[]>("plans.json", []);
export const savePlans = (p: Plan[]) => writeJson("plans.json", p);
export function currentPlan(): Plan | null {
  const adopted = getPlans().filter((p) => p.adoptedAt);
  return adopted.length ? adopted[adopted.length - 1] : null;
}

// ---- tracking -------------------------------------------------------------------------------
export const getTracking = () => readJson<Tracking>("tracking.json", {});
export const saveTracking = (t: Tracking) => writeJson("tracking.json", t);

// ---- chats ------------------------------------------------------------------------------------
export type ChatKind = "onboarding" | "review" | "replan";
export type Phase = "intake" | "plan" | "review";

export interface AskQuestionArgs {
  question: string;
  why?: string;
  kind?: "single" | "multi" | "text";
  options?: { label: string; description?: string }[];
  askConfidence?: boolean;
  confidenceLabel?: string;
  placeholder?: string;
}

export interface QuestionAnswer {
  selected?: string[];
  other?: string;
  thinking?: string;
  confidence?: number;
  skipped?: boolean;
}

export interface Proposal {
  toolCallId: string;
  proposedAt: string;
  approach: string;
  goals: Goal[];
  blocks: BlockSpec[];
  preview: WeekSchedule;
  adoptedVersion?: number;
}

export interface ChatRecord {
  id: string;
  kind: ChatKind;
  title: string;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  /** The open ask_question call, waiting for the user's answer. */
  pending: { toolCallId: string; args: AskQuestionArgs } | null;
  questions: Record<string, AskQuestionArgs>;
  answers: Record<string, QuestionAnswer>;
  proposal: Proposal | null;
  intakeSummary?: { summary: string; strands?: { name: string; current?: string; target?: string; notes?: string }[]; risks?: string[] };
  usage: { cost: number; input: number; output: number; calls: number; billing?: "subscription" | "api" };
  /** The model of the latest call. */
  model?: { ref: string; name: string; provider: string };
  /** Friendly message + what the page should offer; the raw provider text is kept as detail. */
  lastError?: string;
  lastErrorAction?: "connect" | "retry";
  lastErrorDetail?: string;
}

export function newChat(kind: ChatKind): ChatRecord {
  const now = new Date().toISOString();
  const rec: ChatRecord = {
    id: `chat_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
    kind,
    title: kind === "onboarding" ? "Getting to know you" : kind === "review" ? "Weekly review" : "Re-plan",
    phase: kind === "review" ? "review" : kind === "replan" ? "plan" : "intake",
    createdAt: now,
    updatedAt: now,
    messages: [],
    pending: null,
    questions: {},
    answers: {},
    proposal: null,
    usage: { cost: 0, input: 0, output: 0, calls: 0 },
  };
  saveChat(rec);
  return rec;
}

export function getChat(id: string): ChatRecord | null {
  if (!/^chat_[a-z0-9_]+$/i.test(id)) return null;
  return readJson<ChatRecord | null>(`chats/${id}.json`, null);
}

export function saveChat(rec: ChatRecord) {
  rec.updatedAt = new Date().toISOString();
  writeJson(`chats/${rec.id}.json`, rec);
}

export interface ChatSummary extends Pick<ChatRecord, "id" | "kind" | "title" | "phase" | "createdAt" | "updatedAt"> {
  waiting: boolean; // an open question for the person
  proposal: "none" | "proposed" | "adopted";
  adoptedVersion?: number;
  questions: number;
}

export function listChats(): ChatSummary[] {
  const dir = file("chats");
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<ChatRecord | null>(`chats/${f}`, null))
    .filter((c): c is ChatRecord => !!c)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      phase: c.phase,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      waiting: !!c.pending,
      proposal: c.proposal ? (c.proposal.adoptedVersion ? ("adopted" as const) : ("proposed" as const)) : ("none" as const),
      adoptedVersion: c.proposal?.adoptedVersion,
      questions: Object.keys(c.questions ?? {}).length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteChat(id: string) {
  if (!/^chat_[a-z0-9_]+$/i.test(id)) return;
  fs.rmSync(/*turbopackIgnore: true*/ file("chats", `${id}.json`), { force: true });
}
