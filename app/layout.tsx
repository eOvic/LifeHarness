import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { connection } from "next/server";
import { AppearanceProvider } from "@/components/appearance";
import Shell from "@/components/Shell";
import { themeById, themeVars } from "@/src/core/themes";
import { isMac } from "@/src/server/platform";
import { getSettings } from "@/src/server/store";
import "./globals.css";

// Chrome = JetBrains Mono · reading = Source Sans 3 · titles = Source Serif 4.
// next/font self-hosts the files at build time: no network needed at runtime (desktop app).
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const sans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "LifeHarness",
  description: "From what you want in life to a week you can actually live.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme is per-machine state: render it on the server so the first frame is already right.
  await connection();
  const theme = themeById(getSettings().theme);
  // The server only listens on this computer, so its OS is the person's: ⌘ shortcuts on a Mac, and in
  // the desktop app room for the window's traffic lights from the first frame (globals.css).
  const mac = isMac();
  return (
    <html
      lang="en"
      data-chrome={mac && process.env.LIFEHARNESS_DESKTOP === "1" ? "mac" : undefined}
      className={`${theme.mode} ${mono.variable} ${sans.variable} ${serif.variable}`}
      style={themeVars(theme) as React.CSSProperties}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <AppearanceProvider initialThemeId={theme.id}>
          <Shell mac={mac}>{children}</Shell>
        </AppearanceProvider>
      </body>
    </html>
  );
}
