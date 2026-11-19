// Runs the Next.js CLI with telemetry off, on any OS (npm scripts can't set an environment variable
// the same way on Linux, macOS and Windows).
//   node scripts/next.mjs dev -H 127.0.0.1 -p 3210
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const bin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
