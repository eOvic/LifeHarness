// Desktop QA: drive the real packaged app (Electron) through every page at several window sizes.
// Collects console errors, horizontal overflow, header/window-control collisions, and screenshots.
//   npx tsx scripts/qa-desktop.ts --data <dir> [--exe /opt/LifeHarness/lifeharness] [--out shots/qa]
//          [--sizes 1440x900,960x1048,760x560] [--pages /today,/week]
// Uses a scratch XDG_CONFIG_HOME, so the real ~/.config/LifeHarness (window state, caches) is never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
// Default: the installed app (Linux: the .deb; Windows: the per-user installer's folder).
const exe = arg("--exe", process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "LifeHarness", "LifeHarness.exe") : "/opt/LifeHarness/lifeharness");
const data = arg("--data", "");
const out = arg("--out", "shots/qa");
const sizes = arg("--sizes", "1440x900,960x1048,760x560").split(",").map((s) => s.split("x").map(Number) as [number, number]);
const pages = arg("--pages", "/start,/today,/week,/review,/map,/sessions,/settings,/session/chat_demo_onboarding").split(",");
if (!data) throw new Error("--data <dir> is required (seed one with scripts/seed-demo.ts)");

fs.mkdirSync(out, { recursive: true });
const config = fs.mkdtempSync(path.join(os.tmpdir(), "lh-qa-config-"));
const app = await electron.launch({
  executablePath: exe,
  args: process.platform === "linux" ? ["--no-sandbox"] : [], // Linux: unprivileged sandbox is blocked outside the .deb
  env: { ...process.env, LIFEHARNESS_DATA_DIR: data, XDG_CONFIG_HOME: config } as Record<string, string>,
  timeout: 60000,
});
const win = await app.firstWindow();
const problems: string[] = [];
win.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()} @ ${win.url()}: ${m.text().slice(0, 300)}`);
});
win.on("pageerror", (e) => problems.push(`pageerror @ ${win.url()}: ${e.message.slice(0, 300)}`));
await win.waitForLoadState("networkidle");
const origin = new URL(win.url()).origin;

for (const [w, h] of sizes) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0];
    bw.unmaximize();
    bw.setSize(w, h);
  }, [w, h]);
  await win.waitForTimeout(400);
  for (const p of pages) {
    await win.goto(origin + p, { waitUntil: "networkidle" });
    await win.waitForTimeout(700);
    const name = `${w}x${h}${p.replace(/\//g, "_")}.png`;
    await win.screenshot({ path: path.join(out, name) });
    const check = await win.evaluate(() => {
      const issues: string[] = [];
      const vw = document.documentElement.clientWidth;
      const over = document.scrollingElement!.scrollWidth - vw;
      if (over > 1) issues.push(`page scrolls horizontally by ${over}px`);
      // Window controls (titleBarOverlay) live right of the titlebar area: nothing clickable may sit under them.
      const wco = (navigator as unknown as { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
      if (wco?.visible) {
        const r = wco.getTitlebarAreaRect();
        for (const el of Array.from(document.querySelectorAll("header a, header button, header input, header select"))) {
          const b = el.getBoundingClientRect();
          if (b.width && b.bottom > 0 && b.top < r.height && b.right > r.right + 1) issues.push(`"${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)}" is under the window buttons`);
        }
      }
      // Elements wider than the viewport (a common cause of clipped content).
      for (const el of Array.from(document.querySelectorAll("main *"))) {
        const b = el.getBoundingClientRect();
        if (b.right > vw + 2 && getComputedStyle(el).position !== "fixed") {
          issues.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> overflows to ${Math.round(b.right)}px`);
          break;
        }
      }
      return issues;
    });
    for (const c of check) problems.push(`${w}x${h} ${p}: ${c}`);
  }
}
await app.close();
console.log(`screenshots: ${out}`);
console.log(problems.length ? `${problems.length} problem(s):\n- ${[...new Set(problems)].join("\n- ")}` : "no problems detected");
