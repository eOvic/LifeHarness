"use strict";
// The only bridge between the page and the desktop shell. Sandboxed: no Node APIs leak in.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifeharness", {
  isDesktop: true,
  platform: process.platform,
  /** Recolor the native window chrome (title bar buttons, resize background) to the theme. */
  setChrome: (c) => ipcRenderer.send("lh:set-chrome", { background: String(c.background), symbol: String(c.symbol) }),
  /** Open one of the app's own folders: "data" | "config" | "logs" (nothing else). */
  openFolder: (which) => ipcRenderer.send("lh:open-folder", String(which)),
  /** Re-read reminders, background and login settings now. */
  refreshShell: () => ipcRenderer.send("lh:refresh-shell"),
  /** { atLoginSupported, atLoginNote, notifications } */
  shellInfo: () => ipcRenderer.invoke("lh:shell-info"),
  /** Show a test notification: { result: "shown" | "sent" | "failed" | "unsupported", error? } */
  testReminder: () => ipcRenderer.invoke("lh:test-reminder"),
});
