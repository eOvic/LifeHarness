// Build the desktop app: Next standalone server + Electron shell -> installers in dist-desktop/.
//   npm run desktop:build            on Linux: .deb + AppImage; on Windows: a setup .exe (NSIS);
//                                    on macOS: a .dmg for Apple silicon (arm64) and one for Intel (x64)
//   npm run desktop:build -- --dir   unpacked only, fastest; for testing
//   npm run desktop:build -- --win   on Linux: a portable Windows .zip for testing (the setup .exe needs
//                                    Windows: build it there, or with .github/workflows/desktop.yml)
//   npm run desktop:build -- --mac   off a Mac: the macOS app folders only, to check what they contain.
//                                    Nothing can be signed off a Mac, so they won't open on one: the
//                                    .dmg needs a Mac (or .github/workflows/desktop.yml).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyEngine } from "./server-deps.mjs";

const root = process.cwd();
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
// Each OS builds its own installers: Next traces native pieces for the machine it runs on.
const targetOs = process.argv.includes("--win") ? "win32" : process.argv.includes("--mac") ? "darwin" : process.platform;
// unpacked: the app folders electron-builder leaves (macOS: one per chip). own: this target's installers.
const TARGET = {
  linux: { flag: "--linux", unpacked: ["linux-unpacked"], own: /(\.deb|\.AppImage)$/ },
  win32: { flag: "--win", unpacked: ["win-unpacked"], own: /(-setup\.exe|-setup\.exe\.blockmap|-test\.zip|\.nsis\.7z)$/ },
  darwin: { flag: "--mac", unpacked: ["mac-arm64", "mac", "mac-universal"], own: /(\.dmg|\.dmg\.blockmap)$/ },
}[targetOs];
if (!TARGET) {
  console.error(`✗ desktop builds are for Linux, Windows or macOS (this is ${process.platform})`);
  process.exit(1);
}
const crossWin = targetOs === "win32" && process.platform !== "win32";
if (crossWin) console.log("⚠ Windows build from Linux: a portable .zip for testing (the setup .exe needs Windows)");
const crossMac = targetOs === "darwin" && process.platform !== "darwin";
if (crossMac) console.log("⚠ macOS build off a Mac: the app folders only, to check their contents (unsigned: they won't open on a Mac)");
/** process.resourcesPath of a built app folder: where the server, licenses and guard go. */
const resourcesOf = (dir) => (targetOs === "darwin" ? path.join("dist-desktop", dir, "LifeHarness.app", "Contents", "Resources") : path.join("dist-desktop", dir, "resources"));

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
for (const f of ["main.cjs", "preload.cjs", "window-state.cjs", "login-item.cjs", "icon.png", "trayTemplate.png", "trayTemplate@2x.png"])
  fs.copyFileSync(path.join("electron", f), path.join(app, f));
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
const extra = process.argv.includes("--dir") || crossMac ? " --dir" : "";
// Clear this target's previous output only, so builds for different OSes can sit side by side.
for (const e of fs.existsSync("dist-desktop") ? fs.readdirSync("dist-desktop") : [])
  if (TARGET.unpacked.includes(e) || TARGET.own.test(e) || e.startsWith("builder-") || e.startsWith(".")) fs.rmSync(path.join("dist-desktop", e), { recursive: true, force: true });
// The .exe's icon and version info are written on every OS (electron-builder 26 edits them in plain
// JavaScript, no Wine). Only the NSIS installer needs Windows, so a build from Linux zips the app instead.
const testZip = " zip -c.win.artifactName='${productName}-${version}-${arch}-test.${ext}'";
// Signing variables come from CI secrets, and an unset secret arrives as "": electron-builder would take
// that for a certificate. Drop them.
for (const k of ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"])
  if (process.env[k] === "") delete process.env[k];
// macOS: a Mac with Apple silicon runs only signed code. Without a Developer ID certificate the app is
// signed ad hoc ("-"): it opens after one "Open Anyway" in System Settings. With CSC_LINK (and APPLE_*
// for notarization) electron-builder signs with the Developer ID and has Apple notarize it instead.
const adHoc = targetOs === "darwin" && !crossMac && !process.env.CSC_LINK && !process.env.CSC_NAME;
if (adHoc) console.log("  macOS: no Developer ID certificate (CSC_LINK): signing ad hoc");
const arches = crossMac ? " --arm64 --x64" : ""; // on a Mac the .dmg list in electron-builder.yml decides
run(`npx electron-builder ${TARGET.flag}${crossWin && !extra ? testZip : ""}${adHoc ? " -c.mac.identity=-" : ""}${arches} --publish never${extra}`);

// Check what actually got packaged (the afterPack copy), not just the staging folder: every app folder.
const built = TARGET.unpacked.filter((d) => fs.existsSync(path.join("dist-desktop", d)));
if (!built.length) {
  console.error(`✗ electron-builder left no app folder (${TARGET.unpacked.join(", ")})`);
  process.exit(1);
}
const prebuildsFor = (dir, found = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) e.name === "prebuilds" ? found.push(...fs.readdirSync(path.join(dir, e.name))) : prebuildsFor(path.join(dir, e.name), found);
  return found;
};
for (const dir of built) {
  const res = resourcesOf(dir);
  console.log(`checking ${dir}`);
  run(`node scripts/verify-server.mjs ${path.join(res, "server")} --os ${targetOs}`);
  if (fs.existsSync(path.join(res, "server", ".next", "node_modules"))) {
    console.error("✗ engine aliases (.next/node_modules) were shipped: they're symlinks, which break on Windows");
    process.exit(1);
  }
  // Licenses: our LICENSE and the third-party notices ship (scripts/after-pack.cjs); sharp stays out.
  // Native add-ons: this OS's only. macOS: the server's Dock guard is in place.
  const problems = [
    ...["licenses/LICENSE", "licenses/THIRD_PARTY_NOTICES.txt"].filter((f) => !fs.existsSync(path.join(res, f))).map((f) => `${f} is missing`),
    ...["sharp", "@img"].filter((n) => fs.existsSync(path.join(res, "server/node_modules", n))).map((n) => `${n} was shipped`),
    ...prebuildsFor(path.join(res, "server", "node_modules"))
      .filter((t) => !t.startsWith(`${targetOs}-`))
      .map((t) => `a native add-on for another OS was shipped (${t})`),
    ...(targetOs === "darwin" && !fs.existsSync(path.join(res, "server-title-guard.cjs")) ? ["server-title-guard.cjs is missing (a second Dock icon)"] : []),
  ];
  if (problems.length) {
    console.error(`✗ package: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("✓ package: LICENSE and third-party notices shipped; sharp left out; native add-ons for this OS only");
  // Privacy gate: nothing that identifies the builder may ship (home path, user name, git emails).
  run(`node scripts/privacy-check.mjs ${res}`);
}
console.log("\ndone: dist-desktop/");
