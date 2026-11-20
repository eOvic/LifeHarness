// Private folders for Claude Code runs.
//
// Each Claude Code process gets an empty working folder and a private one that holds our system prompt
// (which carries the person's life context) and the tool bridge's config (its token). Found on a
// Windows PC: these lived in the system temp folder, which Windows never cleans, and they were left
// behind whenever the app quit with a process still running. So they now live inside the app's own
// private folder (claude-code/runs/), one subfolder per server process:
//   - a run's folders are removed when its process ends;
//   - the server's subfolder is removed when the server exits (synchronously, so it really happens);
//   - at start-up, subfolders of servers that are gone are removed, and so are the lifeharness-claude-*
//     folders that versions up to 0.3.3 left in the system temp folder.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateDir } from "./config-dir";

export const runsRoot = () => path.join(/*turbopackIgnore: true*/ privateDir(), "claude-code", "runs");
const LEGACY = /^lifeharness-claude-/;
const g = globalThis as unknown as { __lhRunsDir?: string };

/** This server's folder for Claude Code runs: created on first use, readable only by you, removed on exit. */
export function serverRunsDir(): string {
  if (!g.__lhRunsDir) {
    const dir = path.join(/*turbopackIgnore: true*/ runsRoot(), `${process.pid}-${randomBytes(4).toString("hex")}`);
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true, mode: 0o700 });
    g.__lhRunsDir = dir;
    process.once("exit", () => {
      try {
        fs.rmSync(/*turbopackIgnore: true*/ dir, { recursive: true, force: true });
      } catch {
        /* a file still in use (Windows): the next start-up removes it */
      }
    });
  }
  return g.__lhRunsDir;
}

/** A new private folder for one Claude Code run. */
export const makeRunDir = (prefix: "lifeharness-claude-cwd-" | "lifeharness-claude-") => fs.mkdtempSync(path.join(/*turbopackIgnore: true*/ serverRunsDir(), prefix));

/** Is that server process still running? (EPERM: it exists, it just isn't ours to signal.) */
function alive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Remove run folders that nothing uses any more. Called once when the server starts. */
export function sweepClaudeRuns(o: { root?: string; tmp?: string; now?: number } = {}): number {
  const root = o.root ?? runsRoot();
  const tmp = o.tmp ?? os.tmpdir();
  const now = o.now ?? Date.now();
  let removed = 0;
  const remove = (p: string) => {
    try {
      fs.rmSync(/*turbopackIgnore: true*/ p, { recursive: true, force: true });
      removed++;
    } catch {
      /* still in use, or already gone */
    }
  };
  const list = (dir: string) => {
    try {
      return fs.readdirSync(/*turbopackIgnore: true*/ dir);
    } catch {
      return [];
    }
  };
  // This app's runs: one subfolder per server process, named <pid>-<random>.
  for (const name of list(root)) {
    const dir = path.join(/*turbopackIgnore: true*/ root, name);
    const pid = Number(name.split("-")[0]);
    const mine = dir === g.__lhRunsDir;
    if (!mine && (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !alive(pid))) remove(dir);
  }
  // Left in the system temp folder by versions up to 0.3.3. Ten minutes' grace, in case an older
  // LifeHarness is running right now.
  for (const name of list(tmp)) {
    if (!LEGACY.test(name)) continue;
    const dir = path.join(/*turbopackIgnore: true*/ tmp, name);
    try {
      if (now - fs.statSync(/*turbopackIgnore: true*/ dir).mtimeMs > 10 * 60_000) remove(dir);
    } catch {
      /* gone */
    }
  }
  return removed;
}
