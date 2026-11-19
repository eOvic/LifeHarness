// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  // Desktop app: the shell keeps our stdin open for as long as it runs. When stdin ends (the app quit,
  // or the shell crashed or was killed), exit too, so no server is ever left running on its own.
  // On Windows such an orphan would also block installing an update. Set only by electron/main.cjs.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.LIFEHARNESS_EXIT_WITH_STDIN === "1") {
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("error", () => process.exit(0));
    process.stdin.resume();
  }
}
