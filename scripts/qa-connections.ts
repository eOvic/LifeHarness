// QA for Settings → AI models, against a real browser or the real desktop app. Exercises every
// connect path WITHOUT completing a login or saving anything:
//   - a deliberately invalid API key must be rejected by the provider (proves the engine loads
//     and the request goes out) and must not be saved;
//   - ChatGPT sign-in must produce an auth.openai.com page; Copilot must produce a device code;
//     both are then cancelled;
//   - with nothing connected, Start and a new session must offer "connect a model".
//   npx tsx scripts/qa-connections.ts --base http://127.0.0.1:3217        (dev/web server)
//   npx tsx scripts/qa-connections.ts --exe /opt/LifeHarness/lifeharness  (packaged app; scratch config)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, chromium, type Page } from "playwright-core";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = arg("--out") ?? "shots/qa-connections";
fs.mkdirSync(out, { recursive: true });
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`);
};

let page: Page;
let close: () => Promise<void>;
let origin: string;
let authFile: string | undefined;
if (arg("--exe")) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "lh-qa-config-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "lh-qa-data-"));
  authFile = path.join(config, "LifeHarness", "auth.json");
  const app = await electron.launch({
    executablePath: arg("--exe")!,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
    env: { ...process.env, LIFEHARNESS_DATA_DIR: data, XDG_CONFIG_HOME: config } as Record<string, string>,
  });
  page = await app.firstWindow();
  await page.waitForLoadState("networkidle");
  origin = new URL(page.url()).origin;
  // Sign-in pages would open in the real browser: record them instead.
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { __opened: string[] }).__opened = [];
    shell.openExternal = async (u: string) => void (globalThis as unknown as { __opened: string[] }).__opened.push(u);
  });
  close = () => app.close();
} else {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  origin = arg("--base") ?? "http://127.0.0.1:3210";
  authFile = arg("--auth-file");
  close = () => browser.close();
}
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1. Settings with nothing connected
await page.goto(`${origin}/settings`, { waitUntil: "networkidle" });
await page.locator('[data-lh="connections"]').waitFor({ timeout: 20000 });
check("settings says nothing is connected", await page.locator('[data-lh="no-model"]').isVisible());
await page.screenshot({ path: `${out}/1-settings.png`, fullPage: false });

// 2. invalid Anthropic key → rejected, not saved
await page.locator('[data-lh="key-anthropic"]').click();
await page.locator('[data-lh="key-input"]').fill("sk-ant-api03-lifeharness-qa-invalid-key-0000000000");
await page.getByRole("button", { name: "Save" }).click();
const err = page.locator('[data-lh="login-error"]');
await err.waitFor({ timeout: 45000 }).catch(() => {});
const errText = (await err.textContent().catch(() => "")) ?? "";
check("invalid Anthropic key is rejected by Anthropic", /rejected that key/i.test(errText), errText.slice(0, 140));
await page.screenshot({ path: `${out}/2-bad-key.png` });
const stored = authFile && fs.existsSync(authFile) ? Object.keys(JSON.parse(fs.readFileSync(authFile, "utf8"))) : [];
check("rejected key was not saved", !stored.includes("anthropic"), `auth.json providers: [${stored.join(", ")}]`);
await page.getByRole("button", { name: "Cancel" }).first().click();

// 3. ChatGPT sign-in → a real auth.openai.com page, then cancel
await page.locator('[data-lh="connect-openai"]').click();
const open = page.getByRole("link", { name: /open the sign-in page/i });
await open.waitFor({ timeout: 30000 }).catch(() => {});
const href = (await open.getAttribute("href").catch(() => null)) ?? "";
check("ChatGPT sign-in produces an OpenAI sign-in page", /^https:\/\/auth\.openai\.com\//.test(href), href.slice(0, 70));
await page.screenshot({ path: `${out}/3-chatgpt.png` });
await page.getByRole("button", { name: "Cancel" }).first().click();

// 4. Copilot → a device code, then cancel
await page.locator('[data-lh="connect-github-copilot"]').click();
const code = page.locator('[data-lh="device-code"]');
await code.waitFor({ timeout: 30000 }).catch(() => {});
const codeText = (await code.textContent().catch(() => "")) ?? "";
check("GitHub Copilot sign-in shows a device code", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codeText.trim()), codeText);
await page.screenshot({ path: `${out}/4-copilot.png` });
await page.getByRole("button", { name: "Cancel" }).first().click();

// 4b. Claude through Claude Code: connects in one click when a new-enough Claude Code is installed
//     (no model call), otherwise shows the setup steps. Disconnected again afterwards.
await page.locator('[data-lh="connect-claude-code"]').click();
await page.waitForTimeout(2500);
const ccDone = await page.locator('[data-lh="claude-code-done"]').isVisible().catch(() => false);
const ccSetup = await page.locator('[data-lh="claude-code-setup"]').isVisible().catch(() => false);
check("Claude row connects through Claude Code or shows its setup steps", ccDone || ccSetup, ccDone ? "connected" : "setup steps shown");
await page.screenshot({ path: `${out}/4b-claude.png` });
if (ccDone) await page.getByRole("button", { name: "Disconnect" }).first().click();
await page.waitForTimeout(800);

// 5. Start page and a session both route to "connect a model"
await page.goto(`${origin}/start`, { waitUntil: "networkidle" });
check("start page asks to connect a model first", await page.locator('[data-lh="connect-first"]').isVisible().catch(() => false));
await page.screenshot({ path: `${out}/5-start.png` });
const chat = (await page.evaluate(async () => (await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "replan" }) })).json())) as { id: string };
await page.goto(`${origin}/session/${chat.id}`, { waitUntil: "networkidle" });
await page.locator('[data-lh="connect-panel"]').waitFor({ timeout: 20000 }).catch(() => {});
check("a session without a model shows the connect panel", await page.locator('[data-lh="connect-panel"]').isVisible().catch(() => false));
await page.screenshot({ path: `${out}/6-session.png` });

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
await close();
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nall connection checks passed");
process.exit(failed ? 1 : 0);
