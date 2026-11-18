// Model access through the Pi engine (same approach as LearnHarness).
// By default this reuses pi's own credentials (~/.pi/agent/auth.json: API keys or a subscription login).
// Set LIFEHARNESS_AUTH_FILE to use a separate credentials file (e.g. for other users).
import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSettings } from "./store";

export type StreamFn = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;

const g = globalThis as unknown as { __lhRuntime?: Promise<ModelRuntime> };

export function runtime(): Promise<ModelRuntime> {
  g.__lhRuntime ??= ModelRuntime.create(
    process.env.LIFEHARNESS_AUTH_FILE ? { authPath: process.env.LIFEHARNESS_AUTH_FILE } : undefined,
  ).catch((e) => {
    g.__lhRuntime = undefined;
    throw e;
  });
  return g.__lhRuntime;
}

/** Preferred defaults when the user hasn't picked a model. First available wins. */
const PREFERRED = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  "openrouter/anthropic/claude-sonnet-4.5",
];

export interface ModelInfo {
  ref: string; // provider/id
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export async function availableModels(): Promise<ModelInfo[]> {
  const rt = await runtime();
  const models = await rt.getAvailable();
  return models.map((m) => ({ ref: `${m.provider}/${m.id}`, provider: m.provider, id: m.id, name: m.name, reasoning: !!m.reasoning }));
}

export async function resolveModel(): Promise<Model<Api>> {
  const rt = await runtime();
  const available = await rt.getAvailable();
  if (!available.length) {
    throw new Error("No model is configured. Log in with `pi` (/login) or set an API key (e.g. ANTHROPIC_API_KEY), then reload.");
  }
  const byRef = (ref: string) => {
    const i = ref.indexOf("/");
    const provider = ref.slice(0, i);
    const id = ref.slice(i + 1);
    return available.find((m) => m.provider === provider && m.id === id);
  };
  const chosen = getSettings().model;
  if (chosen) {
    const m = byRef(chosen);
    if (m) return m;
  }
  for (const ref of PREFERRED) {
    const m = byRef(ref);
    if (m) return m;
  }
  return available[0];
}

export async function defaultStream(): Promise<StreamFn> {
  const rt = await runtime();
  return (model, context, options) => rt.streamSimple(model, context, options);
}
