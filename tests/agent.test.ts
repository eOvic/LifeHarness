// The agent loop with a scripted model: question pause/resume, server tools, the intake -> plan
// handoff, proposal + adoption. No network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";

process.env.LIFEHARNESS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lh-test-"));

type Step = (ctx: Context) => AssistantMessage;
function scripted(steps: Step[]) {
  const contexts: Context[] = [];
  let i = 0;
  const fn = (_m: Model<Api>, ctx: Context) => {
    contexts.push(structuredClone(ctx));
    const step = steps[i++];
    if (!step) throw new Error(`no scripted step #${i}`);
    const msg = step(ctx);
    const s = createAssistantMessageEventStream();
    queueMicrotask(() => {
      s.push({ type: "start", partial: msg });
      msg.content.forEach((c, j) => c.type === "text" && s.push({ type: "text_delta", contentIndex: j, delta: c.text, partial: msg }));
      s.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : "stop", message: msg });
    });
    return s;
  };
  return { fn, contexts, used: () => i };
}
const tools = (...calls: ReturnType<typeof fauxToolCall>[]) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const lastText = (ctx: Context) => {
  const m = ctx.messages[ctx.messages.length - 1];
  return m.role === "toolResult" ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("") : JSON.stringify(m);
};

let store: typeof import("@/src/server/store");
let agent: typeof import("@/src/server/agent");
let plans: typeof import("@/src/server/plans");
let schedule: typeof import("@/src/server/schedule");
beforeAll(async () => {
  store = await import("@/src/server/store");
  agent = await import("@/src/server/agent");
  plans = await import("@/src/server/plans");
  schedule = await import("@/src/server/schedule");
});

const model = { id: "fake", provider: "fake", api: "fake" } as unknown as Model<Api>;

describe("agent loop", () => {
  it("runs interview -> handoff -> plan -> adoption", async () => {
    const chat = store.newChat("onboarding");
    const s = scripted([
      // 1: greet, record, ask
      () =>
        fauxAssistantMessage(
          [
            fauxText("Hi! A short interview, then a plan."),
            fauxToolCall("update_profile", { timezone: "Europe/Berlin" }, { id: "t1" }),
            fauxToolCall("ask_question", { question: "What brings you here?", kind: "text" }, { id: "q1" }),
            fauxToolCall("ask_question", { question: "A second question in the same turn", kind: "text" }, { id: "q2" }),
          ],
          { stopReason: "toolUse" },
        ),
      // 2: sees the answer; tries to conclude too early
      (ctx) => {
        expect(lastText(ctx)).toContain("Thinking: I keep starting and stopping");
        expect(ctx.systemPrompt).toContain("# The intake");
        return tools(fauxToolCall("intake_done", { summary: "too early" }, { id: "d1" }));
      },
      // 3: refused -> fills the required strands
      (ctx) => {
        expect(lastText(ctx)).toMatch(/Refused: required strands missing/);
        return tools(
          fauxToolCall(
            "update_profile",
            {
              weekStart: "mon",
              sleep: { bed: "23:00", wake: "07:00" },
              fixed: [{ id: "job", title: "Work", days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "17:00", category: "work" }],
              fixedConfirmed: true,
              faith: { enabled: false },
              energy: { peak: { start: "06:00", end: "09:00" } },
              goals: [{ id: "novel", horizon: "year", title: "Finish my novel draft", measure: "80k words", deadline: "2027-06-30", why: "creativity", confidence: 70 }],
            },
            { id: "t2" },
          ),
        );
      },
      // 4: conclude
      () => fauxAssistantMessage([fauxText("Here's what I heard."), fauxToolCall("intake_done", { summary: "Writer with a day job." }, { id: "d2" })], { stopReason: "toolUse" }),
      // 5: planner takes over in the same turn
      (ctx) => {
        expect(ctx.systemPrompt).toContain("# The plan");
        expect(ctx.tools?.map((t) => t.name)).toContain("propose_plan");
        return tools(
          fauxToolCall(
            "propose_plan",
            {
              approach: "Write before work.",
              goals: [
                { id: "novel", horizon: "year", title: "Finish my novel draft", measure: "80k words" },
                { id: "novel-month", horizon: "month", title: "Outline + 10k words", parentId: "novel" },
              ],
              blocks: [
                { id: "write", title: "Write: novel", category: "deep", goalId: "novel", durationMin: 90, timesPerWeek: 5, window: "peak", core: true, energy: "high" },
                { id: "plan-tomorrow", title: "Plan tomorrow", category: "admin", durationMin: 10, before: { ref: "bed", gapMin: 30 } },
              ],
            },
            { id: "p1" },
          ),
        );
      },
      // 6: present
      (ctx) => {
        expect(lastText(ctx)).toContain("placed 12/12 block sessions");
        return fauxAssistantMessage("Here's the plan: writing 06:00-07:30 before work. Adopt it if it looks right.");
      },
    ]);

    const events: string[] = [];
    await agent.runTurn(chat.id, { type: "start" }, (e) => events.push(e.type), { stream: s.fn as never, model });
    let rec = store.getChat(chat.id)!;
    expect(rec.pending?.toolCallId).toBe("q1");
    expect(store.getProfile().timezone).toBe("Europe/Berlin");
    // the duplicate question was rejected immediately; q1 stays open
    expect(rec.messages.filter((m) => m.role === "toolResult").map((m) => (m as { toolCallId: string }).toolCallId)).toEqual(["t1", "q2"]);
    expect(events).toContain("text");

    await agent.runTurn(chat.id, { type: "answer", toolCallId: "q1", answer: { other: "I want to write", thinking: "I keep starting and stopping" } }, () => {}, { stream: s.fn as never, model });
    rec = store.getChat(chat.id)!;
    expect(s.used()).toBe(6);
    expect(rec.phase).toBe("plan");
    expect(rec.pending).toBeNull();
    expect(rec.proposal?.blocks).toHaveLength(2);
    expect(rec.proposal?.preview.unplaced).toEqual([]);

    const plan = plans.adoptProposal(chat.id);
    expect(plan.version).toBe(1);
    expect(store.getProfile().goals?.map((g) => g.id)).toEqual(["novel", "novel-month"]);
    // This week: days before today keep their old (empty) plan; adoption never rewrites history.
    const week = schedule.scheduleWeek();
    for (const d of week.days) {
      const has = d.blocks.some((b) => b.key === "block:write");
      if (d.date < week.today) expect(has, d.date).toBe(false);
    }
    // Next week: the full plan.
    const next = schedule.scheduleWeek(new Date(Date.parse(week.start) + 7 * 864e5).toISOString().slice(0, 10));
    const writing = next.days.flatMap((d) => d.blocks).filter((b) => b.key === "block:write");
    expect(writing).toHaveLength(5);
    expect(writing.every((b) => b.start === 7 * 60)).toBe(true); // peak 06-09, but awake from 07:00, work at 09:00
  });
});
