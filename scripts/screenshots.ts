// Screenshot every page with the system Chrome (no browser download).
//   npm run shots -- [--base http://localhost:3210] [--out shots] [--pages /start,/today]
import fs from "node:fs";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const base = opt("base", "http://localhost:3210");
const out = opt("out", "shots");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });

const state = await (await fetch(`${base}/api/state`)).json();
const session = state.chats[0]?.id;
const pages = opt("pages", ["/start", session ? `/session/${session}` : "", "/today", "/week", "/review", "/map", "/settings"].filter(Boolean).join(",")).split(",");

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: console: ${m.text()}`));
for (const p of pages) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const name = p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "_").slice(0, 40);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: !p.startsWith("/session") });
  console.log(`saved ${out}/${name}.png`);
}
await browser.close();
if (errors.length) console.log("\nBrowser errors:\n" + errors.join("\n"));
