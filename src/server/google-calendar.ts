// Google Calendar sync: LifeHarness keeps its own "LifeHarness" calendar in your Google account in step
// with your plan, so your phone's calendar reminds you even when the computer is off.
//
//   - Your own Google Cloud OAuth client (type "Desktop app"), entered in Settings. Google reviews apps
//     before they can share one client with everyone; your own needs no review for your own account.
//   - One scope: calendar.app.created ("make secondary calendars, and manage events on them"). LifeHarness
//     can only touch the calendar it creates, never your other calendars.
//   - Sign-in: OAuth 2.0 for installed apps, with PKCE, through a one-shot listener on 127.0.0.1.
//   - Stored in <private folder>/google-calendar.json (readable only by you): the client, the tokens, the
//     calendar's id and the last sync. Never sent to the page, never logged.
//   - Sync: the next 14 days (src/core/calendar-events.ts). Each event has a stable id and a content hash,
//     so a sync only writes what changed. Days before today, and events you add yourself, are left alone.
//     Runs after you connect, adopt a plan or change your profile or reminders, every few hours, and on
//     "Sync now".
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { calendarEvents, type CalendarEvent } from "../core/calendar-events";
import { reminderSettings } from "../core/reminders";
import { addDays, zonedToUtc } from "../core/time";
import { privateDir } from "./config-dir";
import { clock, scheduleDays } from "./schedule";
import { getSettings, replaceFile } from "./store";

export const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CALENDAR_NAME = "LifeHarness";
export const WINDOW_DAYS = 14;

/** Google's endpoints. Tests may point them at a fake on 127.0.0.1, and only there. */
const endpoint = (env: string, real: string) => {
  const v = process.env[env];
  return v && /^http:\/\/127\.0\.0\.1:\d+\//.test(v) ? v.replace(/\/$/, "") : real;
};
const URLS = () => ({
  auth: endpoint("LIFEHARNESS_GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
  token: endpoint("LIFEHARNESS_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  revoke: endpoint("LIFEHARNESS_GOOGLE_REVOKE_URL", "https://oauth2.googleapis.com/revoke"),
  api: endpoint("LIFEHARNESS_GOOGLE_API_URL", "https://www.googleapis.com/calendar/v3"),
});

// ---- the private file ----------------------------------------------------------------------------
interface Saved {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  accessExpires?: number;
  calendarId?: string;
  connectedAt?: string;
  lastSync?: { at: string; events: number; changed: number };
  error?: string;
}
const file = () => path.join(/*turbopackIgnore: true*/ privateDir(), "google-calendar.json");
function load(): Saved {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file(), "utf8"));
  } catch {
    return {};
  }
}
function save(patch: Partial<Saved>) {
  const next = { ...load(), ...patch };
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file()), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(next, null, 1), { mode: 0o600 });
  replaceFile(tmp, file());
}

/** A problem the person can fix (shown as is). */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

// ---- process-wide state (survives dev reloads) ------------------------------------------------------
type Pending = { server: http.Server; state: string; verifier: string; redirect: string; authUrl: string; timer: NodeJS.Timeout };
const g = globalThis as unknown as { __lhGoogle?: { pending: Pending | null; running: Promise<void> | null; again: boolean; soon?: NodeJS.Timeout; loop?: NodeJS.Timeout } };
const st = (g.__lhGoogle ??= { pending: null, running: null, again: false });

// ---- status (what the page sees: no client secret, no tokens) ---------------------------------------
export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  authUrl?: string;
  calendar: string;
  clientId?: string;
  lastSync?: Saved["lastSync"];
  syncing: boolean;
  error?: string;
}
export function googleStatus(): GoogleStatus {
  const s = load();
  return {
    configured: !!(s.clientId && s.clientSecret),
    connected: !!s.refreshToken,
    connecting: !!st.pending,
    authUrl: st.pending?.authUrl,
    calendar: CALENDAR_NAME,
    clientId: s.clientId, // the public half of the client: lets the page show which one
    lastSync: s.lastSync,
    syncing: !!st.running,
    error: s.error,
  };
}

// ---- sign-in ------------------------------------------------------------------------------------------
const b64url = (b: Buffer) => b.toString("base64url");

/** Start signing in: returns the Google page to open in the browser. */
export async function startConnect(clientId?: string, clientSecret?: string): Promise<{ authUrl: string }> {
  const saved = load();
  clientId = (clientId || saved.clientId || "").trim(); // reconnecting: the saved client
  clientSecret = (clientSecret || saved.clientSecret || "").trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new GoogleError("That doesn't look like a Client ID: it ends in .apps.googleusercontent.com.");
  if (!/^[\w-]{10,100}$/.test(clientSecret)) throw new GoogleError("That doesn't look like a Client secret.");
  finishConnect();
  save({ clientId, clientSecret, error: undefined });
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const server = http.createServer((req, res) => void onCallback(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  const authUrl = `${URLS().auth}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // a refresh token: the connection lasts
    prompt: "consent", // always ask, so Google always sends one
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
  const timer = setTimeout(() => finishConnect("Sign-in timed out. Connect again when you're ready."), 10 * 60_000);
  timer.unref?.();
  st.pending = { server, state, verifier, redirect, authUrl, timer };
  return { authUrl };
}

export function cancelConnect() {
  finishConnect();
}

function finishConnect(error?: string) {
  const p = st.pending;
  if (!p) return;
  clearTimeout(p.timer);
  p.server.close();
  st.pending = null;
  if (error) save({ error });
}

/** Google sends the browser back here with a code (or an error). */
async function onCallback(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const p = st.pending;
  if (url.pathname !== "/callback" || !p || url.searchParams.get("state") !== p.state) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return; // a stray request: keep waiting for the real one
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code) {
    const msg = error === "access_denied" ? "You didn't allow access, so nothing was connected." : `Google didn't connect: ${error ?? "no code"}.`;
    page(res, false, msg);
    finishConnect(msg);
    return;
  }
  try {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: p.redirect, code_verifier: p.verifier });
    if (!t.refresh_token) throw new GoogleError("Google didn't send a lasting permission. Connect again.");
    save({ refreshToken: t.refresh_token, accessToken: t.access_token, accessExpires: Date.now() + t.expires_in * 1000, connectedAt: new Date().toISOString(), error: undefined });
    page(res, true);
    finishConnect();
    void syncNow(); // fill the calendar straight away
  } catch (e) {
    const msg = describe(e);
    page(res, false, msg);
    finishConnect(msg);
  }
}

function page(res: http.ServerResponse, ok: boolean, message = "") {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const title = ok ? "LifeHarness is connected to Google Calendar" : "LifeHarness couldn't connect";
  const body = ok ? "Your plan is going into the “LifeHarness” calendar. You can close this tab." : esc(message);
  res
    .writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" })
    .end(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:34em;margin:15vh auto;padding:0 1em;color:#222"><h1 style="font-size:1.3em">${title}</h1><p>${body}</p></body>`,
    );
}

// ---- tokens and API calls -----------------------------------------------------------------------------
async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const s = load();
  const r = await fetch(URLS().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: s.clientId ?? "", client_secret: s.clientSecret ?? "", ...params }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string; access_token: string; expires_in: number; refresh_token?: string };
  if (!r.ok) throw new GoogleError(j.error_description || j.error || `Google answered ${r.status}.`, j.error);
  return j;
}

async function accessToken(): Promise<string> {
  const s = load();
  if (!s.refreshToken) throw new GoogleError("Not connected to Google Calendar.", "not_connected");
  if (s.accessToken && (s.accessExpires ?? 0) - Date.now() > 60_000) return s.accessToken;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken });
    save({ accessToken: t.access_token, accessExpires: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleError && (e.code === "invalid_grant" || e.code === "unauthorized_client")) {
      save({ refreshToken: undefined, accessToken: undefined, accessExpires: undefined });
      throw new GoogleError("Google ended the connection (its permission was removed or expired). Connect again.", "disconnected");
    }
    throw e;
  }
}

async function api(method: string, p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(URLS().api + p, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = r.status === 204 ? null : ((await r.json().catch(() => null)) as Record<string, unknown> | null);
  return { status: r.status, json };
}

const apiError = (r: { status: number; json: Record<string, unknown> | null }) => {
  const e = r.json?.error as { message?: string } | undefined;
  return new GoogleError(`Google Calendar answered ${r.status}${e?.message ? `: ${e.message}` : "."}`);
};

function describe(e: unknown): string {
  if (e instanceof GoogleError) return e.message;
  const m = String((e as Error)?.message ?? e);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(m) ? "Couldn't reach Google. LifeHarness tries again later." : m;
}

// ---- sync ---------------------------------------------------------------------------------------------
const eventId = (key: string) => `lh${createHash("sha256").update(key).digest("hex").slice(0, 40)}`; // base32hex, as Google requires
const contentHash = (e: CalendarEvent) => createHash("sha256").update(JSON.stringify([e.summary, e.description, e.start, e.end, e.reminderMin])).digest("hex").slice(0, 16);

function eventBody(e: CalendarEvent) {
  return {
    id: eventId(e.key),
    status: "confirmed",
    summary: e.summary,
    description: e.description,
    start: e.start,
    end: e.end,
    reminders: { useDefault: false, overrides: e.reminderMin == null ? [] : [{ method: "popup", minutes: e.reminderMin }] },
    extendedProperties: { private: { lh: e.key, lhHash: contentHash(e) } },
  };
}

/** The LifeHarness calendar's id, creating it (again, if you deleted it) when needed. */
async function ensureCalendar(tz: string): Promise<string> {
  const id = load().calendarId;
  if (id) {
    const r = await api("GET", `/calendars/${encodeURIComponent(id)}`);
    if (r.status === 200) return id;
    if (r.status !== 404) throw apiError(r);
  }
  const r = await api("POST", "/calendars", { summary: CALENDAR_NAME, description: "Your LifeHarness plan. LifeHarness keeps it up to date.", timeZone: tz });
  if (r.status !== 200 || typeof r.json?.id !== "string") throw apiError(r);
  save({ calendarId: r.json.id });
  return r.json.id;
}

/** What the calendar should hold now, from the plan in force. */
export function desiredEvents(): { events: CalendarEvent[]; from: string; to: string; tz: string } {
  const { tz, today } = clock();
  const to = addDays(today, WINDOW_DAYS);
  const { days } = scheduleDays(3); // this week and the next two: covers today + 14 days
  return { events: calendarEvents(days, { tz, from: today, to, reminders: reminderSettings(getSettings().reminders) }), from: today, to, tz };
}

/** One pass: make the calendar's events in the window match `want`. Exported for tests. */
export async function syncOnce(want = desiredEvents()): Promise<{ events: number; changed: number }> {
  const cal = encodeURIComponent(await ensureCalendar(want.tz));
  // What's there now, in the window (only our events: they carry their key).
  const have = new Map<string, { key: string; hash?: string }>();
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      timeMin: zonedToUtc(want.from, 0, want.tz).toISOString(),
      timeMax: zonedToUtc(want.to, 0, want.tz).toISOString(),
      singleEvents: "true",
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await api("GET", `/calendars/${cal}/events?${q}`);
    if (r.status !== 200) throw apiError(r);
    for (const ev of (r.json?.items as { id: string; extendedProperties?: { private?: { lh?: string; lhHash?: string } } }[]) ?? []) {
      const priv = ev.extendedProperties?.private;
      if (priv?.lh) have.set(ev.id, { key: priv.lh, hash: priv.lhHash });
    }
    pageToken = r.json?.nextPageToken as string | undefined;
  } while (pageToken);

  let changed = 0;
  const wanted = new Set<string>();
  for (const e of want.events) {
    const body = eventBody(e);
    wanted.add(body.id);
    const now = have.get(body.id);
    if (now?.hash === body.extendedProperties.private.lhHash) continue; // unchanged
    let r = now ? await api("PUT", `/calendars/${cal}/events/${body.id}`, body) : await api("POST", `/calendars/${cal}/events`, body);
    if (r.status === 409) r = await api("PUT", `/calendars/${cal}/events/${body.id}`, body); // deleted before: Google keeps its id
    if (r.status !== 200) throw apiError(r);
    changed++;
  }
  // Ours, in the window, from today on, no longer in the plan: remove.
  for (const [id, { key }] of have) {
    const date = key.slice(0, 10);
    if (wanted.has(id) || date < want.from || date >= want.to) continue;
    const r = await api("DELETE", `/calendars/${cal}/events/${id}`);
    if (![200, 204, 404, 410].includes(r.status)) throw apiError(r);
    changed++;
  }
  return { events: want.events.length, changed };
}

/** Sync now (one at a time: a request during a sync runs one more pass after it). */
export async function syncNow(): Promise<GoogleStatus> {
  if (!load().refreshToken) return googleStatus();
  if (st.running) {
    st.again = true;
    await st.running;
    return googleStatus();
  }
  st.running = (async () => {
    do {
      st.again = false;
      try {
        const r = await syncOnce();
        save({ lastSync: { at: new Date().toISOString(), ...r }, error: undefined });
      } catch (e) {
        save({ error: describe(e) });
      }
    } while (st.again);
  })().finally(() => {
    st.running = null;
  });
  await st.running;
  return googleStatus();
}

/** After a change to the plan, profile or reminders: sync shortly (changes in a burst become one sync). */
export function syncSoon(delayMs = 2000) {
  if (!load().refreshToken) return;
  if (st.soon) clearTimeout(st.soon);
  st.soon = setTimeout(() => void syncNow(), delayMs);
  st.soon.unref?.();
}

/** Keep the 14 days rolling: sync if the last one is over 6 hours old (checked every 30 minutes). */
export function startGoogleSchedule() {
  if (st.loop) return;
  const due = () => {
    const s = load();
    if (s.refreshToken && (!s.lastSync || Date.now() - Date.parse(s.lastSync.at) > 6 * 3_600_000)) void syncNow();
  };
  st.loop = setInterval(due, 30 * 60_000);
  st.loop.unref?.();
  setTimeout(due, 20_000).unref?.();
}

/** Forget everything stored for Google, and withdraw the permission at Google. The calendar stays. */
export async function disconnect() {
  finishConnect();
  const s = load();
  if (s.refreshToken) {
    await fetch(URLS().revoke, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: s.refreshToken }) }).catch(() => {});
  }
  fs.rmSync(/*turbopackIgnore: true*/ file(), { force: true });
}
