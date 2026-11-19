// Desktop app in development: reuse a running `next dev` (or start one), then open the Electron shell on it.
//   npm run desktop
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";

const win = process.platform === "win32";

const PORT = process.env.PORT || "3210";
const url = `http://127.0.0.1:${PORT}`; // loopback only (never the LAN)
const get = (path) =>
  new Promise((resolve) => {
    http
      .get(`${url}${path}`, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", () => resolve(0));
  });

let next = null;
if ((await get("/api/health")) !== 200) {
  console.log(`starting next dev on ${url} ...`);
  // Next's CLI run by Node directly: no npx and no shell, the same on every OS. On Linux and macOS it
  // gets its own process group, so stopping it also stops next-server (Windows: taskkill /T below).
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  next = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", PORT], {
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    detached: !win,
    windowsHide: true,
  });
  for (let i = 0; i < 300 && (await get("/api/health")) !== 200; i++) await new Promise((r) => setTimeout(r, 300));
}
// Warm up: compile the main routes before the window opens. First-time compiles while the
// window is loading can make dev-mode hot reload loop; warmed routes also paint faster.
console.log("warming up routes ...");
for (const p of ["/", "/start", "/today", "/week", "/review", "/map", "/settings", "/api/state", "/api/chats", "/api/schedule", "/api/settings", "/api/profile"]) await get(p);

const electron = (await import("electron")).default; // path to the binary
// Dev only: Ubuntu 24.04+ blocks Chromium's user-namespace sandbox for unpackaged binaries.
// The packaged .deb installs an AppArmor profile instead, so the shipped app keeps its sandbox.
const args = ["electron/main.cjs", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
const el = spawn(electron, args, { stdio: "inherit", env: { ...process.env, LIFEHARNESS_DEV_URL: url } });

const stopNext = () => {
  if (!next) return;
  try {
    if (win) spawnSync("taskkill", ["/pid", String(next.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); // the whole tree
    else process.kill(-next.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  next = null;
};
el.on("exit", (code) => {
  stopNext();
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    el.kill();
    stopNext();
    process.exit(0);
  });
}
