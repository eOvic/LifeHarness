// Model access through the Pi engine (same approach as LearnHarness).
//
// Credentials live in LifeHarness's OWN files, never pi's: <config>/auth.json (mode 0600) and the
// model catalog cache next to it. People connect providers in Settings → AI models (subscription
// sign-in or an API key; see connections.ts). Environment variables (ANTHROPIC_API_KEY, …) also work.
//   <config> = $LIFEHARNESS_CONFIG_DIR, else ~/.config/LifeHarness (the desktop app's userData).
//   LIFEHARNESS_AUTH_FILE overrides the credentials file (tests, other users).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSettings } from "./store";

export type StreamFn = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;

export function configDir(): string {
  if (process.env.LIFEHARNESS_CONFIG_DIR) return process.env.LIFEHARNESS_CONFIG_DIR;
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(/*turbopackIgnore: true*/ home, "Library", "Application Support", "LifeHarness");
  if (process.platform === "win32") return path.join(/*turbopackIgnore: true*/ process.env.APPDATA || path.join(home, "AppData", "Roaming"), "LifeHarness");
  return path.join(/*turbopackIgnore: true*/ process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "LifeHarness");
}

export function authFile(): string {
  return process.env.LIFEHARNESS_AUTH_FILE || path.join(/*turbopackIgnore: true*/ configDir(), "auth.json");
}

const g = globalThis as unknown as { __lhRuntime?: Promise<ModelRuntime> };

export function runtime(): Promise<ModelRuntime> {
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
const PROVIDER_ORDER = ["openai", "github-copilot", "xai", "anthropic", "google", "openrouter", "openai-codex", "mistral", "deepseek"];

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

export async function availableModels(): Promise<ModelInfo[]> {
  const rt = await runtime();
  const models = await rt.getAvailable();
  const providers = [...new Set(models.map((m) => m.provider))].sort((a, b) => providerRank(a) - providerRank(b) || a.localeCompare(b));
  const out: ModelInfo[] = [];
  for (const p of providers) {
    const rec = recommendedModel(p, models);
    const name = rt.getProvider(p)?.name ?? p;
    const sub = rt.isUsingSubscription(p);
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
  const rt = await runtime();
  const available = await rt.getAvailable();
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
    return (await runtime()).isUsingSubscription(provider);
  } catch {
    return false;
  }
}

export async function defaultStream(): Promise<StreamFn> {
  const rt = await runtime();
  return (model, context, options) => rt.streamSimple(model, context, options);
}
