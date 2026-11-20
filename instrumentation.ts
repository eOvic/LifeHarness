// Runs once when the server starts (Next.js instrumentation hook). Next also compiles this file for its
// Edge runtime, so the Node.js-only work lives in src/server/startup.ts, imported only on Node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onServerStart } = await import("./src/server/startup");
    onServerStart();
  }
}
