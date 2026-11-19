// Connecting AI providers: subscription sign-in (OAuth) or an API key, through pi's ModelRuntime.
// Credentials go to LifeHarness's own auth file (0600). Secrets never travel back to the page:
// the page only sees which providers are connected and how.
//
// A sign-in is a "login job": pi drives the flow and calls back for prompts (paste a code, pick
// an option) and events (open this URL, enter this device code). The job relays those to the
// page over a streamed response and waits for answers posted to /api/connections/login/<job>.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { CLAUDE_CODE, claudeCodeStatus, type ClaudeCodeStatus } from "./claude-code";
import { describeModelError, isAuthFailure, providerMessage } from "./errors";
import { authFile, recommendedModel, resolveModel, runtime } from "./llm";
import { isWindows } from "./platform";
import { getSettings, saveSettings } from "./store";

// ---- what we offer, and how it's presented -------------------------------------------------
/** Sign-in labels. Featured ones are shown up front; the rest sit under "More sign-ins". */
const SIGN_INS: Record<string, { label: string; blurb: string; rank: number; featured?: boolean }> = {
  openai: { label: "ChatGPT", blurb: "Plus, Pro or Team plan", rank: 1, featured: true },
  "github-copilot": { label: "GitHub Copilot", blurb: "free for verified students and teachers", rank: 2, featured: true },
  xai: { label: "Grok", blurb: "SuperGrok or X Premium", rank: 3, featured: true },
  openrouter: { label: "OpenRouter", blurb: "pay as you go, one account for every model", rank: 10 },
  "openai-codex": { label: "ChatGPT via Codex", blurb: "uses your plan's Codex limits", rank: 11 },
  "kimi-coding": { label: "Kimi Code", blurb: "Kimi subscription", rank: 12 },
  meta: { label: "Meta AI", blurb: "Muse subscription", rank: 13 },
  radius: { label: "Radius", blurb: "Earendil's AI gateway", rank: 14 },
};
/** API keys shown up front; the rest are under "Add a provider". */
const KEYS: Record<string, { label: string; blurb: string; url: string; rank: number }> = {
  anthropic: { label: "Anthropic", blurb: "Claude", url: "https://console.anthropic.com/settings/keys", rank: 1 },
  openai: { label: "OpenAI", blurb: "GPT models", url: "https://platform.openai.com/api-keys", rank: 2 },
  google: { label: "Google Gemini", blurb: "has a free tier", url: "https://aistudio.google.com/apikey", rank: 3 },
  openrouter: { label: "OpenRouter", blurb: "one key for every model", url: "https://openrouter.ai/keys", rank: 4 },
};
/** Sign-in methods deliberately not offered. */
export const BLOCKED_SIGN_IN: Record<string, string> = {
  anthropic:
    "Claude with your Pro or Max plan: use the Claude row under Subscriptions. It runs through Claude Code, Anthropic's own app, which you sign in to yourself; Anthropic doesn't allow other apps to handle Claude logins directly.",
};

export interface ProviderInfo {
  id: string;
  name: string;
  /** Only for the Claude-through-Claude-Code entry. */
  claudeCode?: ClaudeCodeStatus & { enabled: boolean };
  signIn?: { label: string; blurb?: string; subscription: boolean; featured: boolean; rank: number };
  signInBlocked?: string;
  key?: { label: string; blurb?: string; url?: string; featured: boolean; rank: number };
  connected: boolean;
  via?: "api_key" | "oauth" | "environment" | "config" | "claude-code";
  /** Where an environment/config credential comes from, e.g. "ANTHROPIC_API_KEY". */
  source?: string;
  models: number;
  recommended?: { ref: string; name: string };
}

async function claudeCodeEntry(force = false): Promise<ProviderInfo> {
  const st = await claudeCodeStatus(force);
  const enabled = !!getSettings().claudeCode;
  const status: ClaudeCodeStatus = { state: st.state, version: st.version, minimumVersion: st.minimumVersion, windows: isWindows() }; // no cache metadata
  const ready = st.state === "ok";
  return {
    id: CLAUDE_CODE,
    name: "Claude",
    signIn: { label: "Claude", blurb: "Pro, Max or Ultra plan · runs through Claude Code", subscription: true, featured: true, rank: 0 },
    claudeCode: { ...status, enabled },
    connected: enabled && ready,
    via: enabled && ready ? "claude-code" : undefined,
    models: enabled && ready ? 3 : 0,
    recommended: { ref: `${CLAUDE_CODE}/sonnet`, name: "Claude Sonnet" },
  };
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const rt = await runtime();
  const stored = new Map((await rt.listCredentials()).map((c) => [c.providerId, c.type] as const));
  const available = await rt.getAvailable();
  const out: ProviderInfo[] = [await claudeCodeEntry()];
  for (const p of rt.getProviders()) {
    const status = rt.getProviderAuthStatus(p.id);
    const via = stored.get(p.id) ?? (status.configured ? (status.source === "environment" ? "environment" : "config") : undefined);
    const oauth = p.auth.oauth;
    const blocked = BLOCKED_SIGN_IN[p.id];
    const s = SIGN_INS[p.id];
    const k = KEYS[p.id];
    const info: ProviderInfo = {
      id: p.id,
      name: p.name,
      connected: !!via,
      via,
      source: via === "environment" || via === "config" ? status.label : undefined,
      models: available.filter((m) => m.provider === p.id).length,
    };
    if (oauth && !blocked) {
      info.signIn = {
        label: s?.label ?? p.name,
        blurb: s?.blurb ?? (oauth.loginLabel || undefined),
        subscription: !!oauth.isSubscription,
        featured: !!s?.featured,
        rank: s?.rank ?? 99,
      };
    }
    if (oauth && blocked) info.signInBlocked = blocked;
    if (p.auth.apiKey?.login) info.key = { label: k?.label ?? p.name, blurb: k?.blurb, url: k?.url, featured: !!k, rank: k?.rank ?? 99 };
    const rec = recommendedModel(p.id, available);
    if (rec) info.recommended = { ref: `${p.id}/${rec.id}`, name: rec.name };
    // Ambient-only providers (cloud IAM) can't be set up from here; show them only once configured.
    if (info.signIn || info.key || info.connected) out.push(info);
  }
  return out;
}

/** Turn Claude-through-Claude-Code on or off ("check" just re-reads Claude Code's status). */
export async function setClaudeCode(action: "enable" | "disable" | "check"): Promise<{ provider: ProviderInfo; model?: string; modelName?: string; keptModel?: string; problem?: string }> {
  const s = getSettings();
  if (action === "disable") {
    saveSettings({ ...s, claudeCode: false, model: s.model?.startsWith(`${CLAUDE_CODE}/`) ? undefined : s.model });
    return { provider: await claudeCodeEntry() };
  }
  const st = await claudeCodeStatus(true);
  if (action === "check") return { provider: await claudeCodeEntry() };
  const problem =
    st.state === "not-found"
      ? "Claude Code isn't installed yet (or LifeHarness can't find it)."
      : st.state === "update-required"
        ? `Claude Code ${st.version} is older than LifeHarness needs (${st.minimumVersion}).`
        : st.state === "unchecked"
          ? "LifeHarness couldn't check Claude Code's version."
          : undefined;
  if (problem) return { provider: await claudeCodeEntry(), problem };
  // Start using it, unless a working model was explicitly picked.
  let keptModel: string | undefined;
  let model: string | undefined;
  const picked = s.model;
  saveSettings({ ...s, claudeCode: true });
  if (picked && !picked.startsWith(`${CLAUDE_CODE}/`)) {
    try {
      const m = await resolveModel();
      if (`${m.provider}/${m.id}` === picked) keptModel = m.name;
    } catch {
      /* nothing usable picked */
    }
  }
  if (!keptModel) {
    model = `${CLAUDE_CODE}/sonnet`;
    saveSettings({ ...getSettings(), model });
  }
  return { provider: await claudeCodeEntry(), model, modelName: model ? "Claude Sonnet, through Claude Code" : undefined, keptModel };
}

export async function disconnect(provider: string) {
  if (provider === CLAUDE_CODE) {
    await setClaudeCode("disable");
    return;
  }
  const rt = await runtime();
  await rt.logout(provider);
  const s = getSettings();
  if (s.model?.startsWith(`${provider}/`)) saveSettings({ ...s, model: undefined });
}

// ---- sign-in / key jobs --------------------------------------------------------------------
export type LoginEvent =
  | { type: "started"; job: string }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; code: string; url: string; expiresIn?: number }
  | { type: "info"; message: string; links?: { url: string; label?: string }[] }
  | { type: "progress"; message: string }
  | { type: "prompt"; id: string; kind: AuthPrompt["type"]; message: string; placeholder?: string; options?: { id: string; label: string; description?: string }[] }
  | { type: "prompt_closed"; id: string }
  | { type: "warning"; message: string }
  | { type: "done"; provider: string; model?: string; modelName?: string; keptModel?: string }
  | { type: "error"; message: string };

export interface LoginRequest {
  provider: string;
  method: "oauth" | "api_key";
  /** API key flows: the pasted key answers pi's key prompt, after a test request. */
  key?: string;
  /** GitHub Copilot: enterprise domain (blank = github.com). */
  enterprise?: string;
}

interface Job {
  id: string;
  provider: string;
  abort: AbortController;
  prompts: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>;
}
const g = globalThis as unknown as { __lhLogins?: Map<string, Job> };
const jobs = (g.__lhLogins ??= new Map<string, Job>());

export function answerLogin(jobId: string, promptId: string, value: string): boolean {
  const p = jobs.get(jobId)?.prompts.get(promptId);
  if (!p) return false;
  p.resolve(value);
  return true;
}

export function cancelLogin(jobId: string): boolean {
  const job = jobs.get(jobId);
  job?.abort.abort();
  return !!job;
}

export class LoginError extends Error {}

/** A pasted key: trimmed, single token. pi treats keys starting with "!" as shell commands: refuse. */
export function cleanKey(raw: string): string {
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key) throw new LoginError("Paste a key first.");
  if (key.startsWith("!")) throw new LoginError("That doesn't look like an API key.");
  if (key.length > 512 || /[\s\x00-\x1f\x7f]/.test(key)) throw new LoginError("That doesn't look like an API key (it contains spaces or line breaks).");
  return key;
}

const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : undefined);

function deviceId(): string {
  const f = path.join(/*turbopackIgnore: true*/ path.dirname(authFile()), "device-id");
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ f, "utf8").trim();
  } catch {
    const id = randomUUID();
    fs.writeFileSync(/*turbopackIgnore: true*/ f, id, { mode: 0o600 });
    return id;
  }
}

function harden() {
  try {
    fs.chmodSync(/*turbopackIgnore: true*/ authFile(), 0o600);
  } catch {
    /* not written yet */
  }
}

/** One tiny request with the key held in memory only. Rejected keys are never saved. */
async function testKey(provider: string, key: string, signal: AbortSignal): Promise<{ rejected?: string; warning?: string }> {
  const rt = await runtime();
  const model = recommendedModel(provider, rt.getModels(provider));
  if (!model) return {};
  await rt.setRuntimeApiKey(provider, key);
  try {
    const res = await rt.completeSimple(
      model,
      { systemPrompt: "Reply with the single word: ok", messages: [{ role: "user", content: "ping", timestamp: Date.now() }] },
      { maxTokens: 16, maxRetries: 0, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) },
    );
    if (res.stopReason !== "error") return {};
    const msg = res.errorMessage ?? "unknown error";
    return isAuthFailure(msg) ? { rejected: msg } : { warning: `Saved, but a test request to ${model.name} failed: ${describeModelError(msg, rt.getProvider(provider)?.name).message}` };
  } catch (e) {
    if (signal.aborted) throw e;
    const msg = (e as Error).message;
    return isAuthFailure(msg) ? { rejected: msg } : { warning: `Saved, but the test request failed: ${describeModelError(msg).message}` };
  } finally {
    await rt.removeRuntimeApiKey(provider).catch(() => {});
  }
}

/** After a connect: start using the new provider unless a model that still works was picked. */
async function chooseModelAfterConnect(provider: string): Promise<{ model?: string; modelName?: string; keptModel?: string }> {
  const rt = await runtime();
  const available = await rt.getAvailable();
  const s = getSettings();
  const picked = s.model && available.find((m) => `${m.provider}/${m.id}` === s.model);
  if (picked && picked.provider !== provider) return { keptModel: `${picked.name} (${rt.getProvider(picked.provider)?.name ?? picked.provider})` };
  const rec = recommendedModel(provider, available);
  if (!rec) return {};
  if (!picked) saveSettings({ ...s, model: `${provider}/${rec.id}` });
  return { model: `${provider}/${rec.id}`, modelName: picked ? picked.name : rec.name };
}

export async function runLogin(req: LoginRequest, emit: (e: LoginEvent) => void, signal: AbortSignal): Promise<void> {
  const rt = await runtime();
  const provider = rt.getProvider(req.provider);
  if (!provider) throw new LoginError("Unknown provider.");
  if (req.method === "oauth") {
    if (BLOCKED_SIGN_IN[req.provider]) throw new LoginError(BLOCKED_SIGN_IN[req.provider]);
    if (!provider.auth.oauth) throw new LoginError(`${provider.name} has no sign-in; use an API key.`);
  } else if (!provider.auth.apiKey?.login) throw new LoginError(`${provider.name} can't be set up with a key from here.`);

  // One flow per provider at a time (sign-in callback ports are shared).
  for (const j of jobs.values()) if (j.provider === req.provider) j.abort.abort();
  const job: Job = { id: randomUUID(), provider: req.provider, abort: new AbortController(), prompts: new Map() };
  const onAbort = () => job.abort.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  jobs.set(job.id, job);
  emit({ type: "started", job: job.id });

  try {
    let key: string | undefined;
    if (req.method === "api_key" && req.key !== undefined) {
      key = cleanKey(req.key);
      emit({ type: "progress", message: "Checking the key with one tiny request…" });
      const test = await testKey(req.provider, key, job.abort.signal);
      if (test.rejected) throw new LoginError(`${provider.name} rejected that key (${providerMessage(test.rejected).slice(0, 120)}). Check you copied all of it.`);
      if (test.warning) emit({ type: "warning", message: test.warning });
    }
    const prefill: { secret?: string; text?: string } = { secret: key, text: req.provider === "github-copilot" ? (req.enterprise ?? "") : undefined };

    const interaction: AuthInteraction = {
      signal: job.abort.signal,
      notify(ev: AuthEvent) {
        if (ev.type === "auth_url") {
          const url = safeUrl(ev.url);
          if (url) emit({ type: "auth_url", url, instructions: ev.instructions });
        } else if (ev.type === "device_code") {
          const url = safeUrl(ev.verificationUri);
          if (url) emit({ type: "device_code", code: ev.userCode, url, expiresIn: ev.expiresInSeconds });
        } else if (ev.type === "info") {
          emit({ type: "info", message: ev.message, links: ev.links?.filter((l) => safeUrl(l.url)).map((l) => ({ url: l.url, label: l.label })) });
        } else if (ev.type === "progress") emit({ type: "progress", message: ev.message });
      },
      prompt(p: AuthPrompt) {
        if (p.type === "secret" && prefill.secret !== undefined) {
          const v = prefill.secret;
          prefill.secret = undefined;
          return Promise.resolve(v);
        }
        if (p.type === "text" && prefill.text !== undefined) {
          const v = prefill.text;
          prefill.text = undefined;
          return Promise.resolve(v);
        }
        return new Promise<string>((resolve, reject) => {
          const id = randomUUID();
          const close = (err: Error) => {
            if (!job.prompts.delete(id)) return;
            emit({ type: "prompt_closed", id });
            reject(err);
          };
          job.prompts.set(id, {
            resolve: (v) => {
              job.prompts.delete(id);
              resolve(v);
            },
            reject,
          });
          // e.g. a "paste the redirect URL" fallback that the browser callback made unnecessary
          p.signal?.addEventListener("abort", () => close(new Error("prompt closed")), { once: true });
          job.abort.signal.addEventListener("abort", () => close(new Error("Login cancelled")), { once: true });
          emit({ type: "prompt", id, kind: p.type, message: p.message, placeholder: "placeholder" in p ? p.placeholder : undefined, options: p.type === "select" ? [...p.options] : undefined });
        });
      },
    };

    try {
      await rt.login(req.provider, req.method, interaction, { agentName: "LifeHarness", getDeviceId: deviceId });
    } catch (e) {
      // Saved, but pi couldn't refresh its in-memory snapshot: the next request re-reads it.
      if ((e as Error).name !== "CredentialSynchronizationError") throw e;
    }
    harden();
    emit({ type: "done", provider: req.provider, ...(await chooseModelAfterConnect(req.provider)) });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    emit({ type: "error", message: job.abort.signal.aborted ? "Cancelled." : e instanceof LoginError ? msg : describeLoginError(msg) });
  } finally {
    signal.removeEventListener("abort", onAbort);
    for (const p of job.prompts.values()) p.reject(new Error("closed"));
    jobs.delete(job.id);
  }
}

function describeLoginError(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (/cancel/i.test(text)) return "Cancelled.";
  if (/expired|timed? ?out|timeout/i.test(text)) return "The sign-in took too long and expired. Try again.";
  if (/access_denied|denied/i.test(text)) return "Sign-in was declined in the browser.";
  if (/EADDRINUSE|in use/i.test(text)) return text; // pi's message names the port and the likely culprit
  return describeModelError(text).message;
}
