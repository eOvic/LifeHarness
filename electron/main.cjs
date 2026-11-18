"use strict";
/**
 * LifeHarness desktop shell.
 *
 * Packaged: spawns the Next.js standalone server (resources/server/server.js) with Electron's own
 * Node (ELECTRON_RUN_AS_NODE) on a free 127.0.0.1 port, data in ~/.config/LifeHarness/data, then
 * opens a frameless window on it. Dev: LIFEHARNESS_DEV_URL points at a running `next dev`.
 *
 * Window chrome: no OS title bar. The app's 60px header bands are the title bar (CSS
 * -webkit-app-region: drag); on Linux/Windows the native min/max/close buttons are drawn over
 * the top-right corner (titleBarOverlay) in the theme's colors, and the page leaves room for
 * them with env(titlebar-area-*).
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PRODUCT = "LifeHarness";
const DEV_URL = process.env.LIFEHARNESS_DEV_URL || "";
const isMac = process.platform === "darwin";

app.setName(PRODUCT);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = () => app.getPath("userData");
const dataDir = () => process.env.LIFEHARNESS_DATA_DIR || path.join(userData(), "data");
const logDir = () => path.join(userData(), "logs");

function log(msg) {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    fs.appendFileSync(path.join(logDir(), "main.log"), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* logging must never crash the app */
  }
}

// ---- theme colors for the native chrome (before the page has rendered) ------------------
// Kept in sync with src/core/themes.ts (background + text of each preset).
const THEME_CHROME = {
  default: ["#141414", "#e7e5e1"],
  paper: ["#faf8f4", "#1f1d1a"],
  "catppuccin-mocha": ["#1e1e2e", "#cdd6f4"],
  "catppuccin-latte": ["#eff1f5", "#4c4f69"],
  "rose-pine": ["#191724", "#e0def4"],
  "rose-pine-dawn": ["#faf4ed", "#575279"],
  "gruvbox-dark": ["#282828", "#ebdbb2"],
  nord: ["#2e3440", "#eceff4"],
};
function chromeColors() {
  let id = "default";
  try {
    id = JSON.parse(fs.readFileSync(path.join(dataDir(), "settings.json"), "utf8")).theme || "default";
  } catch {
    /* no settings yet */
  }
  const [color, symbolColor] = THEME_CHROME[id] || THEME_CHROME.default;
  return { color, symbolColor };
}

// ---- window state ---------------------------------------------------------------------------
const stateFile = () => path.join(userData(), "window-state.json");
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1440, height: 900 };
  }
}
function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* ignore */
  }
}

// ---- the local server --------------------------------------------------------------------
let server = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitHealthy(url, child, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child && child.exitCode !== null) return reject(new Error(`server exited with code ${child.exitCode}`));
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => (Date.now() - started > timeoutMs ? reject(new Error("server did not become ready in time")) : setTimeout(tick, 150));
    tick();
  });
}

async function startServer() {
  const serverJs = path.join(process.resourcesPath, "server", "server.js");
  if (!fs.existsSync(serverJs)) throw new Error(`server not found at ${serverJs}`);
  const port = await freePort();
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
  const out = fs.openSync(path.join(logDir(), "server.log"), "a");
  server = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1", // never listen on the network
      LIFEHARNESS_DATA_DIR: dataDir(),
      LIFEHARNESS_DESKTOP: "1",
    },
    stdio: ["ignore", out, out],
  });
  server.on("exit", (code) => log(`server exited (${code})`));
  const url = `http://127.0.0.1:${port}`;
  await waitHealthy(url, server);
  log(`server ready on ${url}`);
  return url;
}

function stopServer() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    setTimeout(() => server && server.exitCode === null && server.kill("SIGKILL"), 2000).unref();
  }
}

// ---- window --------------------------------------------------------------------------------
let win = null;

function createWindow(url) {
  const state = loadState();
  const chrome = chromeColors();
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1440,
    height: state.height || 900,
    minWidth: 760,
    minHeight: 560,
    title: PRODUCT,
    show: false,
    backgroundColor: chrome.color, // no white flash during first paint or live resize
    ...(isMac
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 22 } }
      : { titleBarStyle: "hidden", titleBarOverlay: chrome, autoHideMenuBar: true }),
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  if (state.maximized) win.maximize();

  const origin = new URL(url).origin;
  // Links: in-app navigation stays in-app; anything else opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^(https?|mailto):/.test(target) && !target.startsWith(origin)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!target.startsWith(origin)) {
      e.preventDefault();
      if (/^(https?|mailto):/.test(target)) shell.openExternal(target);
    }
  });

  win.once("ready-to-show", () => win.show());
  win.on("close", () => saveState(win));
  win.on("closed", () => (win = null));
  // Redirects (/ -> /start) and client-side navigations can abort the initial load promise: harmless.
  const start = url + (process.env.LIFEHARNESS_SHOT_PATH || "");
  win.loadURL(start).catch((err) => log(`initial load: ${err.message}`));

  // Automation hook: LIFEHARNESS_SHOT=/path.png [LIFEHARNESS_SHOT_PATH=/today] captures the window, then quits.
  // (Loads the target directly: a second navigation during dev-mode compiles can trap HMR in a reload loop.)
  if (process.env.LIFEHARNESS_SHOT) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.LIFEHARNESS_SHOT, img.toPNG());
          log(`screenshot saved to ${process.env.LIFEHARNESS_SHOT}`);
        } catch (err) {
          log(`screenshot failed: ${err}`);
        }
        app.quit();
      }, Number(process.env.LIFEHARNESS_SHOT_DELAY || 2500));
    });
  }
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open data folder", click: () => shell.openPath(dataDir()) },
        { label: "Open logs folder", click: () => shell.openPath(logDir()) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The renderer reports theme changes so the native chrome follows.
ipcMain.on("lh:set-chrome", (e, c) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || !c || typeof c.background !== "string") return;
  try {
    w.setBackgroundColor(c.background);
    if (!isMac && typeof w.setTitleBarOverlay === "function") w.setTitleBarOverlay({ color: c.background, symbolColor: c.symbol });
  } catch (err) {
    log(`set-chrome failed: ${err}`);
  }
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  buildMenu();
  // Deny-by-default permissions; only clipboard writes (copy buttons) are allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write"));
  try {
    const url = DEV_URL || (await startServer());
    createWindow(url);
  } catch (err) {
    log(`startup failed: ${err && err.stack}`);
    let tail = "";
    try {
      tail = fs.readFileSync(path.join(logDir(), "server.log"), "utf8").split("\n").slice(-15).join("\n");
    } catch {
      /* no log */
    }
    dialog.showErrorBox(`${PRODUCT} could not start`, `${err && err.message}\n\n${tail}\n\nLogs: ${logDir()}`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
app.on("activate", () => {
  if (!win && BrowserWindow.getAllWindows().length === 0 && DEV_URL) createWindow(DEV_URL);
});
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
