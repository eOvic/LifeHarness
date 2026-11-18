// Drive the real onboarding in a browser: start, answer N questions through the dock, screenshot.
//   npx tsx scripts/ui-e2e.ts [--base http://localhost:3210] [--rounds 3]
import fs from "node:fs";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const base = opt("base", "http://localhost:3210");
const rounds = Number(opt("rounds", "3"));
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
fs.mkdirSync("shots", { recursive: true });

const answers = [
  "I'm a hospital pharmacist. I want to pass my board exam this year, get back to running, and stop losing my evenings to my phone.",
  "Honestly: my faith, being good at my work, and my family.",
  "In five years I'd like to be a clinical pharmacist people trust, fit enough to run a half marathon, and still close to my family.",
  "Pass the board exam in June.",
];

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${base}/start`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start the interview/ }).click();
await page.waitForURL(/\/session\//, { timeout: 15000 });
console.log("session:", page.url());

let lastQuestion = "";
for (let r = 0; r < rounds; r++) {
  const answer = page.getByRole("button", { name: "Answer", exact: true });
  await answer.waitFor({ timeout: 120000 });
  const dock = answer.locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
  const q = (await dock.locator(".prose-lh").first().innerText()).trim();
  if (q === lastQuestion) throw new Error("question did not advance");
  lastQuestion = q;
  console.log(`\nQ${r + 1}: ${q}`);
  const textarea = dock.locator("textarea").first();
  const placeholder = await textarea.getAttribute("placeholder");
  if (placeholder?.startsWith("Think out loud")) {
    // options question: pick the first option
    const first = dock.locator("button").filter({ hasText: /\S/ }).nth(0);
    console.log("   picking:", (await first.innerText()).split("\n").slice(-1)[0]);
    await first.click();
  } else {
    await textarea.fill(answers[r] ?? "Yes, that works.");
    console.log("   typed:", answers[r]);
  }
  await dock.getByPlaceholder(/Think out loud/).fill("Thinking out loud: mornings are when I'm sharpest.");
  const slider = dock.locator('input[type="range"]');
  if (await slider.count()) await slider.fill("70");
  await page.screenshot({ path: `shots/e2e-q${r + 1}.png` });
  await answer.click();
  // the answered question moves into the transcript; wait for the agent to finish
  await page.waitForFunction((prev) => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Answer");
    const box = btn?.closest("div.rounded-2xl");
    const txt = box?.querySelector(".prose-lh")?.textContent?.trim();
    return !!txt && txt !== prev;
  }, q, { timeout: 120000 });
}
await page.screenshot({ path: "shots/e2e-final.png" });
await page.getByRole("button", { name: "Life map" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/e2e-lifemap.png" });
await browser.close();
console.log("\nOK. Browser errors:", errors.length ? errors : "none");
