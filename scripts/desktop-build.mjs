// Build the desktop app: Next standalone server + Electron shell -> installers in dist-desktop/.
//   npm run desktop:build            on Linux: .deb + AppImage; on Windows: a setup .exe (NSIS)
//   npm run desktop:build -- --dir   unpacked only, fastest; for testing
//   npm run desktop:build -- --win   on Linux: a portable Windows .zip for testing (the setup .exe needs
//                                    Windows: build it there, or with .github/workflows/desktop.yml)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyEngine } from "./server-deps.mjs";

const root = process.cwd();
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
// Each OS builds its own installers: Next traces native pieces for the machine it runs on.
const targetOs = process.argv.includes("--win") ? "win32" : process.platform;
const TARGET = { linux: { flag: "--linux", unpacked: "linux-unpacked" }, win32: { flag: "--win", unpacked: "win-unpacked" } }[targetOs];
if (!TARGET) {
  console.error(`✗ desktop builds run on Linux or Windows (this is ${process.platform})`);
  process.exit(1);
}
const crossWin = targetOs === "win32" && process.platform !== "win32";
if (crossWin) console.log("⚠ Windows build from Linux: a portable .zip for testing (the setup .exe needs Windows)");

const skipNext = process.argv.includes("--skip-next");
console.log(`1/4 next build (standalone)${skipNext ? ": skipped" : ""}`);
if (!skipNext) {
  fs.rmSync(path.join(root, ".next/standalone"), { recursive: true, force: true }); // next build doesn't clear stale files here
  run("npx next build", { LIFEHARNESS_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" });
}

console.log("2/4 assemble the server");
const sa = path.join(root, ".next/standalone");
// Guard: the server code must decide the OS at run time (src/server/platform.ts). Turbopack evaluates
// `process.platform` conditions at build time, so a raw check would silently keep only this OS's
// branch: the Windows names must still be in the compiled code.
const hasWindowsCode = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasWindowsCode(path.join(dir, e.name)) : e.name.endsWith(".js") && fs.readFileSync(path.join(dir, e.name), "utf8").includes("claude.exe")));
if (!hasWindowsCode(path.join(sa, ".next", "server"))) {
  console.error("✗ OS checks were decided at build time (no claude.exe left in the server code): test the OS through src/server/platform.ts");
  process.exit(1);
}
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
// On Windows the path shows up with backslashes, doubled inside JSON, or with forward slashes.
const rootForms = [...new Set([root, root.replaceAll("\\", "\\\\"), root.replaceAll("\\", "/")])].flatMap((f) =>
  /^[A-Za-z]:/.test(f) ? [f[0].toUpperCase() + f.slice(1), f[0].toLowerCase() + f.slice(1)] : [f],
);
for (const f of ["server.js", ".next/required-server-files.json"]) {
  const p = path.join(sa, f);
  if (!fs.existsSync(p)) continue;
  let text = fs.readFileSync(p, "utf8");
  for (const form of rootForms.sort((a, b) => b.length - a.length)) text = text.split(form).join("/lifeharness");
  fs.writeFileSync(p, text);
}
// The AI engine loads providers and sign-in flows lazily; tracing misses them. Ship it whole.
const engine = copyEngine(root, sa);
console.log(`  engine: ${engine.packages} packages (${(engine.bytes / 1e6).toFixed(0)} MB) copied whole`);
// Turbopack imports the engine through hashed aliases: .next/node_modules/<package>-<hash>, symlinks to
// node_modules/<package>. Symlinks don't survive a Windows installer, so point the compiled code at the
// real packages (found in the server's node_modules) and drop the aliases, on every OS.
const aliasDir = path.join(sa, ".next", "node_modules");
if (fs.existsSync(aliasDir)) {
  const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  const aliases = [];
  for (const e of fs.readdirSync(aliasDir)) {
    for (const alias of e.startsWith("@") ? fs.readdirSync(path.join(aliasDir, e)).map((n) => `${e}/${n}`) : [e]) {
      const real = /^(.+)-[0-9a-f]{16}$/.exec(alias)?.[1];
      const realDir = real && path.join(sa, "node_modules", real);
      if (!realDir || !fs.existsSync(path.join(realDir, "package.json")) || version(path.join(aliasDir, alias)) !== version(realDir)) {
        console.error(`✗ unexpected engine alias .next/node_modules/${alias}: not a copy of a shipped package`);
        process.exit(1);
      }
      aliases.push([alias, real]);
    }
  }
  const rewrite = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rewrite(p);
      else if (/\.(c?js|mjs|json)$/.test(e.name)) {
        const before = fs.readFileSync(p, "utf8");
        const after = aliases.reduce((s, [alias, real]) => s.split(alias).join(real), before);
        if (after !== before) fs.writeFileSync(p, after);
      }
    }
  };
  rewrite(path.join(sa, ".next", "server"));
  fs.rmSync(aliasDir, { recursive: true, force: true });
  console.log(`  engine imports: ${aliases.map(([, real]) => real).join(", ")} (direct, no symlinks)`);
}
run(`node scripts/verify-server.mjs ${sa}`);

console.log("3/4 stage the Electron app");
const app = path.join(root, "desktop-app");
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app);
for (const f of ["main.cjs", "preload.cjs", "window-state.cjs", "icon.png"]) fs.copyFileSync(path.join("electron", f), path.join(app, f));
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
      license: pkg.license,
    },
    null,
    2,
  ),
);

console.log("4/4 electron-builder");
const extra = process.argv.includes("--dir") ? " --dir" : "";
// Clear this target's previous output only, so a Linux and a Windows build can sit side by side.
const ownOutput = targetOs === "win32" ? /(-setup\.exe|-test\.zip|\.blockmap|\.nsis\.7z)$/ : /(\.deb|\.AppImage)$/;
for (const e of fs.existsSync("dist-desktop") ? fs.readdirSync("dist-desktop") : [])
  if (e === TARGET.unpacked || ownOutput.test(e) || e.startsWith("builder-") || e.startsWith(".")) fs.rmSync(path.join("dist-desktop", e), { recursive: true, force: true });
// The .exe's icon and version info are written on every OS (electron-builder 26 edits them in plain
// JavaScript, no Wine). Only the NSIS installer needs Windows, so a build from Linux zips the app instead.
const testZip = " zip -c.win.artifactName='${productName}-${version}-${arch}-test.${ext}'";
run(`npx electron-builder ${TARGET.flag}${crossWin && !extra ? testZip : ""} --publish never${extra}`);
const res = path.join("dist-desktop", TARGET.unpacked, "resources");
// Check what actually got packaged (the afterPack copy), not just the staging folder.
run(`node scripts/verify-server.mjs ${path.join(res, "server")}`);
// Licenses: our LICENSE and the third-party notices ship (scripts/after-pack.cjs); sharp stays out.
if (fs.existsSync(path.join(res, "server", ".next", "node_modules"))) {
  console.error("✗ engine aliases (.next/node_modules) were shipped: they're symlinks, which break on Windows");
  process.exit(1);
}
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
run(`node scripts/privacy-check.mjs ${res}`);
console.log("\ndone: dist-desktop/");
