// Renders LifeHarness's macOS icons with Chrome (playwright-core). Run it after changing build/icon.svg:
//   npx tsx scripts/mac-icons.ts          (CHROME=/path/to/chrome if it isn't /usr/bin/google-chrome)
//
//   build/icon-mac.png              1024 px app icon (electron-builder.yml mac.icon; it makes the .icns).
//                                   build/icon.svg on Apple's icon grid: the rounded square is 824 of
//                                   1024 px, centred, with the grid's soft shadow. The full-bleed
//                                   icon.svg would look bigger than every other icon in the Dock.
//   electron/trayTemplate.png       16 px menu bar icon, and @2x (32 px) for Retina. A macOS "template":
//   electron/trayTemplate@2x.png    the logo's glyph in black and transparency, which macOS tints for
//                                   light and dark menu bars.
import fs from "node:fs";
import { chromium } from "playwright-core";

const source = fs.readFileSync("build/icon.svg", "utf8");
const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(source)?.[1];
if (!inner || !source.includes('viewBox="0 0 512 512"') || !source.includes('x="32" y="32" width="448" height="448"')) {
  throw new Error("build/icon.svg changed shape: update the grid mapping in scripts/mac-icons.ts");
}
// icon.svg's square is 448 units at 32; Apple's is 824/1024 of the canvas (412 units at 50).
const MAC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><filter id="mac-grid-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity="0.3"/></filter></defs>
  <g filter="url(#mac-grid-shadow)"><g transform="translate(50 50) scale(${412 / 448}) translate(-32 -32)">${inner}</g></g>
</svg>`;

// The glyph of icon.svg (sun, rays, horizon and its fading reflections), alone, in black.
const TRAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3.2 3.6 25.6 25.6">
  <path d="M9.5 17.5a6.5 6.5 0 0 1 13 0Z" fill="#000"/>
  <path d="M16 5.5v2.6M8.4 8.6l1.8 1.8M23.6 8.6l-1.8 1.8" stroke="#000" stroke-width="2" stroke-linecap="round"/>
  <path d="M4.5 17.5h23" stroke="#000" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M8.5 22.5h15" stroke="#000" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>
  <path d="M12.5 27.2h7" stroke="#000" stroke-width="2.2" stroke-linecap="round" opacity=".35"/>
</svg>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
try {
  const page = await browser.newPage();
  const render = async (svg: string, size: number, out: string) => {
    await page.setViewportSize({ width: size, height: size });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    await page.screenshot({ path: out, omitBackground: true });
    console.log(`  ${out} (${size} px)`);
  };
  await render(MAC_ICON, 1024, "build/icon-mac.png");
  await render(TRAY, 16, "electron/trayTemplate.png");
  await render(TRAY, 32, "electron/trayTemplate@2x.png");
} finally {
  await browser.close();
}
