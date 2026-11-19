// Model access through the Pi engine (same approach as LearnHarness).
//
// Credentials live in LifeHarness's OWN files, never pi's: <config>/auth.json (mode 0600) and the
// model catalog cache next to it. People connect providers in Settings → AI models (subscription
// sign-in or an API key; see connections.ts). Environment variables (ANTHROPIC_API_KEY, …) also work.
//   <config> = $LIFEHARNESS_CONFIG_DIR, else ~/.config/LifeHarness (the desktop app's userData).
//   LIFEHARNESS_AUTH_FILE overrides the credentials file (tests, other users).
import path from "node:path";
import fs from "node:fs";
import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { authFile } from "./config-dir";
import { CLAUDE_CODE, claudeCodeModels, claudeCodeStatus, claudeCodeStream } from "./claude-code";
import { getSettings } from "./store";

export type StreamFn = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;

export { authFile, configDir } from "./config-dir";

const g = globalThis as unknown as { __lhRuntime?: Promise<ModelRuntime> };

export function runtime(): Promise<ModelRuntime> {
  // Privacy: pi refreshes model catalogs from pi.dev in the background (it learns your IP and which
  // providers you use). The built-in catalog is enough; LIFEHARNESS_MODEL_CATALOG=online opts in.
  if (process.env.LIFEHARNESS_MODEL_CATALOG !== "online") process.env.PI_OFFLINE ??= "1";
  g.__lhRuntime ??= (async () => {
    const auth = authFile();
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(auth), { recursive: true, mode: 0o700 });
    // modelsPath also places pi's catalog cache (models-store.json) beside it, out of ~/.pi.
    return ModelRuntime.create({ authPath: auth, modelsPath: path.join(/*turbopackIgnore: true*/ path.dirname(auth), "models.json") });
  })().catch((e) => {
    g.__lhRuntime = undefined;
    throw e;
  });
  return g.__lhRuntime;
}

/** Thrown when no provider is connected; the UI answers it with "Connect a model". */
export class NoModelError extends Error {
  constructor() {
    super("No AI model is connected yet. Connect one in Settings → AI models: a subscription you already have, or an API key.");
    this.name = "NoModelError";
  }
}

// ---- choosing a model ---------------------------------------------------------------------
// A coaching interview is ~20 calls of careful conversation: we want each provider's strong,
// balanced model (not its priciest, not a coding specialist). Patterns, newest version first.
const PREFERENCES: Record<string, RegExp[]> = {
  [CLAUDE_CODE]: [/^sonnet$/],
  anthropic: [/^claude-sonnet-\d+(?:-\d+)?$/, /^claude-opus-\d+(?:-\d+)?$/],
  openai: [/^gpt-\d+(?:\.\d+)?-sol$/, /^gpt-\d+(?:\.\d+)?$/],
  "openai-codex": [/^gpt-\d+(?:\.\d+)?-sol$/, /^gpt-\d+(?:\.\d+)?/],
  "github-copilot": [/^claude-sonnet-\d+(?:\.\d+)?$/, /^gpt-\d+(?:\.\d+)?-sol$/, /^gpt-\d+(?:\.\d+)?$/],
  google: [/^gemini-pro-latest$/, /^gemini-\d+(?:\.\d+)?-pro$/],
  xai: [/^grok-\d+(?:\.\d+)?$/],
  openrouter: [/^~anthropic\/claude-sonnet-latest$/, /^~openai\/gpt-sol-latest$/, /^~google\/gemini-pro-latest$/, /^anthropic\/claude-sonnet-\d+(?:\.\d+)?$/],
  mistral: [/^mistral-large-latest$/, /^mistral-medium-latest$/],
  deepseek: [/^deepseek-v\d+(?:\.\d+)?-pro$/],
  groq: [/^openai\/gpt-oss-120b$/, /^llama-3\.3-70b/],
  "kimi-coding": [/^k\d+(?:\.\d+)?-pro$/, /^kimi-for-coding$/],
  meta: [/^muse-spark-\d+(?:\.\d+)?$/],
};
/** When several providers are connected and none was picked: subscriptions first, then keys. */
const PROVIDER_ORDER = [CLAUDE_CODE, "openai", "github-copilot", "xai", "anthropic", "google", "openrouter", "openai-codex", "mistral", "deepseek"];

const version = (id: string) => (id.match(/\d+/g) ?? []).map(Number);
function newerFirst(a: string, b: string) {
  const x = version(a);
  const y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? -1) !== (x[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  return 0;
}

export function recommendedModel<M extends { id: string; provider: string; reasoning?: boolean }>(provider: string, models: readonly M[]): M | undefined {
  const list = models.filter((m) => m.provider === provider);
  for (const re of PREFERENCES[provider] ?? []) {
    const hits = list.filter((m) => re.test(m.id)).sort((a, b) => newerFirst(a.id, b.id));
    if (hits.length) return hits[0];
  }
  return list.find((m) => m.reasoning) ?? list[0];
}

const providerRank = (p: string) => (PROVIDER_ORDER.indexOf(p) + 1 || 99);

export interface ModelInfo {
  ref: string; // provider/id
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  recommended: boolean;
  subscription: boolean;
}

/** Claude via Claude Code: offered once turned on in Settings and a new-enough Claude Code is installed. */
async function claudeCodeAvailable(): Promise<Model<Api>[]> {
  if (!getSettings().claudeCode) return [];
  return (await claudeCodeStatus()).state === "ok" ? claudeCodeModels() : [];
}

async function allAvailable(): Promise<readonly Model<Api>[]> {
  const rt = await runtime();
  return [...(await claudeCodeAvailable()), ...(await rt.getAvailable())];
}

const providerName = (rt: ModelRuntime, p: string) => (p === CLAUDE_CODE ? "Claude (via Claude Code)" : (rt.getProvider(p)?.name ?? p));

export async function availableModels(): Promise<ModelInfo[]> {
  const rt = await runtime();
  const models = await allAvailable();
  const providers = [...new Set(models.map((m) => m.provider))].sort((a, b) => providerRank(a) - providerRank(b) || a.localeCompare(b));
  const out: ModelInfo[] = [];
  for (const p of providers) {
    const rec = recommendedModel(p, models);
    const name = providerName(rt, p);
    const sub = await isSubscription(p);
    for (const m of models.filter((x) => x.provider === p)) {
      out.push({ ref: `${p}/${m.id}`, provider: p, providerName: name, id: m.id, name: m.name, reasoning: !!m.reasoning, recommended: m === rec, subscription: sub });
    }
  }
  return out;
}

function byRef(models: readonly Model<Api>[], ref: string) {
  const i = ref.indexOf("/");
  return models.find((m) => m.provider === ref.slice(0, i) && m.id === ref.slice(i + 1));
}

/** The model a turn will use: the one picked in Settings, else the best connected one. */
export async function resolveModel(): Promise<Model<Api>> {
  const available = await allAvailable();
  const chosen = getSettings().model;
  if (chosen) {
    const m = byRef(available, chosen);
    if (m) return m;
  }
  const providers = [...new Set(available.map((m) => m.provider))].sort((a, b) => providerRank(a) - providerRank(b) || a.localeCompare(b));
  for (const p of providers) {
    const m = recommendedModel(p, available);
    if (m) return m;
  }
  throw new NoModelError();
}

/** Whether calls to this provider are covered by a subscription (so per-token cost is only an estimate). */
export async function isSubscription(provider: string): Promise<boolean> {
  try {
    if (provider === CLAUDE_CODE) return false; // Claude Code decides billing (see billingOf)
    return (await runtime()).isUsingSubscription(provider);
  } catch {
    return false;
  }
}

/** How a provider's calls are paid for, for the session header. */
export async function billingOf(provider: string): Promise<"subscription" | "api" | "cli"> {
  if (provider === CLAUDE_CODE) return "cli";
  return (await isSubscription(provider)) ? "subscription" : "api";
}

export async function displayProviderName(provider: string): Promise<string> {
  return providerName(await runtime(), provider);
}

export async function defaultStream(): Promise<StreamFn> {
  const rt = await runtime();
  return (model, context, options) => (model.provider === CLAUDE_CODE ? claudeCodeStream(model, context, options) : rt.streamSimple(model, context, options));
}
