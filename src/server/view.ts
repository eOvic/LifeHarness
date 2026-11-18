// What the browser sees of a session: a flat list of display items, derived from the stored record.
// The stored record (native messages) is never sent as-is.
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { describeModelError } from "./errors";
import { TOOL_LABELS } from "./tools";
import type { AskQuestionArgs, ChatRecord, Proposal, QuestionAnswer } from "./store";

export type ViewItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "question"; id: string; args: AskQuestionArgs; answer?: QuestionAnswer; open: boolean }
  | { kind: "activity"; id: string; label: string; detail?: string; error?: boolean }
  | { kind: "divider"; id: string; label: string };

export interface ChatView {
  id: string;
  kind: ChatRecord["kind"];
  title: string;
  phase: ChatRecord["phase"];
  items: ViewItem[];
  pending: ChatRecord["pending"];
  proposal: Proposal | null;
  usage: ChatRecord["usage"];
  model?: ChatRecord["model"];
  lastError?: string;
  lastErrorAction?: ChatRecord["lastErrorAction"];
  lastErrorDetail?: string;
  canContinue: boolean;
  updatedAt: string;
}

/** Records written before friendly errors (raw provider text only) get mapped on the way out. */
function lastErrorView(rec: ChatRecord): Pick<ChatView, "lastError" | "lastErrorAction" | "lastErrorDetail"> {
  if (!rec.lastError) return {};
  if (rec.lastErrorAction) return { lastError: rec.lastError, lastErrorAction: rec.lastErrorAction, lastErrorDetail: rec.lastErrorDetail };
  // 0.1.0 shipped an incomplete engine; its sessions stopped on "Cannot find module". Fixed since.
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(rec.lastError)) {
    return { lastError: "This session stopped on an install problem that this version fixes. Retry to continue.", lastErrorAction: "retry", lastErrorDetail: rec.lastError };
  }
  const f = describeModelError(rec.lastError, rec.model?.provider);
  return { lastError: f.message, lastErrorAction: f.action, lastErrorDetail: f.message === rec.lastError ? undefined : rec.lastError };
}

export function chatView(rec: ChatRecord): ChatView {
  const items: ViewItem[] = [];
  const results = new Map<string, ToolResultMessage>();
  for (const m of rec.messages) if (m.role === "toolResult") results.set(m.toolCallId, m as ToolResultMessage);

  rec.messages.forEach((m, i) => {
    if (m.role === "user") {
      const text = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      if (!text.startsWith("[[")) items.push({ kind: "user", id: `u${i}`, text });
      return;
    }
    if (m.role !== "assistant") return;
    const a = m as AssistantMessage;
    a.content.forEach((c, j) => {
      const id = `a${i}_${j}`;
      if (c.type === "text" && c.text.trim()) items.push({ kind: "assistant", id, text: c.text });
      if (c.type !== "toolCall") return;
      const res = results.get(c.id);
      if (c.name === "ask_question") {
        const args = rec.questions[c.id];
        if (!args || res?.isError) return;
        items.push({ kind: "question", id: c.id, args, answer: rec.answers[c.id], open: rec.pending?.toolCallId === c.id });
        return;
      }
      if (c.name === "intake_done" && res && !res.isError) {
        items.push({ kind: "divider", id, label: "Interview complete · planning" });
        return;
      }
      if (!res) return;
      const text = res.content.map((x) => (x.type === "text" ? x.text : "")).join("");
      if (res.isError) {
        items.push({ kind: "activity", id, label: `${TOOL_LABELS[c.name] ?? c.name} (retrying)`, detail: text.slice(0, 400), error: true });
        return;
      }
      let detail: string | undefined;
      if (c.name === "update_profile") detail = text.split("\n")[0].replace(/^Saved: /, "");
      if (c.name === "propose_plan") detail = text.split("\n").slice(0, 3).join(" ");
      if (c.name === "add_if_then") {
        const args = c.arguments as { if?: string; then?: string };
        detail = `If ${args.if}, then ${args.then}`;
      }
      if (c.name === "add_lesson") detail = String((c.arguments as { text?: string }).text ?? "");
      items.push({ kind: "activity", id, label: TOOL_LABELS[c.name] ?? c.name, detail });
    });
  });

  const last = rec.messages[rec.messages.length - 1];
  const canContinue = !rec.pending && !!last && (last.role !== "assistant" || ["error", "aborted"].includes((last as AssistantMessage).stopReason));
  return {
    id: rec.id,
    kind: rec.kind,
    title: rec.title,
    phase: rec.phase,
    items,
    pending: rec.pending,
    proposal: rec.proposal,
    usage: rec.usage,
    model: rec.model,
    ...lastErrorView(rec),
    canContinue,
    updatedAt: rec.updatedAt,
  };
}
