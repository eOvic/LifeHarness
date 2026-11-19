// Model and sign-in failures, in words a person can act on. The raw text stays in the session
// record (and logs); the page shows the friendly version plus one action.
export type ErrorAction = "connect" | "retry";

export interface FriendlyError {
  message: string;
  action?: ErrorAction;
}

export const isAuthFailure = (raw: string) =>
  /\b401\b|invalid[_ ]?(?:x-)?api[_ -]?key|incorrect api key|api key not valid|invalid authentication|authentication[_ ]error|unauthori[sz]ed|no auth(?:entication)? credentials|invalid_grant|token (?:has )?expired|refresh token|re-?authenticate|OAuth auth derivation failed|no api key/i.test(
    raw,
  );

/** The human part of a provider error: `401 {"error":{"message":"invalid x-api-key"}}` → "invalid x-api-key". */
export function providerMessage(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const quoted = [...text.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter(Boolean);
  if (quoted.length) return quoted[quoted.length - 1].replace(/\\"/g, '"');
  return text.replace(/^\d{3}\s+/, "");
}

export function describeModelError(raw: string, provider?: string): FriendlyError {
  const who = provider || "The AI provider";
  const text = raw.replace(/\s+/g, " ").trim();
  if (/No AI model is connected|No model is configured/i.test(text)) return { message: text, action: "connect" };
  // Claude Code (claude-code.ts writes these in full already)
  if (/^Claude Code (isn't installed|isn't signed in|[\d.]+ is older)|couldn't check Claude Code/i.test(text)) return { message: text, action: "connect" };
  if (/Not logged in|Please run \/login|authentication_failed/i.test(text)) {
    return { message: "Claude Code isn't signed in. In a terminal, run: claude auth login (Anthropic's own sign-in), then retry.", action: "connect" };
  }
  if (/Claude usage limit is reached|usage limit reached/i.test(text)) return { message: text.startsWith("Claude Code reports") ? text : `${who}: your plan's usage limit is reached. Wait for it to reset, or switch model in Settings.`, action: "retry" };
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(text)) {
    return { message: "Part of LifeHarness's AI engine is missing from this install. Reinstall or update LifeHarness.", action: "retry" };
  }
  if (isAuthFailure(text)) return { message: `${who} didn't accept the saved sign-in or key. Reconnect it in Settings → AI models.`, action: "connect" };
  if (/\b429\b|rate.?limit|quota|usage limit|too many requests|insufficient_quota|credit balance|billing/i.test(text)) {
    return { message: `${who} says you've hit a usage or billing limit (${short(providerMessage(text))}). Wait a bit, add credit, or switch model in Settings.`, action: "retry" };
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up|getaddrinfo/i.test(text)) {
    return { message: `Couldn't reach ${who}. Check your internet connection, then retry.`, action: "retry" };
  }
  if (/\b5\d\d\b|overloaded|server error|unavailable/i.test(text)) return { message: `${who} is having trouble right now (${short(providerMessage(text))}). Retry in a minute.`, action: "retry" };
  return { message: short(providerMessage(text), 400) || "The model request failed.", action: "retry" };
}

function short(s: string, n = 160) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
