"use strict";
// "Start when I log in", in the background: the file each OS reads at login (pure text, tested in
// tests/shell.test.ts). main.cjs writes it when the setting is on and deletes it when it's off.
//   Linux:   ~/.config/autostart/lifeharness.desktop      (freedesktop autostart)
//   macOS:   ~/Library/LaunchAgents/<LABEL>.plist          (launchd, at the next login)
//   Windows: app.setLoginItemSettings (the registry), in main.cjs
// macOS has app.setLoginItemSettings too, but it can't pass --background, and Electron warns it can fail
// silently for an app that isn't signed and notarized by Apple. A LaunchAgent is plain launchd.

const LABEL = "dev.lifeharness.desktop"; // electron-builder.yml appId: the app's bundle identifier on macOS

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** macOS: start <exe> <args> at login, in the logged-in user's session. AssociatedBundleIdentifiers
 *  lists it under LifeHarness's own name in System Settings → General → Login Items (macOS 13+). */
function launchAgentPlist(exe, args) {
  const argv = [exe, ...args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>${LABEL}</string>
  </array>
</dict>
</plist>
`;
}

/** Linux: the autostart entry (an AppImage passes its own path and --no-sandbox in args). */
function autostartEntry(exe, args, product) {
  return `[Desktop Entry]\nType=Application\nName=${product}\nComment=Reminders for your plan\nExec="${exe}" ${args.join(" ")}\nIcon=lifeharness\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n`;
}

module.exports = { LABEL, launchAgentPlist, autostartEntry };
