"use strict";
// The only bridge between the page and the desktop shell. Sandboxed: no Node APIs leak in.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifeharness", {
  isDesktop: true,
  platform: process.platform,
  /** Recolor the native window chrome (title bar buttons, resize background) to the theme. */
  setChrome: (c) => ipcRenderer.send("lh:set-chrome", { background: String(c.background), symbol: String(c.symbol) }),
});
