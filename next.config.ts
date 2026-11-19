import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Desktop builds bundle a self-contained server (node .next/standalone/server.js).
  ...(process.env.LIFEHARNESS_STANDALONE ? { output: "standalone" as const } : {}),
  // Shown in Settings → About (the desktop shell passes the same value at runtime).
  env: { LIFEHARNESS_VERSION: pkg.version },
  // The dev-tools badge would sit on top of the sidebar inside the desktop window.
  devIndicators: false,
  // The Pi engine is loaded natively by Node, not bundled (same approach as LearnHarness).
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  // Prompt files are read at runtime from ./prompts
  outputFileTracingIncludes: { "/api/**": ["./prompts/**"], "/**": ["./prompts/**"] },
  // Never trace build outputs, sources or tooling into the server (a stray heuristic once pulled the
  // desktop installers in; scripts/desktop-build.mjs also refuses such a build).
  outputFileTracingExcludes: {
    "/**": ["./dist-desktop/**", "./desktop-app/**", "./shots/**", "./docs/**", "./tests/**", "./scripts/**", "./build/**", "./electron/**", "./data/**"],
  },
};

export default nextConfig;
