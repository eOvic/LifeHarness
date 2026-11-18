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

const questionText = () => page.locator('[data-lh="question"]').innerText().then((t) => t.trim());
let last = "";
for (let r = 0; r < rounds; r++) {
  await page.locator('[data-lh="dock"]').waitFor({ timeout: 120000 });
  const q = await questionText();
  if (q === last) throw new Error("question did not advance");
  last = q;
  console.log(`\nQ${r + 1}: ${q}`);
  const options = page.locator('[data-lh="option"]');
  if (await options.count()) {
    console.log("   picking:", (await options.first().innerText()).split("\n")[0]);
    await options.first().click();
  } else {
    await page.locator('[data-lh="answer-text"]').fill(answers[r] ?? "Yes, that works.");
    console.log("   typed:", answers[r]);
  }
  await page.locator('[data-lh="thinking"]').fill("Thinking out loud: mornings are when I'm sharpest.");
  const slider = page.locator('[data-lh="confidence"]');
  if (await slider.count()) await slider.fill("70");
  await page.screenshot({ path: `shots/e2e-q${r + 1}.png` });
  await page.locator('[data-lh="submit"]').click();
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-lh="question"]');
      return !!el && el.textContent?.trim() !== prev;
    },
    q,
    { timeout: 120000 },
  );
}
await page.screenshot({ path: "shots/e2e-final.png" });
await browser.close();
console.log("\nOK. Browser errors:", errors.length ? errors : "none");
