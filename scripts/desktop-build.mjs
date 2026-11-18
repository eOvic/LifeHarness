// Build the desktop app: Next standalone server + Electron shell -> .deb + AppImage in dist-desktop/.
//   npm run desktop:build            (both targets)
//   npm run desktop:build -- --dir   (unpacked only, fastest; for testing)
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyEngine } from "./server-deps.mjs";

const root = process.cwd();
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const skipNext = process.argv.includes("--skip-next");
console.log(`1/4 next build (standalone)${skipNext ? ": skipped" : ""}`);
if (!skipNext) run("npx next build", { LIFEHARNESS_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" });

console.log("2/4 assemble the server");
const sa = path.join(root, ".next/standalone");
fs.cpSync(".next/static", path.join(sa, ".next/static"), { recursive: true });
if (fs.existsSync("public")) fs.cpSync("public", path.join(sa, "public"), { recursive: true });
fs.cpSync("prompts", path.join(sa, "prompts"), { recursive: true });
fs.rmSync(path.join(sa, "data"), { recursive: true, force: true }); // never ship local data
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
// Privacy gate: nothing that identifies the builder may ship (home path, git email).
const gitEmail = (() => {
  try {
    return execSync("git config user.email", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();
const needles = [os.homedir(), gitEmail].filter((n) => n && n.length > 4 && !(process.env.LIFEHARNESS_MAINTAINER ?? "").includes(n));
const leaks = [];
const scan = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (e.isFile()) {
      const buf = fs.readFileSync(p);
      for (const n of needles) if (buf.includes(n)) leaks.push(`${path.relative("dist-desktop/linux-unpacked", p)} contains "${n}"`);
    }
  }
};
scan("dist-desktop/linux-unpacked/resources");
if (leaks.length) {
  console.error(`✗ the package would leak the builder's identity:\n  - ${leaks.slice(0, 20).join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ privacy: no home path or git email inside the package (${needles.length} identifiers checked)`);
console.log("\ndone: dist-desktop/");
