// Privacy gate: nothing that identifies the person who built it may ship.
//   node scripts/privacy-check.mjs [dir ...]     (default: this OS's dist-desktop/<os>-unpacked/resources)
// Looks for the builder's home path, user name, and every git email configured here (repo + global).
// Set LIFEHARNESS_MAINTAINER="Name <email>" to publish under an address on purpose (it's then allowed).
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const git = (args) => {
  try {
    return execSync(`git config ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const allowed = process.env.LIFEHARNESS_MAINTAINER ?? "";
const user = os.userInfo().username;
// A Windows home path can appear as C:\Users\x, doubled inside JSON, with forward slashes, or with a
// lower-case drive letter.
const pathForms = (p) =>
  [p, p.replaceAll("\\", "\\\\"), p.replaceAll("\\", "/")].flatMap((f) => (/^[A-Za-z]:/.test(f) ? [f[0].toUpperCase() + f.slice(1), f[0].toLowerCase() + f.slice(1)] : [f]));
const needles = [...new Set([...pathForms(os.homedir()), user.length >= 5 ? user : "", git("user.email"), git("--global user.email")])].filter(
  (n) => n && n.length > 4 && !allowed.includes(n),
);

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [`dist-desktop/${process.platform === "win32" ? "win" : "linux"}-unpacked/resources`];
const leaks = [];
const scan = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (e.isFile()) {
      const buf = fs.readFileSync(p);
      for (const n of needles) if (buf.includes(n)) leaks.push(`${p} contains "${n}"`);
    }
  }
};
for (const d of dirs) scan(d);
if (leaks.length) {
  console.error(`✗ privacy: the package would identify its builder:\n  - ${leaks.slice(0, 20).join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ privacy: no home path, user name or git email in ${dirs.join(", ")} (${needles.length} identifiers checked)`);
