// README images, always from invented demo data (scripts/seed-demo.ts), never from a real session.
//   npx tsx scripts/readme-shots.ts [--exe dist-desktop/linux-unpacked/lifeharness] [--out docs/assets]
// Drives the packaged app with a scratch config. The hero shot is taken with X11 `import` so it
// includes the native window buttons (falls back to a page screenshot elsewhere).
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const exe = arg("--exe", "dist-desktop/linux-unpacked/lifeharness");
const out = arg("--out", "docs/assets");
fs.mkdirSync(out, { recursive: true });

const seed = (...flags: string[]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-readme-"));
  execSync(`npx tsx scripts/seed-demo.ts ${dir} ${flags.join(" ")}`, { stdio: "ignore" });
  return dir;
};

async function withApp(data: string, fn: (page: import("playwright-core").Page, origin: string, pid: number) => Promise<void>) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "lh-readme-config-"));
  const app = await electron.launch({ executablePath: exe, args: ["--no-sandbox"], env: { ...process.env, LIFEHARNESS_DATA_DIR: data, XDG_CONFIG_HOME: config } as Record<string, string> });
  const page = await app.firstWindow();
  await page.waitForLoadState("networkidle");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 900);
  });
  await page.waitForTimeout(400);
  try {
    await fn(page, new URL(page.url()).origin, await app.evaluate(() => process.pid));
  } finally {
    await app.close();
  }
}

const go = async (page: import("playwright-core").Page, url: string) => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
};

/** The real window, native title-bar buttons included (X11 only). */
function windowShot(pid: number, file: string): boolean {
  try {
    const ids = execSync(`xwininfo -root -tree | grep '"LifeHarness"' | awk '{print $1}'`, { encoding: "utf8" }).trim().split("\n");
    for (const id of ids) {
      const owner = execSync(`xprop -id ${id} _NET_WM_PID 2>/dev/null || true`, { encoding: "utf8" });
      if (owner.includes(String(pid))) {
        execSync(`import -window ${id} ${file}`);
        return true;
      }
    }
  } catch {
    /* not X11 */
  }
  return false;
}

const week = seed();
await withApp(week, async (page, origin, pid) => {
  const csp = await page.evaluate(async () => (await fetch("/today")).headers.get("content-security-policy"));
  console.log(`CSP served: ${csp ? "yes" : "NO"}`);
  await go(page, `${origin}/week`);
  if (!windowShot(pid, `${out}/desktop-week.png`)) await page.screenshot({ path: `${out}/desktop-week.png` });
  await go(page, `${origin}/session/chat_demo_onboarding`);
  await page.getByRole("tab", { name: "Plan" }).click().catch(() => {});
  await page.waitForTimeout(500);
  if (!windowShot(pid, `${out}/desktop-session.png`)) await page.screenshot({ path: `${out}/desktop-session.png` });
  await go(page, `${origin}/today`);
  await page.screenshot({ path: `${out}/today.png` });
  await go(page, `${origin}/map`);
  await page.screenshot({ path: `${out}/life-map.png` });
  await go(page, `${origin}/settings`);
  await page.screenshot({ path: `${out}/ai-models.png` });
  await page.evaluate(() => {
    const label = [...document.querySelectorAll(".lh-label")].find((e) => e.textContent?.trim() === "Appearance");
    label?.scrollIntoView({ block: "start" });
    label?.closest(".overflow-y-auto")?.scrollBy(0, -28);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/themes.png` });
});
await withApp(seed("--theme", "paper"), async (page, origin) => {
  await go(page, `${origin}/week`);
  await page.screenshot({ path: `${out}/week-paper.png` });
});
await withApp(seed("--scene", "interview"), async (page, origin) => {
  await go(page, `${origin}/session/chat_demo_interview`);
  await page.screenshot({ path: `${out}/interview.png` });
});
console.log(`README images written to ${out}`);
