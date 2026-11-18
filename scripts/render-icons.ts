// Render build/icon.svg to PNGs with the system Chrome (no extra image tooling needed).
import fs from "node:fs";
import { chromium } from "playwright-core";
const svg = fs.readFileSync("build/icon.svg", "utf8");
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
for (const size of [512, 256, 128, 64, 32]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  const out = size === 512 ? "build/icon.png" : `build/icons/${size}x${size}.png`;
  fs.mkdirSync("build/icons", { recursive: true });
  await page.screenshot({ path: out, omitBackground: true });
  if (size === 512) fs.copyFileSync(out, "build/icons/512x512.png");
  await page.close();
}
fs.copyFileSync("build/icons/256x256.png", "electron/icon.png");
await browser.close();
console.log("icons rendered");
