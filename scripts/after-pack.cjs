// electron-builder afterPack hook: copy the Next.js standalone server into resources/server.
// (electron-builder skips node_modules inside extraResources, so we copy it ourselves,
// keeping the relative symlinks Turbopack creates for external packages.)
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

exports.default = async function afterPack(context) {
  const root = context.packager.projectDir;
  const src = path.join(root, ".next", "standalone");
  const dest = path.join(context.appOutDir, "resources", "server");
  if (!fs.existsSync(path.join(src, "server.js"))) throw new Error(`standalone server missing at ${src}: run scripts/desktop-build.mjs`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  console.log(`  • server copied  to=${path.relative(root, dest)}`);

  // Licenses (next to the server): LifeHarness's own, and the notices of everything it ships.
  const licenses = path.join(context.appOutDir, "resources", "licenses");
  fs.mkdirSync(licenses, { recursive: true });
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(licenses, "LICENSE"));
  const { writeNotices } = await import(pathToFileURL(path.join(root, "scripts", "third-party-notices.mjs")).href);
  const n = writeNotices({ root, serverDir: dest, out: path.join(licenses, "THIRD_PARTY_NOTICES.txt") });
  console.log(`  • licenses       ${n.packages} packages + ${n.fonts} fonts  to=${path.relative(root, licenses)}`);
};
