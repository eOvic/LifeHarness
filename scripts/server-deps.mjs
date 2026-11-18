// The Pi engine ships whole inside the desktop server.
//
// Next's output tracing only follows imports it can see statically. pi-ai loads its OAuth flows and
// provider SDKs lazily (variable import specifiers), so tracing shipped ~25% of the engine and the
// packaged app failed at the first model call ("Cannot find module …/auth/oauth/anthropic.js").
// We copy the full production dependency closure of the external packages instead, then verify it.
import fs from "node:fs";
import path from "node:path";

/** Packages Next leaves external (next.config.ts serverExternalPackages). */
export const ENGINE = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"];

const SKIP = /\.(map|d\.ts|d\.mts|d\.cts|md|markdown|tsbuildinfo)$/i;

/** Node's lookup: <from>/node_modules/<name>, then each parent directory's node_modules. */
function resolvePackageDir(name, from) {
  for (let d = from; ; d = path.dirname(d)) {
    const candidate = path.join(d, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(d) === d) return null;
  }
}

/** Every installed package directory the roots need at runtime (dependencies + optional + installed peers). */
export function dependencyClosure(root, roots = ENGINE) {
  const found = new Set();
  const queue = roots.map((name) => ({ name, from: root, required: true }));
  while (queue.length) {
    const { name, from, required } = queue.shift();
    const dir = resolvePackageDir(name, from);
    if (!dir) {
      if (required) throw new Error(`dependency ${name} (needed from ${path.relative(root, from) || "."}) is not installed`);
      continue;
    }
    if (found.has(dir)) continue;
    found.add(dir);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const dep of Object.keys(pj.dependencies ?? {})) queue.push({ name: dep, from: dir, required: true });
    for (const dep of Object.keys({ ...pj.optionalDependencies, ...pj.peerDependencies })) queue.push({ name: dep, from: dir, required: false });
  }
  return [...found].sort();
}

/** Copy the closure into <serverDir>/node_modules at the same relative paths (merging over traced partial copies). */
export function copyEngine(root, serverDir) {
  const dirs = dependencyClosure(root);
  let bytes = 0;
  for (const dir of dirs) {
    const dest = path.join(serverDir, path.relative(root, dir));
    fs.cpSync(dir, dest, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => {
        if (src !== dir && path.relative(dir, src).split(path.sep)[0] === "node_modules") return false; // nested deps are in the closure themselves
        if (SKIP.test(src)) return false;
        const st = fs.lstatSync(src);
        if (st.isFile()) bytes += st.size;
        return true;
      },
    });
  }
  return { packages: dirs.length, bytes };
}
