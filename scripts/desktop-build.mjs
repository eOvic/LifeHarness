// Build the desktop app: Next standalone server + Electron shell -> .deb + AppImage in dist-desktop/.
//   npm run desktop:build            (both targets)
//   npm run desktop:build -- --dir   (unpacked only, fastest; for testing)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const skipNext = process.argv.includes("--skip-next");
console.log(`1/4 next build (standalone)${skipNext ? ": skipped" : ""}`);
if (!skipNext) run("npx next build", { LIFEHARNESS_STANDALONE: "1" });

console.log("2/4 assemble the server");
const sa = path.join(root, ".next/standalone");
fs.cpSync(".next/static", path.join(sa, ".next/static"), { recursive: true });
if (fs.existsSync("public")) fs.cpSync("public", path.join(sa, "public"), { recursive: true });
fs.cpSync("prompts", path.join(sa, "prompts"), { recursive: true });
fs.rmSync(path.join(sa, "data"), { recursive: true, force: true }); // never ship local data

console.log("3/4 stage the Electron app");
const app = path.join(root, "desktop-app");
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app);
for (const f of ["main.cjs", "preload.cjs", "icon.png"]) fs.copyFileSync(path.join("electron", f), path.join(app, f));
const git = (k) => {
  try {
    return execSync(`git config ${k}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
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
      author: { name: git("user.name") || "LifeHarness", email: git("user.email") || "maintainer@lifeharness.invalid" },
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
console.log("\ndone: dist-desktop/");
