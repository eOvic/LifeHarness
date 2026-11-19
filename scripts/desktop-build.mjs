// Build the desktop app: Next standalone server + Electron shell -> .deb + AppImage in dist-desktop/.
//   npm run desktop:build            (both targets)
//   npm run desktop:build -- --dir   (unpacked only, fastest; for testing)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyEngine } from "./server-deps.mjs";

const root = process.cwd();
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const skipNext = process.argv.includes("--skip-next");
console.log(`1/4 next build (standalone)${skipNext ? ": skipped" : ""}`);
if (!skipNext) {
  fs.rmSync(path.join(root, ".next/standalone"), { recursive: true, force: true }); // next build doesn't clear stale files here
  run("npx next build", { LIFEHARNESS_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" });
}

console.log("2/4 assemble the server");
const sa = path.join(root, ".next/standalone");
// Guard: a dynamic file-system call can make Next trace the WHOLE project into the server (sources,
// docs, even old installers). Next prints "Dynamic filesystem access causes tracing of the whole
// project"; fix that call with /*turbopackIgnore: true*/. Never ship such a build.
const expected = new Set([".next", "node_modules", "package.json", "server.js", "prompts", "public"]);
const unexpected = fs.readdirSync(sa).filter((e) => !expected.has(e));
if (unexpected.length) {
  console.error(`✗ the standalone server contains project files it shouldn't: ${unexpected.join(", ")}\n  (look for "Dynamic filesystem access causes tracing of the whole project" in the build output)`);
  process.exit(1);
}
fs.cpSync(".next/static", path.join(sa, ".next/static"), { recursive: true });
if (fs.existsSync("public")) fs.cpSync("public", path.join(sa, "public"), { recursive: true });
fs.cpSync("prompts", path.join(sa, "prompts"), { recursive: true });
fs.rmSync(path.join(sa, "data"), { recursive: true, force: true }); // never ship local data
// Next traces its optional image library (sharp + libvips: 47 MB, LGPL) into every server. LifeHarness
// has no <Image> (next.config.ts sets images.unoptimized), so it's never loaded: leave it out.
for (const dir of ["node_modules/sharp", "node_modules/@img"]) fs.rmSync(path.join(sa, dir), { recursive: true, force: true });
// Next embeds the build machine's project path (with the user name in it) in its config; the
// packaged server never needs it (it starts from its own folder). Ship a neutral path instead.
for (const f of ["server.js", ".next/required-server-files.json"]) {
  const p = path.join(sa, f);
  if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, "utf8").split(root).join("/lifeharness"));
}
// The AI engine loads providers and sign-in flows lazily; tracing misses them. Ship it whole.
const engine = copyEngine(root, sa);
console.log(`  engine: ${engine.packages} packages (${(engine.bytes / 1e6).toFixed(0)} MB) copied whole`);
run(`node scripts/verify-server.mjs ${sa}`);

console.log("3/4 stage the Electron app");
const app = path.join(root, "desktop-app");
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app);
for (const f of ["main.cjs", "preload.cjs", "icon.png"]) fs.copyFileSync(path.join("electron", f), path.join(app, f));
// The package names a neutral maintainer, never the builder's git identity (it ends up in the
// .deb control file and inside the app). Publishing? Set LIFEHARNESS_MAINTAINER="Name <email>".
const maintainer = /^(.+?)\s*<([^>]+)>$/.exec(process.env.LIFEHARNESS_MAINTAINER ?? "") ?? [null, "LifeHarness", "maintainer@lifeharness.invalid"];
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify(
    {
      name: "lifeharness",
      productName: "LifeHarness",
      version: pkg.version,
      description: pkg.description,
      main: "main.cjs",
      desktopName: "lifeharness.desktop", // WM_CLASS: lets the dock match the window to its launcher
      homepage: pkg.homepage,
      author: { name: maintainer[1], email: maintainer[2] },
      license: "UNLICENSED",
    },
    null,
    2,
  ),
);

console.log("4/4 electron-builder");
const extra = process.argv.includes("--dir") ? " --dir" : "";
fs.rmSync("dist-desktop", { recursive: true, force: true });
run(`npx electron-builder --linux --publish never${extra}`);
// Check what actually got packaged (the afterPack copy), not just the staging folder.
run("node scripts/verify-server.mjs dist-desktop/linux-unpacked/resources/server");
// Licenses: our LICENSE and the third-party notices ship (scripts/after-pack.cjs); sharp stays out.
const res = "dist-desktop/linux-unpacked/resources";
const problems = [
  ...["licenses/LICENSE", "licenses/THIRD_PARTY_NOTICES.txt"].filter((f) => !fs.existsSync(path.join(res, f))).map((f) => `${f} is missing`),
  ...["sharp", "@img"].filter((n) => fs.existsSync(path.join(res, "server/node_modules", n))).map((n) => `${n} was shipped`),
];
if (problems.length) {
  console.error(`✗ licenses: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("✓ licenses: LICENSE and third-party notices shipped; sharp left out");
// Privacy gate: nothing that identifies the builder may ship (home path, user name, git emails).
run("node scripts/privacy-check.mjs dist-desktop/linux-unpacked/resources");
console.log("\ndone: dist-desktop/");
