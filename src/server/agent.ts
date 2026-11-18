// The agent loop. One "turn" = the person's input, then model calls until the agent asks a
// question (ask_question pauses the turn; the answer becomes that call's result) or stops talking.
// Server tools (update_profile, propose_plan, ...) execute immediately. intake_done hands the
// same conversation over from the interviewer to the planner (like LearnHarness's prober -> teacher).
import { validateToolCall, type Api, type AssistantMessage, type Message, type Model, type ToolCall, type ToolResultMessage } from "@earendil-works/pi-ai";
import { describeModelError, type ErrorAction } from "./errors";
import type { StreamFn } from "./llm";
import { systemPrompt } from "./prompts";
import { getChat, saveChat, type AskQuestionArgs, type ChatRecord, type QuestionAnswer } from "./store";
import {
  PHASE_TOOLS,
  TOOL_LABELS,
  TOOLS,
  execAddIfThen,
  execAddLesson,
  execIntakeDone,
  execProposePlan,
  execUpdateProfile,
  type ToolOutcome,
} from "./tools";
import { chatView, type ChatView } from "./view";

export type TurnInput =
  | { type: "start" }
  | { type: "continue" }
  | { type: "message"; text: string }
  | { type: "answer"; toolCallId: string; answer: QuestionAnswer };

export type TurnEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string }
  | { type: "chat"; chat: ChatView }
  | { type: "error"; message: string; action?: ErrorAction }
  | { type: "done" };

export interface AgentDeps {
  stream: StreamFn;
  model: Model<Api>;
  reasoning?: "minimal" | "low" | "medium" | "high";
  maxCalls?: number;
  /** For error messages ("OpenAI rejected…") and the cost label. */
  providerName?: string;
  /** Calls are covered by a subscription: the dollar figure is only an estimate at API prices. */
  subscription?: boolean;
}

export class TurnError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const g = globalThis as unknown as { __lhBusy?: Set<string> };
const busy = (g.__lhBusy ??= new Set<string>());

export function isBusy(chatId: string) {
  return busy.has(chatId);
}

const START: Record<ChatRecord["kind"], string> = {
  onboarding:
    "[[session start: onboarding]] The person just opened LifeHarness for the first time. Greet them in two short sentences (a focused interview of about 15 questions, then a plan for their week they can adopt), then ask your first question.",
  review: "[[session start: weekly review]] The person started their weekly review. The tracking report is in your context. Begin.",
  replan: "[[session start: re-plan]] The person wants to change their plan. Find out what changed or isn't working (one question), then revise.",
};

export function formatAnswer(a: QuestionAnswer): string {
  if (a.skipped) return "The person skipped this question.";
  const lines: string[] = [];
  if (a.selected?.length) lines.push(`Selected: ${a.selected.map((s) => `"${s}"`).join(", ")}`);
  if (a.other?.trim()) lines.push(`Other (their words): ${a.other.trim()}`);
  if (a.thinking?.trim()) lines.push(`Thinking: ${a.thinking.trim()}`);
  if (typeof a.confidence === "number") lines.push(`Confidence: ${a.confidence}%`);
  return lines.join("\n") || "(empty answer)";
}

function toolResult(call: Pick<ToolCall, "id" | "name">, text: string, isError = false): ToolResultMessage {
  return { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text }], isError, timestamp: Date.now() };
}

function applyInput(rec: ChatRecord, input: TurnInput) {
  const now = Date.now();
  if (input.type === "start") {
    if (rec.messages.length) throw new TurnError("Session already started", 409);
    rec.messages.push({ role: "user", content: START[rec.kind], timestamp: now });
    return;
  }
  if (input.type === "continue") {
    // Drop a failed trailing reply so the model can try again from the last good state.
    while (rec.messages.length) {
      const last = rec.messages[rec.messages.length - 1] as AssistantMessage;
      if (last.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) rec.messages.pop();
      else break;
    }
    const last = rec.messages[rec.messages.length - 1];
    if (!last || last.role === "assistant") throw new TurnError("Nothing to continue", 409);
    rec.lastError = undefined;
    rec.lastErrorAction = undefined;
    rec.lastErrorDetail = undefined;
    return;
  }
  if (rec.pending) {
    const pend = rec.pending;
    let answer: QuestionAnswer;
    if (input.type === "answer") {
      if (input.toolCallId !== pend.toolCallId) throw new TurnError("That question is no longer open", 409);
      answer = input.answer;
    } else {
      answer = { other: input.text }; // typed instead of using the dock: treat as the answer
    }
    rec.answers[pend.toolCallId] = answer;
    rec.messages.push(toolResult({ id: pend.toolCallId, name: "ask_question" }, formatAnswer(answer)));
    rec.pending = null;
    return;
  }
  if (input.type === "answer") throw new TurnError("No open question", 409);
  if (!input.text.trim()) throw new TurnError("Empty message");
  rec.messages.push({ role: "user", content: input.text.trim(), timestamp: now });
}

async function execute(rec: ChatRecord, call: ToolCall, args: Record<string, unknown>): Promise<ToolOutcome> {
  switch (call.name) {
    case "update_profile":
      return execUpdateProfile(args);
    case "intake_done":
      return execIntakeDone(rec, args as never);
    case "propose_plan":
      return execProposePlan(rec, call.id, args as never);
    case "add_if_then":
      return execAddIfThen(args as never);
    case "add_lesson":
      return execAddLesson(args as never);
    default:
      return { isError: true, text: `Unknown tool ${call.name}` };
  }
}

export async function runTurn(chatId: string, input: TurnInput, emit: (e: TurnEvent) => void, deps: AgentDeps): Promise<ChatRecord> {
  if (busy.has(chatId)) throw new TurnError("A turn is already running for this session", 409);
  const rec = getChat(chatId);
  if (!rec) throw new TurnError("Session not found", 404);
  busy.add(chatId);
  try {
    applyInput(rec, input);
    saveChat(rec);
    const maxCalls = deps.maxCalls ?? 14;

    for (let call = 0; call < maxCalls; call++) {
      const allowed = PHASE_TOOLS[rec.phase];
      const context = { systemPrompt: systemPrompt(rec), messages: rec.messages as Message[], tools: allowed.map((n) => TOOLS[n]) };
      emit({ type: "status", text: call === 0 ? "Thinking…" : "Continuing…" });
      const s = deps.stream(deps.model, context, { reasoning: deps.reasoning ?? "medium" });
      let thinkingAnnounced = false;
      for await (const ev of s) {
        if (ev.type === "text_delta") emit({ type: "text", delta: ev.delta });
        else if (ev.type === "thinking_start" && !thinkingAnnounced) {
          thinkingAnnounced = true;
          emit({ type: "status", text: "Thinking…" });
        } else if (ev.type === "toolcall_end" && ev.toolCall.name !== "ask_question") {
          emit({ type: "status", text: `${TOOL_LABELS[ev.toolCall.name] ?? ev.toolCall.name}…` });
        }
      }
      const msg = await s.result();
      rec.messages.push(msg);
      rec.usage = {
        cost: rec.usage.cost + (msg.usage?.cost?.total ?? 0),
        input: rec.usage.input + (msg.usage?.input ?? 0),
        output: rec.usage.output + (msg.usage?.output ?? 0),
        calls: rec.usage.calls + 1,
        billing: deps.subscription ? "subscription" : "api",
      };
      rec.model = { ref: `${deps.model.provider}/${deps.model.id}`, name: deps.model.name, provider: deps.providerName ?? deps.model.provider };
      if (msg.stopReason === "error" || msg.stopReason === "aborted") {
        const raw = msg.errorMessage || "The model request failed.";
        const f = describeModelError(raw, deps.providerName);
        rec.lastError = f.message;
        rec.lastErrorAction = f.action;
        rec.lastErrorDetail = raw === f.message ? undefined : raw;
        saveChat(rec);
        emit({ type: "error", message: f.message, action: f.action });
        break;
      }

      const calls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
      if (!calls.length) {
        saveChat(rec);
        break;
      }
      let asked = false;
      for (const c of calls) {
        const tool = TOOLS[c.name];
        if (!tool || !allowed.includes(c.name)) {
          rec.messages.push(toolResult(c, `Tool "${c.name}" is not available in the ${rec.phase} phase.`, true));
          continue;
        }
        let args: Record<string, unknown>;
        try {
          args = validateToolCall([tool], c);
        } catch (e) {
          rec.messages.push(toolResult(c, `Invalid arguments: ${(e as Error).message}`, true));
          continue;
        }
        if (c.name === "ask_question") {
          if (asked) {
            rec.messages.push(toolResult(c, "Not shown: only ONE question per turn. Ask it next turn if still needed.", true));
            continue;
          }
          const q = args as unknown as AskQuestionArgs;
          if ((q.kind ?? "single") !== "text" && !(q.options?.length)) q.kind = "text";
          asked = true;
          rec.pending = { toolCallId: c.id, args: q };
          rec.questions[c.id] = q;
          continue;
        }
        let out: ToolOutcome;
        try {
          out = await execute(rec, c, args);
        } catch (e) {
          out = { isError: true, text: `Tool failed: ${(e as Error).message}` };
        }
        rec.messages.push(toolResult(c, out.text, !!out.isError));
        if (!out.isError) emit({ type: "tool", name: c.name, label: TOOL_LABELS[c.name] ?? c.name });
      }
      // The open question's result is appended later, when they answer (see applyInput).
      saveChat(rec);
      emit({ type: "chat", chat: chatView(rec) });
      if (asked) break;
    }
    emit({ type: "chat", chat: chatView(rec) });
    return rec;
  } finally {
    busy.delete(chatId);
    emit({ type: "done" });
  }
}
