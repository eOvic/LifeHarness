// electron-builder afterPack hook: copy the Next.js standalone server into resources/server.
// (electron-builder skips node_modules inside extraResources, so we copy it ourselves,
// keeping the relative symlinks Turbopack creates for external packages.)
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  const dest = path.join(context.appOutDir, "resources", "server");
  if (!fs.existsSync(path.join(src, "server.js"))) throw new Error(`standalone server missing at ${src}: run scripts/desktop-build.mjs`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  console.log(`  • server copied  to=${path.relative(context.packager.projectDir, dest)}`);
};
