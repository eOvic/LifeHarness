// Claude through Claude Code (Anthropic's own app), as a model provider.
//
// Anthropic doesn't allow third-party apps to offer Claude.ai sign-in or to handle Claude plan
// credentials, but it allows a product to run the unmodified Claude Code binary that the person
// signed into themselves (code.claude.com/docs/en/legal-and-compliance). So Claude Code owns sign-in,
// routing, model access and billing; LifeHarness never sees a Claude password or token and doesn't
// guarantee plan-only use (an API key in your environment, for example, is Claude Code's to use).
//
// Design and parts of the code are adapted from LearnHarness's Claude Code provider
// (src/agent/claude-code/ in https://github.com/amosblomqvist/learnharness, by Amos Blomqvist,
// AGPL-3.0-only, the same license as LifeHarness):
//   - Installation status is the version only: no auth-status command, no account details, no
//     credential files, no model call.
//   - Each process runs without a shell in an empty temporary folder, with our system prompt
//     (--system-prompt-file), no built-in tools (--tools ""), no slash commands, no session history,
//     no permission prompts, hooks off, CLAUDE.md memory off and the default output style. Your own
//     user settings still load, so Claude Code's sign-in and routing work as you configured them.
//   - LifeHarness's tools are pre-approved MCP tools on a private, token-protected loopback bridge
//     (claude-code-bridge.ts). A streamed tool call is only an intent: it runs when the matching
//     authenticated MCP call arrives (same tool-use id, name and arguments), never from stdout alone.
//   - The bridge holds each call until LifeHarness has the result (even a person's answer), and the
//     process stays alive meanwhile, so the conversation continues natively. After 10 idle minutes,
//     a restart or any change of model/prompt/tools/environment, the next call starts a fresh
//     process that replays the history as labelled text.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { isDeepStrictEqual } from "node:util";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { BRIDGE_NAME, createToolBridge, MCP_PREFIX, type BridgeCall, type ToolBridge } from "./claude-code-bridge";
import { makeRunDir } from "./claude-runs";
import { isWindows } from "./platform";
import { LIVE_CONTEXT_MARKER } from "./prompts";

export const CLAUDE_CODE = "claude-code"; // provider id
export const MINIMUM_VERSION = "2.1.259"; // --permission-prompts none, the claudecode/toolUseId meta
export const IDLE_MS = { current: 10 * 60_000 }; // a held process lives this long without a reply
const TOOL_TIMEOUT_MS = 30 * 60_000; // Claude Code's own MCP wait: headroom above IDLE_MS

export const NOT_SIGNED_IN = "Claude Code isn't signed in. In a terminal, run: claude auth login (Anthropic's own sign-in), then retry.";
export const NOT_INSTALLED = "Claude Code isn't installed on this computer, or LifeHarness can't find it. Install it, then connect it again in Settings → AI models.";

// ---- installation: the version, nothing else -------------------------------------------------
export interface ClaudeCodeStatus {
  state: "not-found" | "ok" | "update-required" | "unchecked";
  version: string | null;
  minimumVersion: string;
  /** The setup steps differ on Windows (PowerShell install command). */
  windows?: boolean;
}

/** How to start Claude Code: the program, arguments that go before Claude Code's own, extra environment. */
export interface ClaudeCommand {
  file: string;
  pre: string[];
  env?: Record<string, string>;
}

const unquote = (dir: string) => dir.replace(/^"(.*)"$/, "$1"); // Windows PATH entries may be quoted
const pathDirs = () => (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map(unquote);
const isFile = (p: string) => {
  try {
    return fs.statSync(/*turbopackIgnore: true*/ p).isFile();
  } catch {
    return false;
  }
};

// Found and fixed on a Windows PC: Claude Code is claude.exe there (Anthropic's installer, WinGet,
// Scoop, Bun) or an npm/pnpm/yarn claude.cmd shim. No shell is ever used, so a shim is resolved to the
// program it starts (resolveShim) instead of being run through cmd.exe.
export function findClaude(): ClaudeCommand | undefined {
  const home = os.homedir();
  const win = isWindows();
  const names = win ? ["claude.exe", "claude.cmd"] : ["claude"];
  const npmPrefix = process.env.npm_config_prefix;
  const known = win
    ? [
        path.join(home, ".local", "bin"), // Anthropic's installer (PowerShell)
        path.join(home, ".claude", "local"),
        npmPrefix || path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"), // npm i -g
        path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Microsoft", "WinGet", "Links"),
        path.join(home, "scoop", "shims"),
        path.join(home, ".bun", "bin"),
      ]
    : [
        path.join(home, ".local", "bin"),
        path.join(home, ".claude", "local"),
        npmPrefix ? path.join(npmPrefix, "bin") : path.join(home, ".npm-global", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        path.join(home, ".nix-profile", "bin"),
        ...(process.env.USER ? [path.join("/etc/profiles/per-user", process.env.USER, "bin")] : []),
      ];
  const candidates = process.env.LIFEHARNESS_CLAUDE_BIN
    ? [process.env.LIFEHARNESS_CLAUDE_BIN]
    : [...pathDirs(), ...known].flatMap((d) => names.map((n) => path.resolve(/*turbopackIgnore: true*/ d, n)));
  for (const c of candidates) {
    try {
      fs.accessSync(/*turbopackIgnore: true*/ c, fs.constants.X_OK);
      if (!fs.statSync(/*turbopackIgnore: true*/ c).isFile()) continue;
      const cmd = win && /\.(cmd|bat)$/i.test(c) ? resolveShim(c) : { file: c, pre: [] };
      if (cmd) return cmd;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

/** npm, pnpm and yarn shims (cmd-shim) end in `"%dp0%\<target>" %*`: run that target directly. Going
 *  through cmd.exe would mangle the JSON arguments, and stopping cmd.exe would leave Claude Code running. */
function resolveShim(shim: string, depth = 0): ClaudeCommand | undefined {
  try {
    const text = fs.readFileSync(/*turbopackIgnore: true*/ shim, "utf8");
    const targets = [...text.matchAll(/"%(?:~dp0|dp0%)\\?([^"%]+)"/g)].map((m) => m[1]).filter((t) => !/(^|\\)node(\.exe)?$/i.test(t));
    if (!targets.length) return undefined;
    // The shim writes the path with backslashes: rebuild it with this OS's separator.
    const target = path.join(/*turbopackIgnore: true*/ path.dirname(shim), ...targets[targets.length - 1].split(/[\\/]+/));
    if (!isFile(target)) return undefined;
    if (/\.exe$/i.test(target)) return { file: target, pre: [] };
    if (/\.(cmd|bat)$/i.test(target)) return depth < 3 ? resolveShim(target, depth + 1) : undefined; // yarn: shim -> shim
    if (!/\.[cm]?js$/i.test(target)) return undefined;
    // Claude Code as JavaScript: run it on Node (beside the shim or on PATH), else on the Node built into LifeHarness.
    const node = [path.dirname(shim), ...pathDirs()].map((d) => path.join(/*turbopackIgnore: true*/ d, "node.exe")).find(isFile);
    return node ? { file: node, pre: [target] } : { file: process.execPath, pre: [target], env: { ELECTRON_RUN_AS_NODE: "1" } };
  } catch {
    return undefined;
  }
}

const atLeast = (v: number[], min: number[]) => {
  const i = v.findIndex((p, k) => p !== min[k]);
  return i === -1 || v[i] > min[i];
};

const g = globalThis as unknown as { __lhClaudeStatus?: ClaudeCodeStatus & { at: number } };

export async function claudeCodeStatus(force = false): Promise<ClaudeCodeStatus> {
  const cached = g.__lhClaudeStatus;
  if (!force && cached && Date.now() - cached.at < 60_000) return cached;
  const base = { version: null, minimumVersion: MINIMUM_VERSION };
  let status: ClaudeCodeStatus = { ...base, state: "not-found" };
  const cmd = findClaude();
  if (cmd) {
    status = { ...base, state: "unchecked" };
    try {
      const out = await new Promise<string>((resolve, reject) =>
        execFile(/*turbopackIgnore: true*/ cmd.file, [...cmd.pre, "--version"], { cwd: os.tmpdir(), env: { ...childEnv(), ...cmd.env }, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 4096, windowsHide: true }, (e, so) =>
          e ? reject(e) : resolve(String(so)),
        ),
      );
      // Keep only a version: never arbitrary CLI output or a path.
      const m = /^(\d+)\.(\d+)\.(\d+)(?: \(Claude Code\))?$/.exec(out.trim());
      if (m) {
        const v = m.slice(1).map(Number);
        status = { ...base, version: v.join("."), state: atLeast(v, MINIMUM_VERSION.split(".").map(Number)) ? "ok" : "update-required" };
      }
    } catch {
      /* unchecked */
    }
  }
  g.__lhClaudeStatus = { ...status, at: Date.now() };
  return status;
}

// ---- models ------------------------------------------------------------------------------------
const MODELS = [
  { id: "sonnet", name: "Claude Sonnet" },
  { id: "opus", name: "Claude Opus" },
  { id: "haiku", name: "Claude Haiku" },
];

export function claudeCodeModels(): Model<Api>[] {
  // Aliases, not pinned versions. Zero rates are placeholders: Claude Code decides billing.
  return MODELS.map(
    (m) =>
      ({
        ...m,
        api: "claude-code-cli",
        provider: CLAUDE_CODE,
        baseUrl: "",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 32_000,
      }) as unknown as Model<Api>,
  );
}

// ---- launch ------------------------------------------------------------------------------------
/** Claude Code's environment: yours, minus what LifeHarness itself put there. */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LIFEHARNESS_API_SECRET; // the desktop app's own request secret
  delete env.ELECTRON_RUN_AS_NODE; // how the desktop app runs this server
  env.MCP_TOOL_TIMEOUT = String(TOOL_TIMEOUT_MS);
  env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = String(TOOL_TIMEOUT_MS);
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  return env;
}

export function launchArgs(o: { model: string; effort: string; systemPromptFile: string; mcpConfigFile: string; allowedTools: string[] }): string[] {
  return [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", o.model,
    "--effort", o.effort,
    "--system-prompt-file", o.systemPromptFile,
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", o.mcpConfigFile,
    // Your sign-in and routing settings stay; their instruction channels don't. Settings can set
    // env, so the memory switch is pinned here as well as in the environment.
    "--setting-sources", "user",
    "--settings", JSON.stringify({ disableAllHooks: true, outputStyle: "default", env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } }),
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-prompts", "none",
    ...(o.allowedTools.length ? ["--allowedTools", o.allowedTools.join(",")] : []),
  ];
}

const EFFORT: Record<string, string> = { minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high" };

// ---- replay: the history, as labelled text, for a fresh process ---------------------------------
export const ADAPTER_NOTE = `

## How this conversation reaches you
You run inside the LifeHarness app. LifeHarness's tools are the mcp__${BRIDGE_NAME}__* tools (ask_question is ${MCP_PREFIX}ask_question, and so on): always call them by those names, as real tool calls. If the conversation so far arrives as a labelled transcript ([person], [coach], [coach called …], [result of …]), it is the history: continue from its end, and never write such labels yourself.`;

const textOf = (c: string | { type: string; text?: string }[]) => (typeof c === "string" ? c : c.map((x) => (x.type === "text" ? (x.text ?? "") : "")).join("\n"));

export function replayContent(messages: Message[]): { type: "text"; text: string }[] {
  const conv = messages.filter((m) => m.role !== "system");
  if (conv.length === 1 && conv[0].role === "user") return [{ type: "text", text: textOf(conv[0].content) }];
  const blocks: { type: "text"; text: string }[] = [];
  for (const m of conv) {
    if (m.role === "user") blocks.push({ type: "text", text: `[person]\n${textOf(m.content)}` });
    else if (m.role === "assistant") {
      const parts: string[] = [];
      for (const c of m.content) {
        if (c.type === "text" && c.text.trim()) parts.push(`[coach]\n${c.text.trim()}`);
        if (c.type === "toolCall") parts.push(`[coach called ${c.name}] ${JSON.stringify(c.arguments)}`);
      }
      if (parts.length) blocks.push({ type: "text", text: parts.join("\n\n") });
    } else if (m.role === "toolResult") {
      blocks.push({ type: "text", text: `[result of ${m.toolName}${m.isError ? " · error" : ""}]\n${textOf(m.content)}` });
    }
  }
  return blocks;
}

/** The prompt's stable doctrine (reuse requires it unchanged) and its live context (sent as an update). */
export function splitPrompt(prompt: string): { stable: string; live: string } {
  const i = prompt.indexOf(LIVE_CONTEXT_MARKER);
  return i < 0 ? { stable: prompt, live: "" } : { stable: prompt.slice(0, i).trimEnd(), live: prompt.slice(i + LIVE_CONTEXT_MARKER.length).trim() };
}

export const LIVE_UPDATE_LABEL = "[Updated live context: this replaces the live context in your instructions]";

/** What the model saw: compared for reuse (not ids/timestamps/usage). */
function visible(messages: Message[]): unknown[] {
  return messages.flatMap((m): unknown[] =>
    m.role === "system" ? [] : m.role === "toolResult" ? [{ role: m.role, toolCallId: m.toolCallId, toolName: m.toolName, content: m.content, isError: m.isError }] : [{ role: m.role, content: m.content }],
  );
}

// ---- Claude Code's stream-json, as events ----------------------------------------------------------
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
export type CliEvent =
  | { type: "messageStart"; usage: Usage; model?: string; id?: string }
  | { type: "blockStart"; index: number; kind: "text" | "thinking" | "toolUse"; id?: string; name?: string }
  | { type: "textDelta"; index: number; text: string }
  | { type: "thinkingDelta"; index: number; thinking: string }
  | { type: "toolInputDelta"; index: number; json: string }
  | { type: "blockStop"; index: number }
  | { type: "messageDelta"; stopReason?: string; usage: Usage }
  | { type: "messageStop" }
  | { type: "assistantError"; error: string; text: string }
  | { type: "resultError"; text: string }
  | { type: "toolResults"; ids: string[] }
  | { type: "limit"; message: string };

const usageOf = (u: Record<string, number> | undefined): Usage => ({
  input: u?.input_tokens,
  output: u?.output_tokens,
  cacheRead: u?.cache_read_input_tokens,
  cacheWrite: u?.cache_creation_input_tokens,
});

export function parseCliLine(raw: string): CliEvent | null {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(raw);
  } catch {
    return null;
  }
  if (e.parent_tool_use_id != null) return null; // subagent traffic (we offer no Agent tool)
  if (e.type === "stream_event") {
    const ev = e.event as Record<string, unknown>;
    const index = ev.index as number;
    switch (ev.type) {
      case "message_start": {
        const m = ev.message as { usage?: Record<string, number>; model?: string; id?: string };
        return { type: "messageStart", usage: usageOf(m.usage), model: m.model, id: m.id };
      }
      case "content_block_start": {
        const b = ev.content_block as { type: string; id?: string; name?: string };
        const kind = b.type === "tool_use" ? "toolUse" : b.type === "thinking" ? "thinking" : b.type === "text" ? "text" : null;
        return kind ? { type: "blockStart", index, kind, id: b.id, name: b.name } : null;
      }
      case "content_block_delta": {
        const d = ev.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
        if (d.type === "text_delta") return { type: "textDelta", index, text: d.text ?? "" };
        if (d.type === "thinking_delta") return { type: "thinkingDelta", index, thinking: d.thinking ?? "" };
        if (d.type === "input_json_delta") return { type: "toolInputDelta", index, json: d.partial_json ?? "" };
        return null;
      }
      case "content_block_stop":
        return { type: "blockStop", index };
      case "message_delta":
        return { type: "messageDelta", stopReason: (ev.delta as { stop_reason?: string })?.stop_reason ?? undefined, usage: usageOf(ev.usage as Record<string, number>) };
      case "message_stop":
        return { type: "messageStop" };
    }
    return null;
  }
  if (e.type === "assistant" && typeof e.error === "string") {
    const content = ((e.message as { content?: { type: string; text?: string }[] })?.content ?? []).map((c) => c.text ?? "").join(" ");
    return { type: "assistantError", error: e.error, text: content.trim() };
  }
  if (e.type === "user") {
    const content = (e.message as { content?: unknown })?.content;
    const ids = Array.isArray(content) ? content.flatMap((c: { type?: string; tool_use_id?: string }) => (c?.type === "tool_result" && c.tool_use_id ? [c.tool_use_id] : [])) : [];
    return ids.length ? { type: "toolResults", ids } : null;
  }
  if (e.type === "result" && e.is_error === true) {
    const errors = Array.isArray(e.errors) ? (e.errors as unknown[]).map(String).join("; ") : "";
    return { type: "resultError", text: String(e.result ?? "") || errors || `Claude Code ended with ${String(e.subtype ?? "an error")}.` };
  }
  if (e.type === "rate_limit_event") {
    const info = e.rate_limit_info as { status?: string; resetsAt?: number; rateLimitType?: string } | undefined;
    if (info?.status !== "rejected") return null;
    const at = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "later";
    return { type: "limit", message: `Claude Code reports your Claude usage limit is reached (${(info.rateLimitType ?? "current").replace("_", "-")} window); it resets ${at}.` };
  }
  return null;
}

const STOP: Record<string, AssistantMessage["stopReason"]> = { end_turn: "stop", stop_sequence: "stop", pause_turn: "stop", tool_use: "toolUse", max_tokens: "length", refusal: "error" };

// ---- one pi stream ----------------------------------------------------------------------------------
class Turn {
  readonly out: AssistantMessage;
  private blocks = new Map<number, number>(); // CLI block index -> content index (text/thinking)
  private building = new Map<number, { call: ToolCall; json: string }>();
  intents: ToolCall[] = [];
  skippedBare = false;
  private started = false;
  finished = false;

  constructor(
    private stream: AssistantMessageEventStream,
    model: Model<Api>,
    private harness: Set<string>,
  ) {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    this.out = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: zero, stopReason: "stop", timestamp: Date.now() };
  }

  get waitingForAdmission() {
    return !this.finished && this.out.stopReason === "toolUse";
  }

  handle(e: CliEvent) {
    if (this.finished) return;
    const out = this.out;
    switch (e.type) {
      case "messageStart":
        this.skippedBare = false;
        this.intents = [];
        if (e.model) out.responseModel = e.model;
        this.usage(e.usage);
        this.start();
        return;
      case "blockStart": {
        const at = out.content.length;
        if (e.kind === "text") {
          out.content.push({ type: "text", text: "" });
          this.blocks.set(e.index, at);
          this.stream.push({ type: "text_start", contentIndex: at, partial: out });
        } else if (e.kind === "thinking") {
          out.content.push({ type: "thinking", thinking: "" });
          this.blocks.set(e.index, at);
          this.stream.push({ type: "thinking_start", contentIndex: at, partial: out });
        } else {
          const name = e.name ?? "";
          if (!name.startsWith(MCP_PREFIX)) {
            // A harness tool called by its bare name: Claude Code has no such tool, answers with an
            // error and the model retries with the right name. Anything else is unexpected.
            if (this.harness.has(name)) this.skippedBare = true;
            else this.fail(`Claude Code produced an unexpected tool call (${name}).`, "error");
            return;
          }
          this.building.set(e.index, { call: { type: "toolCall", id: e.id ?? "", name: name.slice(MCP_PREFIX.length), arguments: {} }, json: "" });
        }
        return;
      }
      case "textDelta": {
        const at = this.blocks.get(e.index);
        const c = at === undefined ? undefined : out.content[at];
        if (c?.type !== "text") return;
        c.text += e.text;
        this.stream.push({ type: "text_delta", contentIndex: at!, delta: e.text, partial: out });
        return;
      }
      case "thinkingDelta": {
        const at = this.blocks.get(e.index);
        const c = at === undefined ? undefined : out.content[at];
        if (c?.type !== "thinking") return;
        c.thinking += e.thinking;
        this.stream.push({ type: "thinking_delta", contentIndex: at!, delta: e.thinking, partial: out });
        return;
      }
      case "toolInputDelta": {
        const b = this.building.get(e.index);
        if (b) b.json += e.json;
        return;
      }
      case "blockStop": {
        const b = this.building.get(e.index);
        if (b) {
          this.building.delete(e.index);
          try {
            const args = b.json ? JSON.parse(b.json) : {};
            b.call.arguments = args && typeof args === "object" && !Array.isArray(args) ? args : {};
          } catch {
            b.call.arguments = {};
          }
          this.intents.push(b.call);
          return;
        }
        const at = this.blocks.get(e.index);
        if (at === undefined) return;
        this.blocks.delete(e.index);
        const c = out.content[at] as TextContent | ThinkingContent;
        if (c.type === "text") this.stream.push({ type: "text_end", contentIndex: at, content: c.text, partial: out });
        else this.stream.push({ type: "thinking_end", contentIndex: at, content: c.thinking, partial: out });
        return;
      }
      case "messageDelta":
        this.usage(e.usage);
        if (e.stopReason) {
          out.stopReason = STOP[e.stopReason] ?? "error";
          if (e.stopReason === "refusal") out.errorMessage = "Claude declined to continue this conversation.";
          else if (!STOP[e.stopReason]) out.errorMessage = `Claude Code stopped for an unexpected reason (${e.stopReason}).`;
        }
        return;
      case "messageStop":
        // A tool call is an intent, not permission to run: the process admits only calls that reach
        // the bridge. A final answer finishes here.
        if (out.stopReason !== "toolUse") this.finish();
        return;
      case "assistantError":
        this.fail(e.error === "authentication_failed" ? NOT_SIGNED_IN : e.text || e.error, "error");
        return;
      case "resultError":
        this.fail(/not (logged|signed) in|\/login/i.test(e.text) ? NOT_SIGNED_IN : e.text, "error");
        return;
    }
  }

  admit(calls: ToolCall[]) {
    this.start();
    for (const call of calls) {
      const at = this.out.content.length;
      this.out.content.push(call);
      this.stream.push({ type: "toolcall_start", contentIndex: at, partial: this.out });
      this.stream.push({ type: "toolcall_end", contentIndex: at, toolCall: call, partial: this.out });
    }
    this.out.stopReason = "toolUse";
    this.finish();
  }

  fail(message: string, reason: "error" | "aborted") {
    if (this.finished) return;
    this.finished = true;
    this.out.stopReason = reason;
    this.out.errorMessage = message;
    this.stream.push({ type: "error", reason, error: this.out });
  }

  private start() {
    if (this.started) return;
    this.started = true;
    this.stream.push({ type: "start", partial: this.out });
  }

  private finish() {
    const r = this.out.stopReason;
    if (r === "error" || r === "aborted" || r === "pending") return this.fail(this.out.errorMessage ?? "Claude Code returned no usable answer.", "error");
    this.finished = true;
    this.stream.push({ type: "done", reason: r === "toolUse" ? "toolUse" : r === "length" ? "length" : "stop", message: this.out });
  }

  private usage(u: Usage) {
    const us = this.out.usage;
    if (u.input !== undefined) us.input = u.input;
    if (u.output !== undefined) us.output = u.output;
    if (u.cacheRead !== undefined) us.cacheRead = u.cacheRead;
    if (u.cacheWrite !== undefined) us.cacheWrite = u.cacheWrite;
    us.totalTokens = us.input + us.output + us.cacheRead + us.cacheWrite;
  }
}

// ---- a Claude Code process (possibly held between pi streams) ----------------------------------------
const live = new Map<ClaudeProcess, NodeJS.Timeout>();
const running = new Set<ClaudeProcess>();
export const liveProcessCount = () => live.size;
/** Stop every Claude Code process this server started (also runs on exit). */
export function stopClaudeProcesses() {
  for (const p of running) p.kill(true);
}
const gp = globalThis as unknown as { __lhClaudeExitHook?: boolean };
if (!gp.__lhClaudeExitHook) {
  gp.__lhClaudeExitHook = true;
  process.once("exit", () => {
    for (const p of running) p.kill(true);
  });
}

class ClaudeProcess {
  toolCallIds: string[] = [];
  private intents: ToolCall[] = [];
  private sourceComplete = false;
  private admitted: BridgeCall[] = [];
  private stderr = "";
  private limit?: string;
  private stopping = false;
  private closed = false;
  private signal?: AbortSignal;

  constructor(
    private child: ChildProcessWithoutNullStreams,
    private bridge: ToolBridge,
    private dirs: string[],
    private turn: Turn,
    readonly chatId: string | undefined,
    private configuration: unknown,
    private conversation: unknown[],
    private live: string,
  ) {
    running.add(this);
  }

  start(firstLine: string, signal?: AbortSignal) {
    this.child.once("close", (code) => this.onClose(code));
    this.child.once("error", () => this.onClose(null));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-16_000)));
    this.child.stdin.on("error", () => {});
    readline.createInterface({ input: this.child.stdout }).on("line", (l) => this.onLine(l));
    this.setSignal(signal);
    // stdin stays open: the process lives on while tool calls wait for their results.
    if (!this.stopping) this.child.stdin.write(`${firstLine}\n`);
  }

  canContinue(chatId: string | undefined, configuration: unknown, messages: Message[], results: ToolResultMessage[]) {
    const conv = visible(messages);
    if (process.env.LIFEHARNESS_DEBUG_CLAUDE) {
      const checks = {
        open: !this.stopping,
        session: !!chatId && chatId === this.chatId,
        configuration: isDeepStrictEqual(configuration, this.configuration),
        history: isDeepStrictEqual(conv.slice(0, this.conversation.length), this.conversation),
        length: conv.length === this.conversation.length + this.admitted.length,
        results: results.length === this.admitted.length && this.admitted.every((c) => results.some((r) => r.toolCallId === c.id && r.toolName === c.name)),
      };
      console.error("[claude-code] reuse checks:", JSON.stringify(checks));
      if (!checks.history) console.error("[claude-code] history differs:", JSON.stringify(conv.slice(0, this.conversation.length)).slice(0, 600), "\n  vs", JSON.stringify(this.conversation).slice(0, 600));
    }
    return (
      !this.stopping &&
      !!chatId &&
      chatId === this.chatId &&
      isDeepStrictEqual(configuration, this.configuration) &&
      isDeepStrictEqual(conv.slice(0, this.conversation.length), this.conversation) &&
      conv.length === this.conversation.length + this.admitted.length &&
      results.length === this.admitted.length &&
      new Set(results.map((r) => r.toolCallId)).size === results.length &&
      this.admitted.every((c) => results.some((r) => r.toolCallId === c.id && r.toolName === c.name))
    );
  }

  continueWith(turn: Turn, messages: Message[], results: ToolResultMessage[], live: string, signal?: AbortSignal) {
    unregister(this);
    const admitted = this.admitted;
    this.admitted = [];
    this.conversation = structuredClone(visible(messages));
    this.turn = turn;
    this.sourceComplete = this.intents.length > 0;
    this.setSignal(signal);
    // The process's instructions carry the live context as it was at spawn; if it has moved on
    // (the clock, the life map, the open strands), the update travels with the first result.
    let update = live !== this.live && live ? `${LIVE_UPDATE_LABEL}\n${live}` : "";
    this.live = live;
    for (const call of admitted) {
      const r = results.find((x) => x.toolCallId === call.id)!;
      this.bridge.resolve(call, update ? { ...r, content: [...r.content, { type: "text", text: update }] } : r);
      update = "";
    }
    this.flushAdmissions();
  }

  /** Only authenticated bridge calls that match their streamed intent ever run. */
  flushAdmissions() {
    if (this.stopping || this.turn.finished || !this.sourceComplete) return;
    const pending = this.bridge.pending();
    if (!pending.length) return;
    const calls: ToolCall[] = [];
    for (const p of pending) {
      const intent = this.intents.find((i) => i.id === p.id);
      if (!intent || intent.name !== p.name || !isDeepStrictEqual(intent.arguments, p.arguments)) {
        this.fail("Claude Code compatibility error: a tool call didn't match what it streamed. Try again, or update Claude Code.");
        return;
      }
      calls.push(intent);
    }
    this.intents = this.intents.filter((i) => !pending.some((p) => p.id === i.id));
    this.admitted = pending;
    this.toolCallIds = pending.map((p) => p.id);
    this.turn.admit(calls);
    this.conversation.push(...structuredClone(visible([this.turn.out])));
    if (this.chatId) register(this);
    else this.kill(); // no session to continue in: the next call replays
  }

  fail(message: string) {
    this.turn.fail(message, "error");
    this.kill();
  }

  kill(now = false) {
    unregister(this);
    if (this.stopping || this.closed) return;
    this.stopping = true;
    this.child.kill(now ? "SIGKILL" : "SIGTERM");
    if (!now) setTimeout(() => this.child.exitCode === null && this.child.kill("SIGKILL"), 1000).unref();
  }

  private readonly abort = () => {
    this.turn.fail("Aborted.", "aborted");
    this.kill();
  };

  private setSignal(signal?: AbortSignal) {
    this.signal?.removeEventListener("abort", this.abort);
    this.signal = signal;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }

  private onLine(line: string) {
    if (this.stopping || !line.trim()) return;
    const e = parseCliLine(line);
    if (!e) return;
    if (e.type === "limit") {
      this.limit = e.message;
      return;
    }
    if (e.type === "toolResults") {
      // Claude Code answered one of our calls itself (refused, blocked by a setting) before the bridge saw it.
      if (e.ids.some((id) => this.intents.some((i) => i.id === id))) this.fail("Claude Code refused one of LifeHarness's tool calls (a Claude Code setting may block it).");
      return;
    }
    if (this.turn.finished) {
      // Moving on while our calls wait for results means Claude Code didn't wait: never act on that.
      this.fail("Claude Code moved on while LifeHarness's tool calls were waiting for results.");
      return;
    }
    if (e.type === "messageStart" && this.sourceComplete && this.intents.length) {
      this.fail("Claude Code moved on without making its tool calls.");
      return;
    }
    this.turn.handle(e);
    if (this.turn.finished) {
      this.kill(); // a final answer: this process is done
      return;
    }
    if (e.type === "messageStop" && this.turn.waitingForAdmission) {
      const intents = this.turn.intents;
      if (!intents.length && this.turn.skippedBare) return; // the model will retry with the right name
      if (!intents.length || new Set(intents.map((i) => i.id)).size !== intents.length) {
        this.fail("Claude Code sent an invalid batch of tool calls.");
        return;
      }
      this.intents = [...intents];
      this.sourceComplete = true;
      this.flushAdmissions();
    }
  }

  private onClose(code: number | null) {
    if (this.closed) return;
    this.closed = true;
    running.delete(this);
    unregister(this);
    this.signal?.removeEventListener("abort", this.abort);
    const tail = this.stderr.trim().split("\n").pop();
    this.turn.fail(this.limit ?? (tail ? `Claude Code stopped: ${tail.slice(0, 300)}` : `Claude Code stopped unexpectedly${code === null ? "" : ` (exit ${code})`}.`), "error");
    void this.bridge.close();
    for (const d of this.dirs) fs.rm(/*turbopackIgnore: true*/ d, { recursive: true, force: true }, () => {});
  }
}

function register(p: ClaudeProcess) {
  unregister(p);
  const t = setTimeout(() => p.kill(), IDLE_MS.current);
  t.unref();
  live.set(p, t);
}
function unregister(p: ClaudeProcess) {
  clearTimeout(live.get(p));
  live.delete(p);
}
function findLive(chatId: string | undefined, ids: string[]): ClaudeProcess | undefined {
  if (!chatId || !ids.length) return undefined;
  for (const p of live.keys()) if (p.chatId === chatId && p.toolCallIds.length === ids.length && ids.every((id) => p.toolCallIds.includes(id))) return p;
  return undefined;
}

// ---- the provider's stream function ------------------------------------------------------------------
export function claudeCodeStream(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const tools = context.tools ?? [];
  const turn = new Turn(stream, model, new Set(tools.map((t) => t.name)));
  const effort = EFFORT[String(options?.reasoning ?? "medium")] ?? "medium";
  const { stable, live } = splitPrompt(context.systemPrompt ?? "");
  const systemPrompt = `${stable}${ADAPTER_NOTE}${live ? `\n\n---\n\n${live}` : ""}`;
  const env = childEnv();
  // A live process is reused only if its instructions, tools, model and environment are unchanged
  // (the live context may move on: see continueWith).
  const configuration = JSON.parse(JSON.stringify({ model: model.id, effort, stable, tools, env }));
  const chatId = options?.sessionId;
  const messages = context.messages;

  // Continue a held process: the last assistant message's tool calls, now with their results.
  const last = messages.findLastIndex((m) => m.role === "assistant");
  const assistant = messages[last];
  if (assistant?.role === "assistant") {
    const ids = assistant.content.flatMap((c) => (c.type === "toolCall" ? [c.id] : []));
    const p = findLive(chatId, ids);
    if (p) {
      const trailing = messages.slice(last + 1);
      const results = trailing.filter((m): m is ToolResultMessage => m.role === "toolResult");
      if (trailing.length === results.length && p.canContinue(chatId, configuration, messages, results)) {
        p.continueWith(turn, messages, results, live, options?.signal);
        return stream;
      }
      p.kill();
    }
  }

  void (async () => {
    const dirs: string[] = [];
    let bridge: ToolBridge | undefined;
    try {
      const status = await claudeCodeStatus();
      const cmd = findClaude();
      if (status.state === "not-found" || !cmd) throw new Error(NOT_INSTALLED);
      if (status.state === "update-required") throw new Error(`Claude Code ${status.version} is older than LifeHarness needs (${MINIMUM_VERSION}). Update it with: claude update, then retry.`);
      if (status.state !== "ok") throw new Error("LifeHarness couldn't check Claude Code's version. Check your installation (claude --version), then retry.");
      if (options?.signal?.aborted) throw new Error("aborted");
      let proc: ClaudeProcess | undefined;
      bridge = await createToolBridge(tools, { onCall: () => proc?.flushAdmissions(), onError: (e) => proc?.fail(e.message) });
      // Inside the app's own private folder, never the system temp folder (claude-runs.ts).
      const cwd = makeRunDir("lifeharness-claude-cwd-");
      dirs.push(cwd);
      const priv = makeRunDir("lifeharness-claude-");
      dirs.push(priv);
      const systemPromptFile = path.join(/*turbopackIgnore: true*/ priv, "system-prompt.md");
      const mcpConfigFile = path.join(/*turbopackIgnore: true*/ priv, "mcp.json");
      fs.writeFileSync(/*turbopackIgnore: true*/ systemPromptFile, systemPrompt, { mode: 0o600 });
      fs.writeFileSync(/*turbopackIgnore: true*/ mcpConfigFile, bridge.mcpConfig, { mode: 0o600 }); // holds the bridge token
      const args = launchArgs({ model: model.id, effort, systemPromptFile, mcpConfigFile, allowedTools: bridge.allowedTools });
      const child = spawn(/*turbopackIgnore: true*/ cmd.file, [...cmd.pre, ...args], { cwd, env: cmd.env ? { ...env, ...cmd.env } : env, stdio: "pipe", windowsHide: true });
      proc = new ClaudeProcess(child, bridge, dirs, turn, chatId, configuration, structuredClone(visible(messages)), live);
      proc.start(JSON.stringify({ type: "user", message: { role: "user", content: replayContent(messages) } }), options?.signal);
    } catch (e) {
      await bridge?.close();
      for (const d of dirs) fs.rmSync(/*turbopackIgnore: true*/ d, { recursive: true, force: true });
      turn.fail(options?.signal?.aborted ? "Aborted." : String((e as Error).message ?? e), options?.signal?.aborted ? "aborted" : "error");
    }
  })();
  return stream;
}
