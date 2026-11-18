// Verify that a built server directory can load the whole AI engine.
//   node scripts/verify-server.mjs [server-dir]      (default .next/standalone)
//   e.g. node scripts/verify-server.mjs dist-desktop/linux-unpacked/resources/server
// 1. completeness: every runtime file of every engine package in the repo is shipped;
// 2. a child process started IN the server directory imports every pi-ai module (providers, OAuth
//    flows: all the lazy imports) and the pi-coding-agent entry, so missing deps fail here, not
//    at a user's first model call.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dependencyClosure } from "./server-deps.mjs";

const root = process.cwd();
const server = path.resolve(process.argv[2] || ".next/standalone");
const SKIP = /\.(map|d\.ts|d\.mts|d\.cts|md|markdown|tsbuildinfo)$/i;
const problems = [];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") yield* walk(p);
    } else yield p;
  }
}

let files = 0;
const closure = dependencyClosure(root);
for (const dir of closure) {
  for (const f of walk(dir)) {
    if (SKIP.test(f)) continue;
    files++;
    if (!fs.existsSync(path.join(server, path.relative(root, f)))) problems.push(`missing ${path.relative(root, f)}`);
  }
}

// The module list comes from the REPO's install: lazily loaded files that never got shipped must
// fail here (walking the shipped copy would silently skip exactly those).
const expected = [];
for (const f of walk(path.join(root, "node_modules/@earendil-works/pi-ai/dist"))) if (f.endsWith(".js")) expected.push(path.relative(root, f));
const listFile = path.join(os.tmpdir(), `lh-verify-${process.pid}.json`);
fs.writeFileSync(listFile, JSON.stringify(expected));
const probe = `
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const failures = []; let n = 0;
for (const rel of JSON.parse(fs.readFileSync(${JSON.stringify(listFile)}, "utf8"))) {
  n++;
  try { await import(pathToFileURL(path.resolve(rel)).href); } catch (e) { failures.push(rel + ": " + String(e?.message ?? e).split("\\n")[0].slice(0, 220)); }
}
try {
  const pkgDir = path.resolve("node_modules/@earendil-works/pi-coding-agent");
  const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const dot = pj.exports?.["."]; const entry = (typeof dot === "string" ? dot : dot?.import?.default ?? dot?.import ?? dot?.default) ?? pj.main;
  const m = await import(pathToFileURL(path.join(pkgDir, entry)).href);
  if (!m.ModelRuntime) failures.push("pi-coding-agent: no ModelRuntime export");
} catch (e) { failures.push("pi-coding-agent: " + String(e?.message ?? e).split("\\n")[0]); }
console.log(JSON.stringify({ n, failures }));
`;
// The probe lives outside the (possibly read-only, installed) server dir; it imports by absolute path,
// so every module resolves its dependencies from its own location inside the server.
const probeFile = path.join(os.tmpdir(), `lh-verify-${process.pid}.mjs`);
fs.writeFileSync(probeFile, probe);
const run = spawnSync(process.execPath, [probeFile], { cwd: server, encoding: "utf8", env: { ...process.env, HOME: os.tmpdir() }, timeout: 120000 });
fs.rmSync(probeFile, { force: true });
fs.rmSync(listFile, { force: true });
let imported = 0;
try {
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  imported = out.n;
  problems.push(...out.failures.map((f) => `import failed: ${f}`));
} catch {
  problems.push(`probe crashed: ${(run.stderr || run.stdout || "").slice(0, 600)}`);
}

if (problems.length) {
  console.error(`✗ ${path.relative(root, server) || server}: the AI engine is incomplete (${problems.length} problems)`);
  for (const p of problems.slice(0, 25)) console.error(`  - ${p}`);
  if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`);
  process.exit(1);
}
console.log(`✓ engine complete: ${closure.length} packages, ${files} files present, ${imported} pi-ai modules import cleanly from the server dir`);
