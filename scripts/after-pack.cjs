// electron-builder afterPack hook: copy the Next.js standalone server into the app's resources.
// (electron-builder skips node_modules inside extraResources, so we copy it ourselves,
// keeping the relative symlinks Turbopack creates for external packages.)
// Resources: <app>/resources on Linux and Windows, LifeHarness.app/Contents/Resources on macOS.
// Runs before macOS code signing, so everything copied here is covered by the app's signature.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/** The folder Electron calls process.resourcesPath, for this package. */
function resourcesDir(context) {
  const mac = context.electronPlatformName === "darwin" || context.electronPlatformName === "mas";
  return mac
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
}

/** Native add-ons come prebuilt for every OS (prebuildify: prebuilds/<os>-<arch>/). Keep this package's
 *  OS only: smaller, and on macOS nothing foreign gets signed. Returns how many folders went. */
function pruneForeignPrebuilds(dir, os) {
  let removed = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === "prebuilds") {
      for (const t of fs.readdirSync(p))
        if (!t.startsWith(`${os}-`)) {
          fs.rmSync(path.join(p, t), { recursive: true, force: true });
          removed++;
        }
    } else removed += pruneForeignPrebuilds(p, os);
  }
  return removed;
}

exports.default = async function afterPack(context) {
  const root = context.packager.projectDir;
  const src = path.join(root, ".next", "standalone");
  const resources = resourcesDir(context);
  const dest = path.join(resources, "server");
  if (!fs.existsSync(path.join(src, "server.js"))) throw new Error(`standalone server missing at ${src}: run scripts/desktop-build.mjs`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  console.log(`  • server copied  to=${path.relative(root, dest)}`);
  const os = context.electronPlatformName === "mas" ? "darwin" : context.electronPlatformName;
  const pruned = pruneForeignPrebuilds(path.join(dest, "node_modules"), os);
  if (pruned) console.log(`  • native add-ons  kept ${os} only (${pruned} other builds left out)`);

  // macOS: the guard that keeps the server's process title out of the Dock (electron/main.cjs loads it).
  if (os === "darwin") fs.copyFileSync(path.join(root, "electron", "server-title-guard.cjs"), path.join(resources, "server-title-guard.cjs"));

  // Licenses (next to the server): LifeHarness's own, and the notices of everything it ships.
  const licenses = path.join(resources, "licenses");
  fs.mkdirSync(licenses, { recursive: true });
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(licenses, "LICENSE"));
  const { writeNotices } = await import(pathToFileURL(path.join(root, "scripts", "third-party-notices.mjs")).href);
  const n = writeNotices({ root, serverDir: dest, out: path.join(licenses, "THIRD_PARTY_NOTICES.txt") });
  console.log(`  • licenses       ${n.packages} packages + ${n.fonts} fonts  to=${path.relative(root, licenses)}`);
};
