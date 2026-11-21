// Reminders, end to end in the packaged app. Notifications are captured inside the app (nothing pops up).
// Checks that the server lists reminders, that the shell shows one at its time (the evening check-in,
// moved to about a minute from now) and that clicking it opens Today. Also that "start at login" writes
// and removes the autostart entry (Linux; in a scratch config folder), and that closing the window keeps
// the app running in the tray and says so once.
//   npx tsx scripts/qa-reminders.ts --exe dist-desktop/linux-unpacked/lifeharness --data <copy of demo data>
// The demo day needs blocks before now that aren't marked (seed data: anytime after the first block).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg("--exe");
const data = arg("--data");
if (!exe || !data) {
  console.error("usage: npx tsx scripts/qa-reminders.ts --exe <packaged app> --data <demo data copy>");
  process.exit(2);
}
type Shown = { title: string; body: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];
let failed = false;
const check = (ok: boolean, what: string, detail = "") => {
  lines.push(`${ok ? "✓" : "✗"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
};

const config = fs.mkdtempSync(path.join(os.tmpdir(), "lh-qa-rem-config-"));
const app = await electron.launch({
  executablePath: exe,
  args: process.platform === "linux" ? ["--no-sandbox"] : [],
  env: { ...process.env, LIFEHARNESS_DATA_DIR: data, XDG_CONFIG_HOME: config } as Record<string, string>,
  timeout: 60_000,
});
try {
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  // Capture notifications in the main process instead of showing them.
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { __shown: Electron.Notification[] };
    g.__shown = [];
    Notification.prototype.show = function (this: Electron.Notification) {
      g.__shown.push(this);
    };
  });
  const shown = () => app.evaluate(() => (globalThis as unknown as { __shown: Electron.Notification[] }).__shown.map((n) => ({ title: n.title, body: n.body }))) as Promise<Shown[]>;
  const api = <T>(p: string, body?: object) =>
    page.evaluate(
      async ([p, body]) => {
        const r = await fetch(p as string, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
        return r.json();
      },
      [p, body] as const,
    ) as Promise<T>;
  const refresh = () => page.evaluate(() => (window as unknown as { lifeharness: { refreshShell: () => void } }).lifeharness.refreshShell());

  // 1) The list, with the evening check-in moved to about a minute from now (in the profile's timezone).
  //    The demo marks today's earlier blocks, and a fully marked day gets no check-in (correct), so
  //    first unmark today's marks, as the Today page does when you click a mark again.
  const week = await api<{ today: string; marks: Record<string, Record<string, unknown>> }>("/api/schedule");
  for (const key of Object.keys(week.marks[week.today] ?? {})) await api("/api/track", { date: week.today, key, status: null });
  const tz = (await api<{ profile: { timezone?: string } }>("/api/profile")).profile.timezone || "UTC";
  const soon = await page.evaluate((tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Date.now() + 75_000)), tz);
  await api("/api/settings", { reminders: { blocks: true, evening: true, eveningAt: soon } });
  const list = await api<{ items: { id: string; at: string; title: string; body: string }[] }>("/api/reminders");
  const kinds = [...new Set(list.items.map((r) => r.id.split(":")[0]))].join(", ");
  check(Array.isArray(list.items) && list.items.length > 0, "the server lists the next 36 hours of reminders", `${list.items.length} (${kinds})`);
  const evening = list.items.find((r) => r.id === `evening:${week.today}`);
  const inSec = evening ? Math.round((Date.parse(evening.at) - Date.now()) / 1000) : NaN;
  check(!!evening && inSec > 0 && inSec < 120, `today's evening check-in is due at ${soon}`, evening ? `in ${inSec}s · ${evening.body}` : "none: no block before now today?");

  // 2) The shell schedules it and shows it on time; 3) clicking it opens Today.
  if (evening) {
    await refresh();
    const t0 = Date.now();
    let got: Shown | undefined;
    while (!got && Date.now() - t0 < 150_000) {
      await sleep(1000);
      got = (await shown()).find((n) => n.title === "Mark today");
    }
    const late = Math.round((Date.now() - Date.parse(evening.at)) / 1000);
    check(!!got, "the shell showed it at its time", got ? `"${got.title}: ${got.body}" (${late}s after it was due)` : "never shown");
    if (got) {
      // Start from another page (the demo opens on Today), so the click's navigation is the one we see.
      await page.goto(new URL(page.url()).origin + "/week", { waitUntil: "networkidle" });
      await app.evaluate(() => (globalThis as unknown as { __shown: Electron.Notification[] }).__shown.find((n) => n.title === "Mark today")!.emit("click"));
      await page.waitForURL(/\/today$/, { timeout: 15_000 }).then(
        () => check(true, "clicking it opens Today"),
        () => check(false, "clicking it opens Today", page.url()),
      );
      await page.waitForLoadState("networkidle"); // let Today finish loading before the next calls
    }
  }

  // 4) Start at login: the autostart entry appears, then goes (Linux; in the scratch config folder).
  if (process.platform === "linux") {
    const entry = path.join(config, "autostart", "lifeharness.desktop");
    await api("/api/settings", { atLogin: true });
    await refresh();
    await sleep(800);
    const text = fs.existsSync(entry) ? fs.readFileSync(entry, "utf8") : "";
    check(/^Exec=".+" --background/m.test(text), "start at login writes an autostart entry that starts in the background", text.match(/^Exec=.*$/m)?.[0] ?? "missing");
    await api("/api/settings", { atLogin: false });
    await refresh();
    await sleep(800);
    check(!fs.existsSync(entry), "turning it off removes the entry");
  }

  // 4b) Settings → Reminders → "Send a test reminder": the shell reports what the system did with it.
  //     Notifications are captured here, so play the system: refuse one (as macOS does for an app it
  //     can't verify), then show one.
  type Bridge = { testReminder: () => Promise<{ result: string; error?: string }>; shellInfo: () => Promise<{ atLoginSupported: boolean; notifications?: string }> };
  const answer = async (event: "failed" | "show") => {
    await page.evaluate(() => {
      const w = window as unknown as { lifeharness: Bridge; __test: Promise<unknown> };
      w.__test = w.lifeharness.testReminder();
    });
    for (let i = 0; i < 50 && !(await shown()).some((n) => n.title === "Reminders work"); i++) await sleep(100);
    await app.evaluate((_e, ev) => {
      const list = (globalThis as unknown as { __shown: Electron.Notification[] }).__shown;
      const n = list.filter((x) => x.title === "Reminders work").pop()!;
      list.splice(list.indexOf(n), 1);
      if (ev === "failed") n.emit("failed", {}, "Notifications are not allowed for this application");
      else n.emit("show", {});
    }, event);
    const result = await page.evaluate(() => (window as unknown as { __test: Promise<{ result: string; error?: string }> }).__test);
    const info = await page.evaluate(() => (window as unknown as { lifeharness: Bridge }).lifeharness.shellInfo());
    return { result, info };
  };
  const refused = await answer("failed");
  check(
    refused.result.result === "failed" && /not allowed/.test(refused.result.error ?? "") && refused.info.notifications === "failed",
    "a refused test reminder is reported, with the system's reason, and Settings learns of it",
    JSON.stringify(refused),
  );
  const ok = await answer("show");
  check(ok.result.result === "shown" && ok.info.notifications === "shown" && ok.info.atLoginSupported === true, "a shown one is reported as shown", JSON.stringify(ok));

  // 5) Closing the window keeps the app (and its reminders) running, and says so once.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await sleep(2000);
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => -1);
  check(windows === 0, "closing the window keeps LifeHarness running in the background", windows === -1 ? "the app quit" : `${windows} windows open`);
  check((await shown()).some((n) => /still running/.test(n.title)), 'it says so once ("LifeHarness is still running")');
} catch (err) {
  check(false, "the run finished", String((err as Error).message ?? err).split("\n")[0]);
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  await app.close().catch(() => {});
  if (failed) {
    const log = path.join(config, "LifeHarness", "logs", "main.log");
    if (fs.existsSync(log)) lines.push("\nshell log (last lines):", ...fs.readFileSync(log, "utf8").trim().split("\n").slice(-12));
  }
  fs.rmSync(config, { recursive: true, force: true });
}
console.log(lines.join("\n"));
console.log(failed ? "\nreminder checks FAILED" : "\nall reminder checks passed");
process.exit(failed ? 1 : 0);
