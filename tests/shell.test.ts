// The desktop shell's pure pieces (electron/*.cjs), tested without Electron: what "Start when I log in"
// writes on each OS, and the macOS guard that keeps the server out of the Dock.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const { LABEL, autostartEntry, launchAgentPlist } = require_("../electron/login-item.cjs") as {
  LABEL: string;
  autostartEntry: (exe: string, args: string[], product: string) => string;
  launchAgentPlist: (exe: string, args: string[]) => string;
};

describe("start when I log in", () => {
  it("macOS: a LaunchAgent that starts the app in the background, listed under LifeHarness's own name", () => {
    const plist = launchAgentPlist("/Applications/LifeHarness.app/Contents/MacOS/LifeHarness", ["--background"]);
    expect(LABEL).toBe("dev.lifeharness.desktop"); // electron-builder.yml appId: the bundle identifier
    expect(plist).toContain(`<key>Label</key>\n  <string>${LABEL}</string>`);
    expect(plist).toContain(
      "<key>ProgramArguments</key>\n  <array>\n    <string>/Applications/LifeHarness.app/Contents/MacOS/LifeHarness</string>\n    <string>--background</string>\n  </array>",
    );
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain(`<key>AssociatedBundleIdentifiers</key>\n  <array>\n    <string>${LABEL}</string>`);
    expect(plist.match(/<dict>/g)).toHaveLength(1);
    expect(plist.match(/<\/dict>/g)).toHaveLength(1);
  });

  it("macOS: a path with XML characters can't break out of its string", () => {
    const plist = launchAgentPlist("/Users/x/Apps & Tools/<LifeHarness>.app/Contents/MacOS/LifeHarness", ["--background"]);
    expect(plist).toContain("<string>/Users/x/Apps &amp; Tools/&lt;LifeHarness&gt;.app/Contents/MacOS/LifeHarness</string>");
    expect(plist).not.toContain("<LifeHarness>");
  });

  it("Linux: the same autostart entry as before (an AppImage passes its own path and --no-sandbox)", () => {
    expect(autostartEntry("/tmp/.mount_x/LifeHarness.AppImage", ["--background", "--no-sandbox"], "LifeHarness")).toBe(
      '[Desktop Entry]\nType=Application\nName=LifeHarness\nComment=Reminders for your plan\nExec="/tmp/.mount_x/LifeHarness.AppImage" --background --no-sandbox\nIcon=lifeharness\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n',
    );
  });
});

describe("macOS: the server's process title stays out of the Dock", () => {
  const guard = path.resolve("electron/server-title-guard.cjs");
  // A child Node that pretends to be macOS, loads the guard, then sets its title as Next does. The native
  // title is what Launch Services would see: on Linux it shows in /proc/self/cmdline.
  const run = (env: Record<string, string>) => {
    const script = `
      Object.defineProperty(process, "platform", { value: "darwin" });
      require(${JSON.stringify(guard)});
      const native = () => require("fs").readFileSync("/proc/self/cmdline", "utf8");
      const before = native();
      process.title = "next-server (v16)";
      console.log(JSON.stringify({ title: process.title, nativeChanged: native() !== before }));`;
    const r = spawnSync(process.execPath, ["-e", script], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...env }, encoding: "utf8" });
    return JSON.parse(r.stdout);
  };

  it.skipIf(!fs.existsSync("/proc/self/cmdline"))("in the desktop server: the title is kept in JavaScript, the native one is untouched", () => {
    expect(run({ ELECTRON_RUN_AS_NODE: "1", LIFEHARNESS_DESKTOP: "1" })).toEqual({ title: "next-server (v16)", nativeChanged: false });
  });

  it.skipIf(!fs.existsSync("/proc/self/cmdline"))("anywhere else it does nothing", () => {
    expect(run({ ELECTRON_RUN_AS_NODE: "1" })).toEqual({ title: "next-server (v16)", nativeChanged: true });
  });
});
