// Windows and macOS behaviour, tested on any OS: LIFEHARNESS_PLATFORM=win32 or darwin makes
// src/server/platform.ts report that OS. Covers what a Windows PC turned up (finding Claude Code, saving
// while another program holds a file, a window restored off-screen) and what a Mac needs (Claude Code
// for an app opened from the Dock, where settings live).
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findClaude } from "@/src/server/claude-code";
import { configDir } from "@/src/server/config-dir";
import { makeRunDir, runsRoot, sweepClaudeRuns } from "@/src/server/claude-runs";
import { replaceFile } from "@/src/server/store";

const ENV_KEYS = ["PATH", "HOME", "APPDATA", "LOCALAPPDATA", "USER", "XDG_CONFIG_HOME", "npm_config_prefix", "LIFEHARNESS_CLAUDE_BIN", "LIFEHARNESS_CONFIG_DIR", "LIFEHARNESS_PLATFORM"];
let saved: Record<string, string | undefined> = {};
let root = "";
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-platform-"));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.HOME = path.join(root, "home"); // never find the real Claude Code
  process.env.PATH = "";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  fs.rmSync(root, { recursive: true, force: true });
});

/** Creates a file (executable, so the finder's X_OK check passes on Linux too). */
const put = (rel: string, text = "") => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { mode: 0o755 });
  return p;
};
/** An npm cmd-shim, as `npm i -g` writes it on Windows. */
const npmShim = (target: string) =>
  `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*\r\n`;

describe("finding Claude Code", () => {
  it("source: bundled code never tests process.platform itself (Turbopack would decide it at build time)", () => {
    const offenders: string[] = [];
    const visit = (p: string) => {
      if (fs.statSync(p).isDirectory()) for (const e of fs.readdirSync(p)) visit(path.join(p, e));
      else if (/\.(ts|tsx|js|mjs)$/.test(p) && p !== path.join("src", "server", "platform.ts") && fs.readFileSync(p, "utf8").includes("process.platform")) offenders.push(p);
    };
    for (const r of ["src", "app", "lib", "components", "proxy.ts", "instrumentation.ts"]) if (fs.existsSync(r)) visit(r);
    expect(offenders).toEqual([]);
  });

  it("Windows: claude.exe from Anthropic's installer (~\\.local\\bin), even when it isn't on PATH", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    const exe = put("home/.local/bin/claude.exe");
    put("home/.local/bin/claude", "#!/bin/sh"); // a Unix script beside it doesn't count on Windows
    expect(findClaude()).toEqual({ file: exe, pre: [] });
  });

  it("Windows: a quoted PATH entry", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    const exe = put("Program Files/Claude/claude.exe");
    process.env.PATH = `"${path.dirname(exe)}"`;
    expect(findClaude()).toEqual({ file: exe, pre: [] });
  });

  it("Windows: an npm shim is resolved to the native claude.exe it starts (no cmd.exe)", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    process.env.APPDATA = path.join(root, "roaming");
    put("roaming/npm/claude.cmd", npmShim("node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"));
    const exe = put("roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe");
    expect(findClaude()).toEqual({ file: exe, pre: [] });
  });

  it("Windows: an npm shim to JavaScript runs on the node.exe beside it, else on LifeHarness's own Node", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    const shim = put("npm/claude.cmd", npmShim("node_modules\\@anthropic-ai\\claude-code\\cli.js"));
    const cli = put("npm/node_modules/@anthropic-ai/claude-code/cli.js");
    process.env.PATH = path.dirname(shim);
    expect(findClaude()).toEqual({ file: process.execPath, pre: [cli], env: { ELECTRON_RUN_AS_NODE: "1" } });
    const node = put("npm/node.exe");
    expect(findClaude()).toEqual({ file: node, pre: [cli] });
  });

  it("Windows: a shim whose program is missing is skipped, and the search goes on", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    const broken = put("a/claude.cmd", npmShim("node_modules\\gone\\claude.exe"));
    const exe = put("b/claude.exe");
    process.env.PATH = [path.dirname(broken), path.dirname(exe)].join(path.delimiter);
    expect(findClaude()).toEqual({ file: exe, pre: [] });
  });

  it("Linux and macOS: only `claude` counts", () => {
    process.env.LIFEHARNESS_PLATFORM = "linux";
    put("bin/claude.exe");
    put("bin/claude.cmd", npmShim("x\\claude.exe"));
    process.env.PATH = path.join(root, "bin");
    expect(findClaude()).toBeUndefined();
    const bin = put("bin/claude", "\x7fELF"); // a native program (Anthropic's installer): run as it is
    expect(findClaude()).toEqual({ file: bin, pre: [] });
  });

  it("macOS: npm's Claude Code is a Node script; opened from the Dock, its own folder (with Node) and Homebrew's come first on PATH", () => {
    process.env.LIFEHARNESS_PLATFORM = "darwin";
    process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"; // what an app opened from the Dock or Finder gets
    const script = put("home/.local/bin/claude", "#!/usr/bin/env node\nrequire('./cli.js')");
    expect(findClaude()).toEqual({
      file: script,
      pre: [],
      env: { PATH: [path.dirname(script), "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"].join(":") },
    });
  });

  it("Linux: a script gets its own folder first on PATH, and nothing Mac-specific", () => {
    process.env.LIFEHARNESS_PLATFORM = "linux";
    const script = put("bin/claude", "#!/bin/sh");
    process.env.PATH = [path.join(root, "bin"), "/usr/bin"].join(":");
    expect(findClaude()).toEqual({ file: script, pre: [], env: { PATH: [path.join(root, "bin"), "/usr/bin"].join(":") } });
  });
});

describe("where LifeHarness keeps its settings and sign-ins", () => {
  it("macOS: ~/Library/Application Support/LifeHarness, where Electron puts the app's own files", () => {
    process.env.LIFEHARNESS_PLATFORM = "darwin";
    expect(configDir()).toBe(path.join(root, "home", "Library", "Application Support", "LifeHarness"));
  });
  it("Linux: ~/.config/LifeHarness, or under XDG_CONFIG_HOME", () => {
    process.env.LIFEHARNESS_PLATFORM = "linux";
    expect(configDir()).toBe(path.join(root, "home", ".config", "LifeHarness"));
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
    expect(configDir()).toBe(path.join(root, "xdg", "LifeHarness"));
  });
});

describe("saving while another program holds the file", () => {
  const busy = (code: string) => Object.assign(new Error(`${code}: file in use`), { code });
  let tmp = "";
  let target = "";
  beforeEach(() => {
    target = path.join(root, "profile.json");
    tmp = `${target}.tmp`;
    fs.writeFileSync(target, "old");
    fs.writeFileSync(tmp, "new");
  });

  it("Windows: retries until the other program lets go, then replaces the file", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    let calls = 0;
    replaceFile(tmp, target, (a, b) => {
      if (++calls < 3) throw busy("EPERM");
      fs.renameSync(a, b);
    });
    expect(calls).toBe(3);
    expect(fs.readFileSync(target, "utf8")).toBe("new");
  });

  it("Windows: gives up after about 2 s, removes the temporary file and keeps the old data", () => {
    process.env.LIFEHARNESS_PLATFORM = "win32";
    const t0 = Date.now();
    expect(() => replaceFile(tmp, target, () => { throw busy("EBUSY"); })).toThrow("EBUSY");
    expect(Date.now() - t0).toBeGreaterThan(1500);
    expect(fs.existsSync(tmp)).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("old");
  });

  it("Linux: fails at once, because a failed rename there is a real problem", () => {
    process.env.LIFEHARNESS_PLATFORM = "linux";
    let calls = 0;
    expect(() => replaceFile(tmp, target, () => { calls++; throw busy("EPERM"); })).toThrow("EPERM");
    expect(calls).toBe(1);
    expect(fs.existsSync(tmp)).toBe(false);
  });
});

describe("Claude Code run folders (they hold the coaching prompt, with the person's life context)", () => {
  const folder = (p: string, ageMs = 0) => {
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "system-prompt.md"), "life context");
    if (ageMs) fs.utimesSync(p, new Date(Date.now() - ageMs), new Date(Date.now() - ageMs));
  };

  it("live in the app's own private folder, not the system temp folder", () => {
    process.env.LIFEHARNESS_AUTH_FILE = path.join(root, "config", "auth.json");
    const dir = makeRunDir("lifeharness-claude-");
    expect(dir.startsWith(runsRoot() + path.sep)).toBe(true);
    expect(runsRoot()).toBe(path.join(root, "config", "claude-code", "runs"));
    expect(fs.readdirSync(path.dirname(dir))).toContain(path.basename(dir));
  });

  it("start-up removes folders of servers that are gone and old versions' temp leftovers, nothing else", () => {
    const runs = path.join(root, "runs");
    const tmp = path.join(root, "tmp");
    folder(path.join(runs, "99999999-a1b2c3d4")); // a server that's gone
    folder(path.join(runs, `${process.ppid}-e5f6a7b8`)); // a server that's running
    folder(path.join(runs, "not-a-run")); // not one of ours
    folder(path.join(tmp, "lifeharness-claude-Ab12Cd"), 3_600_000); // left by 0.3.3
    folder(path.join(tmp, "lifeharness-claude-cwd-Ef34Gh"), 3_600_000);
    folder(path.join(tmp, "lifeharness-claude-Ij56Kl")); // minutes old: an older LifeHarness may be running
    folder(path.join(tmp, "another-app"), 3_600_000);
    expect(sweepClaudeRuns({ root: runs, tmp })).toBe(4);
    expect(fs.readdirSync(runs)).toEqual([`${process.ppid}-e5f6a7b8`]);
    expect(fs.readdirSync(tmp).sort()).toEqual(["another-app", "lifeharness-claude-Ij56Kl"]);
  });
});

describe("where the window opens", () => {
  const { fitToScreen } = createRequire(import.meta.url)("../electron/window-state.cjs") as {
    fitToScreen: (s: Record<string, number>, screen: unknown) => { x?: number; y?: number; width: number; height: number };
  };
  type Area = { x: number; y: number; width: number; height: number };
  /** A stand-in for Electron's screen module: the display a rectangle overlaps most, else the primary. */
  const screenOf = (...areas: Area[]) => {
    const overlap = (r: Area, a: Area) =>
      Math.max(0, Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x)) * Math.max(0, Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y));
    return {
      getPrimaryDisplay: () => ({ workArea: areas[0] }),
      getDisplayMatching: (r: Area) => ({ workArea: areas.reduce((best, a) => (overlap(r, a) > overlap(r, best) ? a : best), areas[0]) }),
    };
  };
  const laptop = { x: 0, y: 0, width: 1920, height: 1040 };
  const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1040 };

  it("a fresh install: default size, centred by the OS", () => {
    expect(fitToScreen({}, screenOf(laptop))).toEqual({ width: 1440, height: 900 });
  });
  it("a normal saved position is kept exactly", () => {
    expect(fitToScreen({ x: 200, y: 80, width: 1200, height: 800 }, screenOf(laptop))).toEqual({ x: 200, y: 80, width: 1200, height: 800 });
  });
  it("on a monitor that was unplugged: centred on the remaining display", () => {
    expect(fitToScreen({ x: -1700, y: 100, width: 1440, height: 900 }, screenOf(laptop))).toEqual({ width: 1440, height: 900 });
  });
  it("still on a monitor that's connected: kept there", () => {
    expect(fitToScreen({ x: -1700, y: 100, width: 1440, height: 900 }, screenOf(laptop, leftMonitor))).toEqual({ x: -1700, y: 100, width: 1440, height: 900 });
  });
  it("half off-screen: pulled fully inside", () => {
    expect(fitToScreen({ x: 1700, y: 100, width: 1440, height: 900 }, screenOf(laptop))).toEqual({ x: 480, y: 100, width: 1440, height: 900 });
  });
  it("bigger than the screen (scaling changed): shrunk to fit", () => {
    expect(fitToScreen({ x: 0, y: 0, width: 2600, height: 1500 }, screenOf(laptop))).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });
});
