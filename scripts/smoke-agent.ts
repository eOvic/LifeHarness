// Live end-to-end check with the real model: a simulated person (a second model call playing a
// persona) answers the interviewer until a plan is proposed. Uses a throwaway data dir.
//   npm run smoke -- [--rounds 30] [--persona "..."] [--keep]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const ROUNDS = Number(opt("rounds", "30"));
const PERSONA =
  opt("persona") ??
  `You are Sara, 27, a junior data analyst in Amman, Jordan (week starts Sunday; work Sun-Thu 09:00-17:00, 30 min commute each way).
You are Muslim and pray the five daily prayers; you'd like prayer times to anchor your day.
Goals you'd mention if asked: get a better job (move into machine learning engineering) within a year; get fit (you used to run, stopped 8 months ago);
read the Quran daily with understanding. You sleep ~00:30-07:30 but want to sleep earlier and wake for Fajr.
Your energy is best 06:00-10:00, you crash around 15:00. Past attempts: tried an online ML course twice, quit after 3 weeks both times
because evenings after work you were too tired and scrolled your phone. You can focus ~60-75 min at once.
Answer like a real person: brief, sometimes unsure, in your own words.`;

process.env.LIFEHARNESS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lh-smoke-"));

const { newChat, getChat, getProfile } = await import("../src/server/store");
const { runTurn } = await import("../src/server/agent");
const { resolveModel, defaultStream, runtime } = await import("../src/server/llm");
const { fmt } = await import("../src/core/time");

const model = await resolveModel().catch((e: Error) => {
  console.error(`${e.message}\n(Credentials: ~/.config/LifeHarness/auth.json, shared with the app; or set LIFEHARNESS_AUTH_FILE, or a provider env var such as OPENAI_API_KEY.)`);
  process.exit(2);
});
const stream = await defaultStream();
console.log(`model: ${model.provider}/${model.id} · data: ${process.env.LIFEHARNESS_DATA_DIR}\n`);

async function personaAnswer(q: { question: string; kind?: string; options?: { label: string }[]; askConfidence?: boolean }) {
  const rt = await runtime();
  const opts = q.options?.map((o) => o.label) ?? [];
  const prompt = `${PERSONA}\n\nAn app is interviewing you to plan your time. Question: "${q.question}"\n${
    opts.length ? `Options (${q.kind === "multi" ? "pick any" : "pick one"}): ${JSON.stringify(opts)}\n` : "Open question.\n"
  }Reply with JSON only: {"selected": [exact option labels or empty], "other": "your own words or empty", "thinking": "1-2 sentences thinking out loud"${
    q.askConfidence ? ', "confidence": 0-100' : ""
  }}`;
  const msg = await rt.completeSimple(model, { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] });
  const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return { selected: (json.selected ?? []).filter((s: string) => opts.includes(s)), other: json.other || undefined, thinking: json.thinking || undefined, confidence: json.confidence };
}

const chat = newChat("onboarding");
const print = (e: { type: string; delta?: string; label?: string; message?: string }) => {
  if (e.type === "text") process.stdout.write(e.delta!);
  if (e.type === "tool") process.stdout.write(`\n   ⚙ ${e.label}\n`);
  if (e.type === "error") console.log(`\n!! ${e.message}`);
};
const t0 = Date.now();
await runTurn(chat.id, { type: "start" }, print, { stream, model });

for (let round = 1; round <= ROUNDS; round++) {
  const rec = getChat(chat.id)!;
  if (rec.proposal && !rec.pending) break;
  if (!rec.pending) {
    if (rec.lastError) break;
    console.log("\n[no open question; nudging]");
    await runTurn(chat.id, { type: "message", text: "Okay, go on." }, print, { stream, model });
    continue;
  }
  const q = rec.pending.args;
  console.log(`\n\n── Q${round} [${q.kind ?? "single"}${q.askConfidence ? ", confidence" : ""}] ${q.question}`);
  if (q.options?.length) console.log("   options: " + q.options.map((o) => o.label).join(" | "));
  const a = await personaAnswer(q);
  console.log(`   → ${JSON.stringify(a)}\n`);
  await runTurn(chat.id, { type: "answer", toolCallId: rec.pending.toolCallId, answer: a }, print, { stream, model });
}

const rec = getChat(chat.id)!;
const p = getProfile();
console.log("\n\n================ RESULT ================");
console.log(`phase: ${rec.phase} · questions: ${Object.keys(rec.questions).length} · model calls: ${rec.usage.calls} · cost≈$${rec.usage.cost.toFixed(2)} · ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`profile: goals=${p.goals?.length ?? 0} fixed=${p.fixed?.length ?? 0} faith=${p.faith?.enabled} loc=${JSON.stringify(p.location)} sleep=${JSON.stringify(p.sleep)} peak=${JSON.stringify(p.energy?.peak)}`);
if (rec.proposal) {
  const w = rec.proposal.preview;
  console.log(`proposal: ${rec.proposal.blocks.length} blocks · unplaced ${w.unplaced.length} · free ${w.stats.freePct}%`);
  for (const d of w.days.slice(0, 2)) {
    console.log(`  ${d.day} ${d.date}: ` + d.blocks.filter((b) => b.source !== "sleep").map((b) => `${fmt(b.start)} ${b.title}`).join(" | "));
  }
}
if (!argv.includes("--keep")) fs.rmSync(process.env.LIFEHARNESS_DATA_DIR!, { recursive: true, force: true });
process.exit(0);
