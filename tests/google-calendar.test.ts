// Google Calendar sync, against a fake Google on 127.0.0.1 (no network, no real account).
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { calendarEvents, type CalendarEvent } from "@/src/core/calendar-events";
import { REMINDER_DEFAULTS, reminderSettings } from "@/src/core/reminders";
import { CATEGORY_KEYS, type DaySchedule, type ScheduledBlock } from "@/src/core/types";
import * as gc from "@/src/server/google-calendar";

// ---- a fake Google ------------------------------------------------------------------------------------
type Ev = { id: string; status: string; summary?: string; extendedProperties?: { private?: Record<string, string> }; reminders?: unknown };
const fake = {
  calendars: new Map<string, Map<string, Ev>>(),
  deleted: new Set<string>(), // Google remembers deleted event ids
  revoked: new Set<string>(),
  writes: 0,
  made: 0, // calendars ever created (ids never repeat, as at Google)
  calls: [] as string[],
  lastTokenForm: {} as Record<string, string>,
};
let base = "";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  let raw = "";
  for await (const c of req) raw += c;
  const send = (status: number, body?: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(body === undefined ? "" : JSON.stringify(body));
  fake.calls.push(`${req.method} ${url.pathname}`);
  if (url.pathname === "/token") {
    const f = Object.fromEntries(new URLSearchParams(raw));
    fake.lastTokenForm = f;
    if (f.grant_type === "authorization_code") return f.code === "good" && f.code_verifier ? send(200, { access_token: "a1", expires_in: 3600, refresh_token: "r1" }) : send(400, { error: "invalid_grant" });
    if (fake.revoked.has(f.refresh_token)) return send(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    return send(200, { access_token: "a2", expires_in: 3600 });
  }
  if (url.pathname === "/revoke") {
    fake.revoked.add(new URLSearchParams(raw).get("token") ?? "");
    return send(200, {});
  }
  if (!/^Bearer a[12]$/.test(req.headers.authorization ?? "")) return send(401, { error: { message: "Invalid Credentials" } });
  const m = /^\/calendar\/v3\/calendars(?:\/([^/]+))?(?:\/events(?:\/([^/]+))?)?$/.exec(url.pathname);
  if (!m) return send(404);
  const [, calId, eventId] = m;
  const isEvents = url.pathname.includes("/events");
  if (!calId && req.method === "POST") {
    const id = `cal${++fake.made}@group.calendar.google.com`;
    fake.calendars.set(id, new Map());
    return send(200, { id, ...JSON.parse(raw) });
  }
  const cal = fake.calendars.get(decodeURIComponent(calId));
  if (!cal) return send(404, { error: { message: "Not Found" } });
  if (!isEvents) return send(200, { id: calId });
  if (req.method === "GET") return send(200, { items: [...cal.values()] });
  if (req.method === "POST") {
    const ev = JSON.parse(raw) as Ev;
    if (cal.has(ev.id) || fake.deleted.has(ev.id)) return send(409, { error: { message: "The requested identifier already exists." } });
    fake.writes++;
    cal.set(ev.id, ev);
    return send(200, ev);
  }
  if (req.method === "PUT") {
    fake.writes++;
    fake.deleted.delete(eventId);
    cal.set(eventId, JSON.parse(raw));
    return send(200, JSON.parse(raw));
  }
  if (req.method === "DELETE") {
    if (!cal.has(eventId)) return send(410);
    fake.writes++;
    cal.delete(eventId);
    fake.deleted.add(eventId);
    return send(204);
  }
  send(405);
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LIFEHARNESS_GOOGLE_AUTH_URL = `${base}/auth`;
  process.env.LIFEHARNESS_GOOGLE_TOKEN_URL = `${base}/token`;
  process.env.LIFEHARNESS_GOOGLE_REVOKE_URL = `${base}/revoke`;
  process.env.LIFEHARNESS_GOOGLE_API_URL = `${base}/calendar/v3`;
});
afterAll(() => server.close());

let dir = "";
beforeEach(() => {
  gc.cancelConnect();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-google-"));
  process.env.LIFEHARNESS_AUTH_FILE = path.join(dir, "auth.json"); // the private folder: this test's own
  fake.calendars.clear();
  fake.deleted.clear();
  fake.revoked.clear();
  fake.writes = 0;
  fake.calls = [];
});
afterEach(() => {
  gc.cancelConnect();
  fs.rmSync(dir, { recursive: true, force: true });
});
const store = () => path.join(dir, "google-calendar.json");
const connected = (extra = {}) =>
  fs.writeFileSync(store(), JSON.stringify({ clientId: "1-x.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret", refreshToken: "r1", accessToken: "a1", accessExpires: Date.now() + 3_600_000, ...extra }), { mode: 0o600 });
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 30));
};

// ---- the events --------------------------------------------------------------------------------------
const TODAY = "2026-11-20";
const block = (b: Partial<ScheduledBlock> & { key: string; start: number; end: number }): ScheduledBlock => ({ title: b.key, category: CATEGORY_KEYS[0], source: "block", core: false, tracked: true, ...b });
const day = (date: string, blocks: ScheduledBlock[]) => ({ date, day: "fri", wake: 360, bed: 1380, blocks, warnings: [] }) as unknown as DaySchedule;
const ev = (key: string, summary = key, start = "09:00"): CalendarEvent => ({
  key: `${TODAY}:${key}`,
  summary,
  description: "From your LifeHarness plan.",
  start: { dateTime: `${TODAY}T${start}:00`, timeZone: "UTC" },
  end: { dateTime: `${TODAY}T10:00:00`, timeZone: "UTC" },
  reminderMin: 0,
});
const want = (events: CalendarEvent[]) => ({ events, from: TODAY, to: "2026-12-04", tz: "UTC" });

describe("which events the calendar holds", () => {
  it("plan blocks (prayers only with prayer reminders on), with the reminder setting and if-then plan", () => {
    const days = [
      day("2026-11-19", [block({ key: "block:yesterday", start: 540, end: 600 })]),
      day(TODAY, [
        block({ key: "block:read", title: "Read", start: 540, end: 600, ifThen: "If coffee, then book" }),
        block({ key: "block:late", title: "Wind down", start: 1410, end: 1470 }), // runs past midnight
        block({ key: "fixed:work", source: "fixed", start: 600, end: 1020 }),
        block({ key: "sleep:night", source: "sleep", start: 1380, end: 1800 }),
        block({ key: "prayer:dhuhr", source: "prayer", title: "Dhuhr", start: 700, end: 720 }),
      ]),
    ];
    const o = { tz: "Africa/Cairo", from: TODAY, to: "2026-12-04" };
    const plain = calendarEvents(days, { ...o, reminders: reminderSettings({ before: 10 }) });
    expect(plain.map((e) => e.summary)).toEqual(["Read", "Wind down"]);
    expect(plain[0]).toEqual({
      key: `${TODAY}:block:read`,
      summary: "Read",
      description: "If-then: If coffee, then book\nFrom your LifeHarness plan.",
      start: { dateTime: "2026-11-20T09:00:00", timeZone: "Africa/Cairo" },
      end: { dateTime: "2026-11-20T10:00:00", timeZone: "Africa/Cairo" },
      reminderMin: 10,
    });
    expect((plain[1].end as { dateTime: string }).dateTime).toBe("2026-11-21T00:30:00");
    const withPrayers = calendarEvents(days, { ...o, reminders: reminderSettings({ prayers: true, blocks: false }) });
    expect(withPrayers.map((e) => [e.summary, e.reminderMin])).toEqual([["Read", null], ["Wind down", null], ["Dhuhr", 0]]);
    expect(REMINDER_DEFAULTS.prayers).toBe(false);
  });
});

describe("connecting", () => {
  it("refuses something that isn't a Google client", async () => {
    await expect(gc.startConnect("not-a-client", "GOCSPX-test-secret")).rejects.toThrow(/Client ID/);
    await expect(gc.startConnect("1-x.apps.googleusercontent.com", "x")).rejects.toThrow(/Client secret/);
  });

  it("signs in with PKCE through a one-shot callback on 127.0.0.1, and the page never sees the secret or tokens", async () => {
    const { authUrl } = await gc.startConnect(" 1-x.apps.googleusercontent.com ", "GOCSPX-test-secret");
    const q = new URL(authUrl).searchParams;
    expect(authUrl.startsWith(`${base}/auth?`)).toBe(true);
    expect(Object.fromEntries(q)).toMatchObject({ scope: gc.SCOPE, access_type: "offline", prompt: "consent", code_challenge_method: "S256", response_type: "code" });
    const redirect = q.get("redirect_uri")!;
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(gc.googleStatus().connecting).toBe(true);

    expect((await fetch(`${redirect}?code=good&state=forged`)).status).toBe(404); // a stray request is ignored
    expect(gc.googleStatus().connecting).toBe(true);
    const done = await fetch(`${redirect}?code=good&state=${q.get("state")}`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("connected to Google Calendar");
    expect(fake.lastTokenForm).toMatchObject({ grant_type: "authorization_code", code: "good", redirect_uri: redirect, client_secret: "GOCSPX-test-secret" });
    expect(fake.lastTokenForm.code_verifier?.length).toBeGreaterThan(40);

    await until(() => !!gc.googleStatus().lastSync); // the first sync runs straight away
    const status = gc.googleStatus();
    expect(status).toMatchObject({ configured: true, connected: true, connecting: false, calendar: "LifeHarness" });
    expect(JSON.stringify(status)).not.toMatch(/GOCSPX|"r1"|"a1"|refresh|access/i);
    if (process.platform !== "win32") expect(fs.statSync(store()).mode & 0o077).toBe(0);
  });

  it("you saying no leaves nothing connected, with a plain message", async () => {
    const { authUrl } = await gc.startConnect("1-x.apps.googleusercontent.com", "GOCSPX-test-secret");
    const q = new URL(authUrl).searchParams;
    expect((await fetch(`${q.get("redirect_uri")}?error=access_denied&state=${q.get("state")}`)).status).toBe(400);
    expect(gc.googleStatus()).toMatchObject({ connected: false, connecting: false, error: expect.stringMatching(/didn't allow access/) });
  });
});

describe("syncing", () => {
  it("creates the calendar once, then writes only what changed; past days and your own events stay", async () => {
    connected();
    expect(await gc.syncOnce(want([ev("block:a"), ev("block:b")]))).toEqual({ events: 2, changed: 2 });
    expect(fake.calendars.size).toBe(1);
    const cal = [...fake.calendars.values()][0];
    const a = [...cal.values()].find((e) => e.summary === "block:a")!;
    expect(a.id).toMatch(/^lh[0-9a-f]{40}$/);
    expect(a.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });

    const writes = fake.writes;
    expect(await gc.syncOnce(want([ev("block:a"), ev("block:b")]))).toEqual({ events: 2, changed: 0 });
    expect(fake.writes).toBe(writes);

    cal.set("mine", { id: "mine", status: "confirmed", summary: "Dentist" }); // added by you: no LifeHarness key
    cal.set("lhold", { id: "lhold", status: "confirmed", extendedProperties: { private: { lh: "2026-11-19:block:a" } } }); // yesterday
    expect(await gc.syncOnce(want([ev("block:a", "A, renamed"), ev("block:c")]))).toEqual({ events: 2, changed: 3 }); // update a, add c, remove b
    expect([...cal.values()].map((e) => e.summary).sort()).toEqual(["A, renamed", "Dentist", "block:c", undefined].sort());
    expect(fake.calendars.size).toBe(1);
  });

  it("an event deleted in Google comes back; a deleted calendar is made again", async () => {
    connected();
    await gc.syncOnce(want([ev("block:a")]));
    const [calId, cal] = [...fake.calendars.entries()][0];
    const [id] = cal.keys();
    cal.delete(id);
    fake.deleted.add(id); // you deleted it in Google Calendar
    expect(await gc.syncOnce(want([ev("block:a")]))).toEqual({ events: 1, changed: 1 });
    expect(cal.has(id)).toBe(true);

    fake.calendars.delete(calId); // you deleted the whole calendar
    expect(await gc.syncOnce(want([ev("block:a")]))).toEqual({ events: 1, changed: 1 });
    expect(fake.calendars.size).toBe(1);
    expect(JSON.parse(fs.readFileSync(store(), "utf8")).calendarId).not.toBe(calId);
  });

  it("refreshes an expired access token; a withdrawn permission disconnects with a clear message", async () => {
    connected({ accessExpires: Date.now() - 1000 });
    await gc.syncOnce(want([]));
    expect(fake.calls).toContain("POST /token");
    expect(JSON.parse(fs.readFileSync(store(), "utf8")).accessToken).toBe("a2");

    fake.revoked.add("r1"); // you removed LifeHarness from your Google account
    connected({ accessExpires: Date.now() - 1000 });
    const status = await gc.syncNow();
    expect(status).toMatchObject({ connected: false, configured: true, error: expect.stringMatching(/ended the connection/) });
  });

  it("disconnecting withdraws the permission at Google and forgets everything here", async () => {
    connected();
    await gc.disconnect();
    expect(fake.revoked.has("r1")).toBe(true);
    expect(fs.existsSync(store())).toBe(false);
    expect(gc.googleStatus()).toMatchObject({ configured: false, connected: false });
  });
});
