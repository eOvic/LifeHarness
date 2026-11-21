"use strict";
/**
 * LifeHarness desktop shell.
 *
 * Packaged: spawns the Next.js standalone server (resources/server/server.js) with Electron's own
 * Node (ELECTRON_RUN_AS_NODE) on a free 127.0.0.1 port, data in <userData>/data (~/.config/LifeHarness
 * on Linux, %APPDATA%\LifeHarness on Windows, ~/Library/Application Support/LifeHarness on macOS),
 * then opens a frameless window on it.
 * Dev: LIFEHARNESS_DEV_URL points at a running `next dev`.
 *
 * Window chrome: no OS title bar. The app's 60px header bands are the title bar (CSS
 * -webkit-app-region: drag); on Linux/Windows the native min/max/close buttons are drawn over
 * the top-right corner (titleBarOverlay) in the theme's colors, and the page leaves room for
 * them with env(titlebar-area-*). On macOS the traffic lights sit top-left (trafficLightPosition)
 * and the page leaves room for them there (html[data-chrome="mac"], app/globals.css).
 */
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, screen, shell, session, Tray } = require("electron");
const { LABEL: LOGIN_LABEL, autostartEntry, launchAgentPlist } = require("./login-item.cjs");
const { fitToScreen } = require("./window-state.cjs");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PRODUCT = "LifeHarness";
const DEV_URL = process.env.LIFEHARNESS_DEV_URL || "";
const isMac = process.platform === "darwin";

app.setName(PRODUCT);
// Windows: the same identity as the installer's shortcuts (taskbar grouping, pinning, notifications).
if (process.platform === "win32") app.setAppUserModelId("dev.lifeharness.desktop");
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = () => app.getPath("userData");
const dataDir = () => process.env.LIFEHARNESS_DATA_DIR || path.join(userData(), "data");
const logDir = () => path.join(userData(), "logs");
/** AI sign-ins and keys: the app's own file (never pi's). The server reads and writes it. */
const authFile = () => process.env.LIFEHARNESS_AUTH_FILE || path.join(userData(), "auth.json");

/** Keep logs bounded: past 5 MB, the old file becomes <name>.1 (one generation). */
function rotate(file) {
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.1`);
  } catch {
    /* missing: nothing to rotate */
  }
}

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
// The server holds your life map and AI credentials. Besides listening on loopback only, every
// request must carry this per-launch secret, which only this shell's window sends (see
// guardRequests); other users/processes on the machine and web pages can't use the API.
let server = null;
let serverPort = 0;
let quitting = false;
const apiSecret = randomBytes(32).toString("hex");
const SECRET_HEADER = "x-lifeharness-secret";

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
  const port = serverPort || (await freePort()); // a restart keeps the port: the window's origin stays valid
  serverPort = port;
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
  rotate(path.join(logDir(), "server.log"));
  const out = fs.openSync(path.join(logDir(), "server.log"), "a");
  // macOS: keep Next's process title away from Launch Services, or a second icon appears in the Dock
  // (server-title-guard.cjs, put beside the server by scripts/after-pack.cjs).
  const guard = path.join(process.resourcesPath, "server-title-guard.cjs");
  const args = isMac && fs.existsSync(guard) ? ["--require", guard, serverJs] : [serverJs];
  server = spawn(process.execPath, args, {
    cwd: path.dirname(serverJs),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1", // never listen on the network
      LIFEHARNESS_DATA_DIR: dataDir(),
      LIFEHARNESS_AUTH_FILE: authFile(),
      LIFEHARNESS_API_SECRET: apiSecret,
      LIFEHARNESS_VERSION: app.getVersion(),
      LIFEHARNESS_DESKTOP: "1",
      // Our end of its stdin stays open while this shell lives; when it closes (quit or crash), the
      // server exits too (instrumentation.ts). No server is ever left running on its own.
      LIFEHARNESS_EXIT_WITH_STDIN: "1",
    },
    stdio: ["pipe", out, out],
    windowsHide: true, // no console window on Windows
  });
  fs.closeSync(out);
  const child = server;
  child.on("exit", (code, signal) => {
    log(`server exited (${code ?? signal})`);
    if (!quitting && child === server) restartServer();
  });
  const url = `http://127.0.0.1:${port}`;
  await waitHealthy(url, child);
  log(`server ready on ${url}`);
  return url;
}

// If the server dies (crash, OOM, killed), bring it back on the same port and reload the page.
const restarts = [];
async function restartServer() {
  const now = Date.now();
  while (restarts.length && now - restarts[0] > 60000) restarts.shift();
  restarts.push(now);
  if (restarts.length > 3) {
    log("server keeps exiting; giving up");
    if (win) dialog.showErrorBox(`${PRODUCT} stopped working`, `Its local server keeps exiting. Logs: ${logDir()}`);
    return;
  }
  try {
    await startServer();
    if (win && !win.isDestroyed()) win.webContents.reload();
  } catch (err) {
    log(`restart failed: ${err && err.message}`);
  }
}

function stopServer() {
  quitting = true;
  if (server && server.exitCode === null) {
    server.stdin?.end(); // the server's cue to exit (works the same on every OS)
    server.kill("SIGTERM");
    setTimeout(() => server && server.exitCode === null && server.kill("SIGKILL"), 2000).unref();
  }
}

/** Add the secret to requests for the app's own origin, and strip it from everything else
 *  (including redirects to other sites, which would otherwise carry it along). */
function guardRequests(origin) {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    let own = false;
    try {
      own = new URL(details.url).origin === origin;
    } catch {
      /* not a URL we care about */
    }
    if (own) headers[SECRET_HEADER] = apiSecret;
    else delete headers[SECRET_HEADER];
    callback({ requestHeaders: headers });
  });
}

/** Right-click menu: copy/paste (e.g. an API key), spelling suggestions, links. Electron has none by default. */
function attachContextMenu(w, origin) {
  w.webContents.on("context-menu", (_e, p) => {
    const items = [];
    if (p.misspelledWord) {
      for (const word of (p.dictionarySuggestions || []).slice(0, 5)) items.push({ label: word, click: () => w.webContents.replaceMisspelling(word) });
      items.push({ label: "Add to dictionary", click: () => w.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: "separator" });
    }
    if (p.linkURL && /^(https?|mailto):/.test(p.linkURL) && !p.linkURL.startsWith(origin)) {
      items.push({ label: "Open link in browser", click: () => shell.openExternal(p.linkURL) });
      items.push({ label: "Copy link address", click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: "separator" });
    }
    if (p.isEditable) {
      const f = p.editFlags;
      items.push({ role: "undo", enabled: f.canUndo }, { role: "redo", enabled: f.canRedo }, { type: "separator" });
      items.push({ role: "cut", enabled: f.canCut }, { role: "copy", enabled: f.canCopy }, { role: "paste", enabled: f.canPaste }, { type: "separator" }, { role: "selectAll" });
    } else if (p.selectionText && p.selectionText.trim()) {
      items.push({ role: "copy" });
    }
    while (items.length && items[items.length - 1].type === "separator") items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: w });
  });
}

// ---- window --------------------------------------------------------------------------------
let win = null;

/** The page shown while the local server starts: a data: URL, so it needs nothing from the server.
 *  First launch can take a few seconds (on Windows, antivirus scans the server's files), and without
 *  it there was no window at all until then. Theme colors, the app icon, draggable like a title bar. */
function startingPage({ color, symbolColor }) {
  let icon = "";
  try {
    icon = `<img src="data:image/png;base64,${fs.readFileSync(path.join(__dirname, "icon.png")).toString("base64")}" alt="">`;
  } catch {
    /* no icon: text only */
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${PRODUCT}</title><style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:${color};color:${symbolColor};-webkit-app-region:drag;user-select:none;
  font:12px/1.4 ui-monospace,"JetBrains Mono",SFMono-Regular,Consolas,"Liberation Mono",monospace}
main{display:grid;justify-items:center;gap:20px}
img{width:72px;height:72px}
p{margin:0;letter-spacing:.08em;text-transform:uppercase;animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.8}}
</style></head><body><main>${icon}<p>Starting ${PRODUCT}…</p></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** The app's origin once its server is up: links and the context menu treat it as "in-app". */
let appOrigin = "";
const inApp = (target) => !!appOrigin && target.startsWith(appOrigin);

/** Opens the window at once, on the "Starting…" page; openApp() loads the app into it. */
function createWindow() {
  const state = loadState();
  const bounds = fitToScreen(state, screen); // never off-screen after a monitor or scaling change
  const chrome = chromeColors();
  followTheme(chrome.color);
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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

  // Links: in-app navigation stays in-app; anything else opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^(https?|mailto):/.test(target) && !inApp(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!inApp(target)) {
      e.preventDefault();
      if (/^(https?|mailto):/.test(target)) shell.openExternal(target);
    }
  });

  win.once("ready-to-show", () => win.show());
  win.on("close", () => saveState(win));
  win.on("closed", () => (win = null));
  win.loadURL(startingPage(chrome)).catch(() => {}); // replaced by the app as soon as the server answers
}

/** Load the app into the window once its server is up (optionally on a page, such as /today). */
function openApp(url, page = "") {
  appUrl = url;
  appOrigin = new URL(url).origin;
  if (!win || win.isDestroyed()) return; // closed while starting, or started in the background
  attachContextMenu(win, appOrigin);
  // Redirects (/ -> /start) and client-side navigations can abort the initial load promise: harmless.
  const start = url + (page || process.env.LIFEHARNESS_SHOT_PATH || "");
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

// ---- background, tray, reminders, start at login ---------------------------------------------
// Reminders (src/core/reminders.ts; listed by the server at /api/reminders) need LifeHarness running.
// With "Run in the background" on (the default while any reminder is on), closing the window keeps the
// app in the tray; "Start when I log in" (opt-in) starts it there.
const BACKGROUND_ARG = "--background";
let appUrl = "";
let tray = null;

/** The shell's own settings, read from settings.json (the server writes it). */
function shellSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(path.join(dataDir(), "settings.json"), "utf8"));
  } catch {
    /* none yet: the defaults */
  }
  const r = { blocks: true, evening: true, prayers: false, ...(s.reminders || {}) }; // defaults as in src/core/reminders.ts
  const remindersOn = !!(r.blocks || r.evening || r.prayers);
  return { background: remindersOn && s.background !== false, atLogin: remindersOn && s.atLogin === true };
}

/** Bring the window back (re-creating it if it was closed to the tray), optionally on a page. */
function showApp(page = "") {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (page && appOrigin) win.loadURL(appOrigin + page).catch(() => {});
    return;
  }
  createWindow();
  if (appUrl) openApp(appUrl, page);
}

/** The tray icon; on macOS, the menu bar icon. macOS wants a "template" there: black and transparency, which
 *  it tints for light and dark menu bars (trayTemplate.png, @2x for Retina; scripts/mac-icons.ts). */
function trayImage() {
  if (isMac) {
    const img = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 24, height: 24 });
}

function updateTray() {
  const want = shellSettings().background;
  if (want && !tray) {
    tray = new Tray(trayImage());
    tray.setToolTip(PRODUCT);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${PRODUCT}`, click: () => showApp() },
        { label: "Today", click: () => showApp("/today") },
        { type: "separator" },
        { label: `Quit ${PRODUCT}`, click: () => app.quit() },
      ]),
    );
    if (!isMac) tray.on("click", () => showApp()); // on macOS a click opens the menu, as menu bar icons do
  } else if (!want && tray) {
    tray.destroy();
    tray = null;
  }
}

/** macOS: true when LifeHarness runs from Applications (from Downloads or the disk image, macOS gives it a
 *  temporary read-only path, which can't be started at login). Always true elsewhere. */
const inApplications = () => !isMac || app.isInApplicationsFolder();

/** Start at login, in the background (opt-in): an autostart entry on Linux, a LaunchAgent on macOS
 *  (electron/login-item.cjs), the registry on Windows. */
function applyLoginItem() {
  if (!app.isPackaged) return; // a development run never registers itself
  const on = shellSettings().atLogin;
  try {
    if (process.platform === "linux") {
      const file = path.join(app.getPath("appData"), "autostart", "lifeharness.desktop");
      if (!on) {
        fs.rmSync(file, { force: true });
        return;
      }
      const exe = process.env.APPIMAGE || process.execPath; // an AppImage runs from a temporary mount
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, autostartEntry(exe, [BACKGROUND_ARG, ...(process.env.APPIMAGE ? ["--no-sandbox"] : [])], PRODUCT));
    } else if (isMac) {
      const file = path.join(app.getPath("home"), "Library", "LaunchAgents", `${LOGIN_LABEL}.plist`);
      if (!on || !inApplications()) {
        fs.rmSync(file, { force: true });
        return;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, launchAgentPlist(process.execPath, [BACKGROUND_ARG]));
    } else {
      app.setLoginItemSettings({ openAtLogin: on, args: [BACKGROUND_ARG] });
    }
  } catch (err) {
    log(`login item: ${err.message}`);
  }
}

/** GET from the app's own server, with the per-launch secret (the page gets it from guardRequests). */
function apiGet(p) {
  return new Promise((resolve, reject) => {
    if (!appOrigin) return reject(new Error("the server isn't up"));
    const req = http.get(appOrigin + p, { headers: { [SECRET_HEADER]: apiSecret } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`${p}: HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`${p}: timeout`)));
  });
}

const shownReminders = new Set(); // each reminder id is shown once per run
const liveNotifications = new Set(); // keep references: a garbage-collected notification loses its click handler
let reminderTimers = [];
let reminderLoop = null;

// Whether this computer shows LifeHarness's notifications: "untested" until one is shown or refused.
// macOS refuses them from an app it can't verify (Electron: notifications there need a code-signed app);
// Settings → Reminders then says so, and points to the calendar options.
let notificationState = "untested";

/** A notification, ready to show (handlers attached first: some systems report "show" at once). */
function makeNotification(title, body, page) {
  if (!Notification.isSupported()) return null;
  const n = new Notification({ title, body, icon: path.join(__dirname, "icon.png") });
  liveNotifications.add(n);
  if (liveNotifications.size > 20) liveNotifications.delete(liveNotifications.values().next().value);
  n.on("click", () => showApp(page));
  n.on("close", () => liveNotifications.delete(n));
  n.on("show", () => (notificationState = "shown"));
  n.on("failed", (_e, error) => {
    notificationState = "failed";
    liveNotifications.delete(n);
    log(`notification refused: ${String(error).slice(0, 200)}`); // the system's reason, never the text
  });
  return n;
}

function notify(title, body, page) {
  makeNotification(title, body, page)?.show();
}

/** Fetch what's due in the next hour and set a timer for each (the list covers 36 hours). */
async function refreshReminders() {
  if (!appOrigin || !Notification.isSupported()) return;
  let items;
  try {
    items = (await apiGet("/api/reminders")).items || [];
  } catch (err) {
    log(`reminders: ${err.message}`);
    return;
  }
  for (const t of reminderTimers) clearTimeout(t);
  reminderTimers = [];
  const now = Date.now();
  for (const r of items) {
    const wait = Date.parse(r.at) - now;
    if (shownReminders.has(r.id) || wait > 65 * 60_000) continue; // later ones: a later refresh schedules them
    reminderTimers.push(setTimeout(() => fireReminder(r.id), Math.max(0, wait)));
  }
  log(`reminders: ${items.length} listed, ${reminderTimers.length} within the hour`); // counts only
}

/** Ask again just before showing: the block may have been marked, or the plan changed, meanwhile. */
async function fireReminder(id) {
  if (shownReminders.has(id)) return;
  let r;
  try {
    r = ((await apiGet("/api/reminders")).items || []).find((x) => x.id === id);
  } catch {
    return;
  }
  if (!r || shownReminders.has(id)) return;
  shownReminders.add(id);
  notify(r.title, r.body, r.path);
  log(`reminder shown (${id.split(":")[0]})`); // the kind only: logs stay free of plan details
}

function startReminders() {
  refreshReminders();
  if (reminderLoop) return;
  reminderLoop = setInterval(refreshReminders, 5 * 60_000);
  powerMonitor.on("resume", refreshReminders); // timers stand still while the computer sleeps
  powerMonitor.on("unlock-screen", refreshReminders);
}

/** The shell's own small state (which one-time notices were shown), beside window-state.json. */
const shellStateFile = () => path.join(userData(), "shell-state.json");
function shellState() {
  try {
    return JSON.parse(fs.readFileSync(shellStateFile(), "utf8"));
  } catch {
    return {}; // first time
  }
}
function saveShellState(patch) {
  try {
    fs.writeFileSync(shellStateFile(), JSON.stringify({ ...shellState(), ...patch }));
  } catch {
    /* best effort */
  }
}

/** The first time the window closes to the tray, say so (once). */
function noteStillRunning() {
  if (shellState().backgroundNoticeShown) return;
  saveShellState({ backgroundNoticeShown: true });
  const how = isMac ? "Quit from the menu bar icon or with ⌘Q" : "Quit from the tray icon";
  notify(`${PRODUCT} is still running`, `Reminders keep coming. ${how}, or change this in Settings → Reminders.`, "/settings");
}

/** macOS: run from Downloads or the disk image, the app gets a temporary path and can't start at login.
 *  Offer to move it to Applications ("Don't ask again" is remembered). True when it's moving: macOS then
 *  quits this copy and opens the one in Applications. */
async function offerMoveToApplications() {
  if (!isMac || !app.isPackaged || inApplications() || shellState().moveDeclined) return false;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    message: `Move ${PRODUCT} to your Applications folder?`,
    detail: "It's running from the disk image or Downloads. From Applications it can start when you log in, and it keeps working after the disk image is ejected.",
    checkboxLabel: "Don't ask again",
  });
  if (response !== 0) {
    if (checkboxChecked) saveShellState({ moveDeclined: true });
    return false;
  }
  try {
    return app.moveToApplicationsFolder();
  } catch (err) {
    log(`move to Applications: ${err.message}`);
    return false;
  }
}

/** macOS: menus and dialogs follow the theme's light or dark, not the system's. */
function followTheme(background) {
  if (!isMac || !/^#[0-9a-f]{6}$/i.test(background)) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  nativeTheme.themeSource = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

function buildMenu() {
  if (isMac) {
    app.setAboutPanelOptions({ credits: "Free software under the GNU AGPL v3.0." }); // name, version, copyright: Info.plist
    app.dock?.setMenu(
      Menu.buildFromTemplate([
        { label: "Today", click: () => showApp("/today") },
        { label: "Week", click: () => showApp("/week") },
      ]),
    );
  }
  const appMenu = {
    label: PRODUCT,
    submenu: [
      { role: "about" },
      { type: "separator" },
      // ⌘, itself is the page's shortcut (components/Shell.tsx): shown here, handled there.
      { label: "Settings…", accelerator: "Command+,", registerAccelerator: false, click: () => showApp("/settings") },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
  const template = [
    ...(isMac ? [appMenu] : []),
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

// "Open folder" buttons in Settings: only the app's own folders, never a path from the page.
ipcMain.on("lh:open-folder", (_e, which) => {
  const licenses = app.isPackaged ? path.join(process.resourcesPath, "licenses") : null; // LICENSE + third-party notices
  const dir = { data: dataDir(), config: userData(), logs: logDir(), licenses }[which];
  if (dir) shell.openPath(dir);
});

// The renderer reports theme changes so the native chrome follows.
ipcMain.on("lh:set-chrome", (e, c) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || !c || typeof c.background !== "string") return;
  try {
    w.setBackgroundColor(c.background);
    followTheme(c.background);
    if (!isMac && typeof w.setTitleBarOverlay === "function") w.setTitleBarOverlay({ color: c.background, symbolColor: c.symbol });
  } catch (err) {
    log(`set-chrome failed: ${err}`);
  }
});

app.on("second-instance", () => showApp()); // also brings it back from the tray

// The page asks after saving reminder settings or adopting a plan; and what this shell can do.
ipcMain.on("lh:refresh-shell", () => {
  updateTray();
  applyLoginItem();
  refreshReminders();
});
ipcMain.handle("lh:shell-info", () => ({
  atLoginSupported: app.isPackaged && inApplications(),
  atLoginNote: !app.isPackaged ? "available in the installed app" : inApplications() ? "" : `move ${PRODUCT} to Applications first`,
  notifications: notificationState,
}));

// Settings → Reminders → "Send a test reminder": shown, refused (with the system's reason), or sent with no
// answer within 5 s (not every system reports showing one).
ipcMain.handle(
  "lh:test-reminder",
  () =>
    new Promise((resolve) => {
      const n = makeNotification("Reminders work", `This is how ${PRODUCT} tells you a block is starting.`, "/settings");
      if (!n) return resolve({ result: "unsupported" });
      const done = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => done({ result: "sent" }), 5000);
      n.once("show", () => done({ result: "shown" }));
      n.once("failed", (_e, error) => done({ result: "failed", error: String(error).slice(0, 200) }));
      n.show();
    }),
);

app.whenReady().then(async () => {
  buildMenu();
  // Deny-by-default permissions; only clipboard writes (copy buttons) are allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write"));
  try {
    rotate(path.join(logDir(), "main.log"));
    if (await offerMoveToApplications()) return; // macOS reopens it from Applications
    // Started at login: stay in the tray until needed (only while reminders keep it running).
    const hidden = process.argv.includes(BACKGROUND_ARG) && shellSettings().background;
    if (!hidden) createWindow(); // "Starting…" right away
    const url = DEV_URL || (await startServer());
    if (!DEV_URL) guardRequests(new URL(url).origin);
    openApp(url);
    updateTray();
    applyLoginItem();
    startReminders();
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
  // Reminders keep running in the tray (menu bar); otherwise closing the window quits. On macOS too: there
  // "Run in the background" off means no reminders after the window closes, so nothing is left running.
  if (!quitting && appUrl && shellSettings().background) return noteStillRunning();
  app.quit();
});
app.on("activate", () => {
  if (!win && BrowserWindow.getAllWindows().length === 0 && appUrl) showApp();
});
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
