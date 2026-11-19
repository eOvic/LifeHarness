// Third-party notices for the desktop app.
//
// The packaged app redistributes other people's work:
//   - the server's node_modules: Next, React, the Pi engine and its SDKs;
//   - packages compiled into the app's own bundles: react-markdown, lucide icons, adhan, …;
//   - three fonts.
// Their licenses (MIT, BSD, ISC, Apache-2.0, OFL) require their notices to travel with every copy,
// but bundling keeps only code. This script collects them into resources/licenses/THIRD_PARTY_NOTICES.txt,
// next to LifeHarness's own LICENSE. Electron and Chromium ship their own notices:
// LICENSE.electron.txt and LICENSES.chromium.html.
//
//   node scripts/third-party-notices.mjs <server-dir> [out-file]     (run by scripts/after-pack.cjs)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dependencyClosure } from "./server-deps.mjs";

/** Installed, but never part of the app: build tools, and sharp (left out on purpose, see next.config.ts). */
const NOT_BUNDLED = /^(sharp|@img\/.+|@next\/swc-.+)$/;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(?![a-z])/i;
const CODE_FILE = /\.(c?js|mjs|ts|json|map)$/i;
const RULE = "-".repeat(78);

export const FONTS = [
  { family: "JetBrains Mono", file: "JetBrainsMono-OFL.txt", home: "https://github.com/JetBrains/JetBrainsMono" },
  { family: "Source Sans 3", file: "SourceSans3-OFL.txt", home: "https://github.com/adobe-fonts/source-sans" },
  { family: "Source Serif 4", file: "SourceSerif4-OFL.txt", home: "https://github.com/adobe-fonts/source-serif" },
];

const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const person = (p) => (typeof p === "string" ? p : p?.name ? p.name + (p.email ? ` <${p.email}>` : "") : "");
const licenseId = (pj) => {
  let l = pj.license ?? pj.licenses;
  if (Array.isArray(l)) l = l.map((x) => x.type ?? x).join(" OR ");
  if (l && typeof l === "object") l = l.type;
  return l || "UNKNOWN";
};
const sourceUrl = (pj) => {
  const r = typeof pj.repository === "string" ? pj.repository : pj.repository?.url;
  if (!r) return pj.homepage ?? "";
  if (/^[\w.-]+\/[\w.-]+$/.test(r)) return `https://github.com/${r}`; // npm's "owner/repo" shorthand
  return r
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git$/, "");
};

/** The license, copying and notice files a package ships with (e.g. LICENSE, LICENSE.md, NOTICE). */
function licenseTexts(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((f) => LICENSE_FILE.test(f) && !CODE_FILE.test(f))
    .sort()
    .flatMap((f) => {
      const file = path.join(dir, f);
      if (!fs.statSync(file).isFile()) return [];
      const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
      return text ? [text] : [];
    });
}

/** Everything installed in the shipped server, plus everything the app's bundles can contain (the
 *  production dependency closure). A package that's in both is listed once. */
function collect(root, serverDir) {
  const byKey = new Map();
  const add = (dir, shipped) => {
    const pj = readJson(path.join(dir, "package.json"));
    if (!pj?.name || !pj.version) return;
    const key = `${pj.name}@${pj.version}`;
    const known = byKey.get(key);
    if (known) {
      known.dirs.push(dir);
      known.shipped ||= shipped;
    } else byKey.set(key, { name: pj.name, version: pj.version, pj, dirs: [dir], shipped });
  };
  const walk = (nodeModules) => {
    let entries = [];
    try {
      entries = fs.readdirSync(nodeModules, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const dir = path.join(nodeModules, e.name);
      if (e.name.startsWith("@")) walk(dir);
      else if (fs.existsSync(path.join(dir, "package.json"))) {
        add(dir, true);
        walk(path.join(dir, "node_modules"));
      }
    }
  };
  walk(path.join(serverDir, "node_modules"));
  const app = readJson(path.join(root, "package.json"));
  for (const dir of dependencyClosure(root, Object.keys(app.dependencies ?? {}))) {
    const pj = readJson(path.join(dir, "package.json"));
    if (pj?.name && !NOT_BUNDLED.test(pj.name)) add(dir, false);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Writes the notices file; returns what it covered. */
export function writeNotices({ root, serverDir, out }) {
  const packages = collect(root, serverDir);
  const declaredOnly = [];
  let apacheText = null;
  const entries = packages.map((p) => {
    const texts = [...new Set(p.dirs.flatMap(licenseTexts))];
    const id = licenseId(p.pj);
    const head = [`${p.name} ${p.version}`, `License: ${id}`, sourceUrl(p.pj)].filter(Boolean).join("\n");
    for (const t of texts) if (!apacheText && /Apache License\s+Version 2\.0, January 2004/.test(t) && /END OF TERMS AND CONDITIONS/.test(t)) apacheText = t;
    if (texts.length) return `${head}\n\n${texts.join("\n\n")}`;
    // Some npm releases carry no license file at all; give the license they declare.
    declaredOnly.push(p.name);
    const why = `(This package's npm release has no license file; its package.json declares ${id}.)`;
    if (/^MIT$/i.test(id)) return `${head}\n\n${why}\n\n${MIT(person(p.pj.author) || `the ${p.name} authors`)}`;
    if (/^Apache-2\.0$/i.test(id)) return `${head}\n\n${why} The Apache License 2.0 is reproduced at the end of this file.`;
    return `${head}\n\n${why}`;
  });

  const fonts = FONTS.map((f) => {
    const file = path.join(root, "licenses", "fonts", f.file);
    if (!fs.existsSync(file)) throw new Error(`font license missing: licenses/fonts/${f.file}`);
    return `${f.family}\nLicense: OFL-1.1\n${f.home}\n\n${fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim()}`;
  });

  const shipped = packages.filter((p) => p.shipped).length;
  const text = [
    "LifeHarness: third-party notices",
    "================================",
    "",
    "LifeHarness is free software under the GNU Affero General Public License v3 (see LICENSE next",
    "to this file). The app also contains the third-party software below, each under its own",
    "license. Electron's and Chromium's notices are in LICENSE.electron.txt and",
    "LICENSES.chromium.html in the application folder.",
    "",
    "Parts of LifeHarness's Claude Code provider (src/server/claude-code.ts and",
    "claude-code-bridge.ts) are adapted from LearnHarness by Amos Blomqvist",
    "(https://github.com/amosblomqvist/learnharness), licensed under the GNU AGPL v3.",
    "",
    `Contents: ${fonts.length} fonts, ${packages.length} packages (${shipped} installed in the app's server, the rest compiled into its bundles).`,
    "",
    "",
    "FONTS",
    "=====",
    ...fonts.flatMap((f) => [RULE, f, ""]),
    "",
    "PACKAGES",
    "========",
    ...entries.flatMap((e) => [RULE, e, ""]),
    ...(declaredOnly.length && apacheText ? ["", "APACHE LICENSE 2.0", "==================", RULE, apacheText, ""] : []),
  ].join("\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text + "\n");
  return { packages: packages.length, shipped, bundled: packages.length - shipped, fonts: fonts.length, declaredOnly, bytes: Buffer.byteLength(text) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [serverDir, out] = process.argv.slice(2);
  if (!serverDir || !out) {
    console.error("usage: node scripts/third-party-notices.mjs <server-dir> <out-file>");
    process.exit(2);
  }
  const r = writeNotices({ root: process.cwd(), serverDir, out });
  console.log(
    `notices: ${r.packages} packages (${r.shipped} in the server, ${r.bundled} bundled), ${r.fonts} fonts, ` +
      `${(r.bytes / 1024).toFixed(0)} KB → ${out}; declared license only: ${r.declaredOnly.length}`,
  );
}
