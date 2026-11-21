// The bridge the desktop app's preload script exposes (absent in a plain browser).
export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  setChrome: (c: { background: string; symbol: string }) => void;
  /** Open one of the app's own folders in the file manager (older shells don't have it). */
  openFolder?: (which: "data" | "config" | "logs" | "licenses") => void;
  /** Re-read reminders, background and login settings now (after saving them or adopting a plan). */
  refreshShell?: () => void;
  /** What this shell can do: starting at login needs the installed app (on macOS, in Applications). */
  shellInfo?: () => Promise<ShellInfo>;
  /** Show a test notification (shells before 0.6 don't have it). */
  testReminder?: () => Promise<{ result: "shown" | "sent" | "failed" | "unsupported"; error?: string }>;
}

export interface ShellInfo {
  atLoginSupported: boolean;
  /** Why starting at login isn't available, in a few words (older shells don't say). */
  atLoginNote?: string;
  /** "failed": the system refused a notification this run (on macOS: an app it can't verify). */
  notifications?: "untested" | "shown" | "failed";
}

export function desktop(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { lifeharness?: DesktopBridge }).lifeharness;
}
