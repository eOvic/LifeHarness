import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Pi engine is loaded natively by Node, not bundled (same approach as LearnHarness).
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  // Prompt files are read at runtime from ./prompts
  outputFileTracingIncludes: { "/api/**": ["./prompts/**"] },
};

export default nextConfig;
