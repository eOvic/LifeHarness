import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Desktop builds bundle a self-contained server (node .next/standalone/server.js).
  ...(process.env.LIFEHARNESS_STANDALONE ? { output: "standalone" as const } : {}),
  // The dev-tools badge would sit on top of the sidebar inside the desktop window.
  devIndicators: false,
  // The Pi engine is loaded natively by Node, not bundled (same approach as LearnHarness).
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  // Prompt files are read at runtime from ./prompts
  outputFileTracingIncludes: { "/api/**": ["./prompts/**"], "/**": ["./prompts/**"] },
};

export default nextConfig;
