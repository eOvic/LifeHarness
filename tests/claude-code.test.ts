// Claude through Claude Code: replay, stream parsing, launch contract, the token-protected MCP bridge
// (admission by tool-use id, held calls), and full runs against a fake `claude` that behaves like the
// real one: it streams a tool call, then calls it over the bridge and waits. No real CLI or account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage, Context, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const cc = await import("@/src/server/claude-code");
const { createToolBridge, IDENTITY_ERROR } = await import("@/src/server/claude-code-bridge");
const { describeModelError } = await import("@/src/server/errors");

const tool = { name: "ask_question", description: "Ask one question.", parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } };
const start: Message = { role: "user", content: "[[session start: onboarding]] Greet them.", timestamp: 1 };
const ctx = (messages: Message[]): Context => ({ systemPrompt: "You are the coach.", messages, tools: [tool] });
const result = (id: string, text: string): ToolResultMessage => ({ role: "toolResult", toolCallId: id, toolName: "ask_question", content: [{ type: "text", text }], isError: false, timestamp: 3 });

describe("launch contract", () => {
  it("keeps your Claude Code sign-in and routing, turns off its instruction channels, pre-approves only our tools", () => {
    const a = cc.launchArgs({ model: "sonnet", effort: "low", systemPromptFile: "/p/s.md", mcpConfigFile: "/p/m.json", allowedTools: ["mcp__lifeharness__ask_question"] });
    const flag = (f: string) => a[a.indexOf(f) + 1];
    expect(flag("--setting-sources")).toBe("user"); // your auth/routing settings stay
    expect(JSON.parse(flag("--settings"))).toEqual({ disableAllHooks: true, outputStyle: "default", env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } });
    expect(flag("--tools")).toBe("");
    expect(flag("--permission-prompts")).toBe("none");
    expect(flag("--allowedTools")).toBe("mcp__lifeharness__ask_question");
    for (const f of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) expect(a).toContain(f);
    expect(a).not.toContain("--max-turns"); // the process runs on while tool calls wait
  });

  it("passes your environment through (Claude Code decides billing), minus what LifeHarness itself set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-your-own";
    process.env.LIFEHARNESS_API_SECRET = "ours";
    process.env.ELECTRON_RUN_AS_NODE = "1";
    const env = cc.childEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-your-own");
    expect(env.LIFEHARNESS_API_SECRET).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LIFEHARNESS_API_SECRET;
    delete process.env.ELECTRON_RUN_AS_NODE;
  });

  it("replays history as labelled text, but sends a lone first message as is", () => {
    expect(cc.replayContent([start])).toEqual([{ type: "text", text: "[[session start: onboarding]] Greet them." }]);
    const asst: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Welcome." },
        { type: "toolCall", id: "t1", name: "ask_question", arguments: { question: "Main goal?" } },
      ],
      api: "claude-code-cli",
      provider: "claude-code",
      model: "sonnet",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 2,
    };
    const text = cc.replayContent([start, asst, result("t1", "run a 10K")]).map((b) => b.text);
    expect(text).toEqual(["[person]\n[[session start: onboarding]] Greet them.", '[coach]\nWelcome.\n\n[coach called ask_question] {"question":"Main goal?"}', "[result of ask_question]\nrun a 10K"]);
  });

  it("parses the stream-json events it relies on", () => {
    expect(cc.parseCliLine(JSON.stringify({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "mcp__lifeharness__ask_question" } } }))).toEqual({
      type: "blockStart",
      index: 1,
      kind: "toolUse",
      id: "toolu_1",
      name: "mcp__lifeharness__ask_question",
    });
    expect(cc.parseCliLine(JSON.stringify({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Not logged in" }] } }))).toMatchObject({ type: "assistantError", error: "authentication_failed" });
    expect(cc.parseCliLine(JSON.stringify({ type: "stream_event", parent_tool_use_id: "toolu_x", event: { type: "message_stop" } }))).toBeNull(); // subagent traffic
    expect(cc.parseCliLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1795070400, rateLimitType: "five_hour" } }))).toMatchObject({ type: "limit" });
  });
});

// A minimal MCP client (Streamable HTTP, JSON responses), as Claude Code would speak it.
async function mcpClient(config: string, auth?: string) {
  const s = JSON.parse(config).mcpServers.lifeharness;
  let sid: string | null = null;
  const post = async (body: object) => {
    const r = await fetch(s.url, {
      method: "POST",
      headers: { Authorization: auth ?? s.headers.Authorization, "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) },
      body: JSON.stringify(body),
    });
    sid = r.headers.get("mcp-session-id") ?? sid;
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  };
  return { post };
}

describe("the tool bridge", () => {
  it("is token-protected, declares the tools, admits only calls with a unique tool-use id, and holds them for the result", async () => {
    const errors: string[] = [];
    const bridge = await createToolBridge([tool] as never, { onCall: () => {}, onError: (e) => errors.push(e.message) });
    try {
      expect((await (await mcpClient(bridge.mcpConfig, "Bearer wrong")).post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).status).toBe(401);

      const c = await mcpClient(bridge.mcpConfig);
      await c.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
      await c.post({ jsonrpc: "2.0", method: "notifications/initialized" });
      expect((await c.post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools.map((t: { name: string }) => t.name)).toEqual(["ask_question"]);

      const noId = await c.post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ask_question", arguments: { question: "?" } } });
      expect(JSON.stringify(noId.body)).toContain(IDENTITY_ERROR);

      const held = c.post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ask_question", arguments: { question: "Main goal?" }, _meta: { "claudecode/toolUseId": "toolu_A" } } });
      await new Promise((r) => setTimeout(r, 150));
      expect(bridge.pending()).toEqual([{ id: "toolu_A", name: "ask_question", arguments: { question: "Main goal?" } }]);
      bridge.resolve(bridge.pending()[0], result("toolu_A", "run a 10K"));
      expect((await held).body.result).toEqual({ content: [{ type: "text", text: "run a 10K" }], isError: false });

      const dup = await c.post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "ask_question", arguments: {}, _meta: { "claudecode/toolUseId": "toolu_A" } } });
      expect(JSON.stringify(dup.body)).toContain(IDENTITY_ERROR);
      expect(errors.length).toBe(2);
    } finally {
      await bridge.close();
    }
  });
});

describe("full runs through a fake claude", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-fake-claude-"));
  const fake = path.join(dir, "claude");
  const seen = () => fs.readdirSync(dir).filter((f) => f.startsWith("seen-")).length;
  const lastSeen = () => JSON.parse(fs.readFileSync(path.join(dir, `seen-${seen()}.json`), "utf8"));

  beforeAll(() => {
    fs.writeFileSync(
      fake,
      `#!${process.execPath}
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.400 (Claude Code)"); process.exit(0); }
const dir = ${JSON.stringify(dir)};
const n = fs.readdirSync(dir).filter((f) => f.startsWith("seen-")).length + 1;
const flag = (f) => args[args.indexOf(f) + 1];
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const ev = (event) => out({ type: "stream_event", parent_tool_use_id: null, event });
function message(blocks, stop) {
  ev({ type: "message_start", message: { id: "msg", model: "claude-fake-1", usage: { input_tokens: 5, output_tokens: 1 } } });
  blocks.forEach((b, i) => {
    if (b.text !== undefined) { ev({ type: "content_block_start", index: i, content_block: { type: "text", text: "" } }); ev({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }); }
    else { ev({ type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }); ev({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }); }
    ev({ type: "content_block_stop", index: i });
  });
  ev({ type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 9 } });
  ev({ type: "message_stop" });
}
let buf = "", started = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { buf += d; const i = buf.indexOf("\\n"); if (i >= 0 && !started) { started = true; go(buf.slice(0, i)); } });
async function go(first) {
  fs.writeFileSync(dir + "/seen-" + n + ".json", JSON.stringify({ args, cwdFiles: fs.readdirSync(process.cwd()), apiKey: process.env.ANTHROPIC_API_KEY ?? null, secret: process.env.LIFEHARNESS_API_SECRET ?? null, mds: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS ?? null, first }));
  const scenario = process.env.FAKE_SCENARIO;
  if (scenario === "signedout") {
    out({ type: "assistant", parent_tool_use_id: null, error: "authentication_failed", message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] } });
    out({ type: "result", is_error: true, result: "Not logged in · Please run /login" });
    process.exit(1);
  }
  const s = JSON.parse(fs.readFileSync(flag("--mcp-config"), "utf8")).mcpServers.lifeharness;
  let sid = null;
  const post = async (body) => {
    const r = await fetch(s.url, { method: "POST", headers: { ...s.headers, "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify(body) });
    sid = r.headers.get("mcp-session-id") ?? sid;
    const t = await r.text(); return t ? JSON.parse(t) : null;
  };
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  const streamed = { question: scenario === "mismatch" ? "A" : "Main goal?" };
  message([{ text: "Welcome." }, { id: "toolu_A", name: "mcp__lifeharness__ask_question", input: streamed }], "tool_use");
  const called = scenario === "mismatch" ? { question: "B" } : streamed;
  const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask_question", arguments: called, _meta: { "claudecode/toolUseId": "toolu_A" } } }).catch(() => null);
  out({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "ok" }] } });
  message([{ text: "Got it: " + (res?.result?.content ?? []).map((c) => c.text).join(" | ") }], "end_turn");
  out({ type: "result", subtype: "success", is_error: false });
}
`,
      { mode: 0o755 },
    );
    process.env.LIFEHARNESS_CLAUDE_BIN = fake;
  });
  afterEach(() => {
    delete process.env.FAKE_SCENARIO;
    cc.stopClaudeProcesses(); // no held process carries over between tests
  });

  it("streams a tool call only once Claude Code really calls it, then continues the SAME process with the result", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-your-own";
    process.env.LIFEHARNESS_API_SECRET = "ours";
    await cc.claudeCodeStatus(true);
    const model = cc.claudeCodeModels()[0];
    const before = seen();

    const first = await cc.claudeCodeStream(model, ctx([start]), { reasoning: "low", sessionId: "chat_1" }).result();
    expect(first.stopReason).toBe("toolUse");
    expect(first.content).toEqual([
      { type: "text", text: "Welcome." },
      { type: "toolCall", id: "toolu_A", name: "ask_question", arguments: { question: "Main goal?" } },
    ]);
    expect(first.responseModel).toBe("claude-fake-1");
    expect(cc.liveProcessCount()).toBe(1); // held, waiting for the person's answer

    const run = lastSeen();
    expect(run.apiKey).toBe("sk-your-own"); // yours: Claude Code's to use
    expect(run.secret).toBeNull(); // ours: never passed on
    expect(run.mds).toBe("1");
    expect(run.cwdFiles).toEqual([]); // an empty folder
    expect(JSON.parse(run.first).message.content[0].text).toContain("Greet them"); // the conversation goes in on stdin…
    expect(run.args.join(" ")).not.toContain("Greet them"); // …never on the command line

    const second = await cc.claudeCodeStream(model, ctx([start, first, result("toolu_A", "run a 10K")]), { reasoning: "low", sessionId: "chat_1" }).result();
    expect(second.stopReason).toBe("stop");
    expect(second.content).toEqual([{ type: "text", text: "Got it: run a 10K" }]); // the held MCP call got the real answer (no live context: nothing to update)
    expect(seen() - before).toBe(1); // one process for both calls
    await new Promise((r) => setTimeout(r, 100));
    expect(cc.liveProcessCount()).toBe(0); // a final answer ends it
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LIFEHARNESS_API_SECRET;
  });

  it("keeps the process when only the live context moved on, and sends the update with the result", async () => {
    const { LIVE_CONTEXT_MARKER } = await import("@/src/server/prompts");
    const model = cc.claudeCodeModels()[0];
    const at = (time: string): Context => ({ ...ctx([start]), systemPrompt: `Doctrine.\n\n${LIVE_CONTEXT_MARKER}\nNow: ${time}` });
    const before = seen();
    const first = await cc.claudeCodeStream(model, at("10:00"), { sessionId: "chat_live" }).result();
    expect(JSON.parse(fs.readFileSync(path.join(dir, `seen-${seen()}.json`), "utf8")).args).toContain("--system-prompt-file");
    const second = await cc.claudeCodeStream(model, { ...at("10:01"), messages: [start, first, result("toolu_A", "run a 10K")] }, { sessionId: "chat_live" }).result();
    expect(seen() - before).toBe(1); // still one process
    expect((second.content[0] as { text: string }).text).toBe(`Got it: run a 10K | ${cc.LIVE_UPDATE_LABEL}\nNow: 10:01`);
  });

  it("starts over when the instructions themselves change (e.g. interview -> planning)", async () => {
    const model = cc.claudeCodeModels()[0];
    const first = await cc.claudeCodeStream(model, ctx([start]), { sessionId: "chat_phase" }).result();
    const before = seen();
    await cc.claudeCodeStream(model, { ...ctx([start, first, result("toolu_A", "x")]), systemPrompt: "You are the planner now." }, { sessionId: "chat_phase" }).result();
    expect(seen() - before).toBe(1); // a fresh process
  });

  it("continues one process across LifeHarness's real agent turns (real prompts, chat saved to disk in between)", async () => {
    const store = await import("@/src/server/store");
    const { runTurn } = await import("@/src/server/agent");
    const deps = { stream: cc.claudeCodeStream, model: cc.claudeCodeModels()[0], reasoning: "low" as const, billing: "cli" as const };
    const chat = store.newChat("onboarding");
    const before = seen();
    await runTurn(chat.id, { type: "start" }, () => {}, deps);
    const pending = store.getChat(chat.id)!.pending!;
    expect(pending.args.question).toBe("Main goal?");
    expect(cc.liveProcessCount()).toBe(1);
    await runTurn(chat.id, { type: "answer", toolCallId: pending.toolCallId, answer: { other: "pass the board exam" } }, () => {}, deps);
    const rec = store.getChat(chat.id)!;
    const last = rec.messages.at(-1) as AssistantMessage;
    expect((last.content[0] as { text: string }).text).toMatch(/^Got it: Other \(their words\): pass the board exam/);
    expect(seen() - before).toBe(1); // the person's answer continued the same Claude Code process
    expect(rec.usage.billing).toBe("cli");
  });

  it("starts a fresh process with a labelled replay when no held process fits (other session)", async () => {
    const model = cc.claudeCodeModels()[0];
    const first = await cc.claudeCodeStream(model, ctx([start]), { sessionId: "chat_2" }).result();
    const before = seen();
    const s = cc.claudeCodeStream(model, ctx([start, first, result("toolu_A", "swim more")]), { sessionId: "chat_other" });
    const r = await s.result();
    expect(seen() - before).toBe(1);
    expect(JSON.parse(lastSeen().first).message.content.map((b: { text: string }) => b.text).join("\n")).toContain("[coach called ask_question]");
    expect(r.stopReason).toBe("toolUse"); // the fake starts over; what matters is the replay above
  });

  it("fails closed when the MCP call doesn't match the streamed tool call", async () => {
    process.env.FAKE_SCENARIO = "mismatch";
    const r = await cc.claudeCodeStream(cc.claudeCodeModels()[0], ctx([start]), { sessionId: "chat_3" }).result();
    expect(r.stopReason).toBe("error");
    expect(r.errorMessage).toMatch(/didn't match/);
  });

  it("says plainly when Claude Code isn't signed in", async () => {
    process.env.FAKE_SCENARIO = "signedout";
    const r = await cc.claudeCodeStream(cc.claudeCodeModels()[0], ctx([start]), { sessionId: "chat_4" }).result();
    expect(r.errorMessage).toBe(cc.NOT_SIGNED_IN);
    expect(describeModelError(r.errorMessage!).action).toBe("connect");
  });

  it("checks only the version: missing or too old blocks the run", async () => {
    process.env.LIFEHARNESS_CLAUDE_BIN = path.join(dir, "nope");
    expect(await cc.claudeCodeStatus(true)).toEqual({ state: "not-found", version: null, minimumVersion: cc.MINIMUM_VERSION });
    const r = await cc.claudeCodeStream(cc.claudeCodeModels()[0], ctx([start])).result();
    expect(r.errorMessage).toBe(cc.NOT_INSTALLED);
    process.env.LIFEHARNESS_CLAUDE_BIN = fake;
    expect((await cc.claudeCodeStatus(true)).state).toBe("ok");
  });
});
