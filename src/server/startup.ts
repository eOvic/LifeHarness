// Server start-up work (Node.js only). instrumentation.ts imports this in the Node.js runtime.
import { sweepClaudeRuns } from "./claude-runs";

export function onServerStart() {
  // Remove Claude Code run folders nothing uses any more (servers that are gone, older versions'
  // temp folders): they hold copies of the coaching prompt with the person's life context.
  try {
    sweepClaudeRuns();
  } catch {
    /* never block start-up */
  }

  // Desktop app: the shell keeps our stdin open for as long as it runs. When stdin ends (the app quit,
  // or the shell crashed or was killed), exit too, so no server is ever left running on its own.
  // On Windows such an orphan would also block installing an update. Set only by electron/main.cjs.
  if (process.env.LIFEHARNESS_EXIT_WITH_STDIN === "1") {
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("error", () => process.exit(0));
    process.stdin.resume();
  }
}
