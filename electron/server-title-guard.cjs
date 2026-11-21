"use strict";
/**
 * macOS only: loaded into the desktop app's local server (node --require) before Next starts.
 *
 * Next renames its process ("next-server (v16…)"). In Electron's Node mode on macOS, the native setter
 * checks the process in with Launch Services as the app bundle itself, and a second LifeHarness icon
 * appears in the Dock. The title is kept in JavaScript instead: the native process name stays as it is,
 * and reading process.title still returns what was set.
 *
 * Found and fixed first by LearnHarness; this is adapted from its electron/server-title-guard.cjs
 * (https://github.com/amosblomqvist/learnharness, by Amos Blomqvist, AGPL-3.0-only, the same license
 * as LifeHarness).
 */
if (process.platform === "darwin" && process.env.ELECTRON_RUN_AS_NODE === "1" && process.env.LIFEHARNESS_DESKTOP === "1") {
  let title = process.title;
  Object.defineProperty(process, "title", {
    configurable: true,
    enumerable: true,
    get: () => title,
    set: (value) => {
      title = String(value);
    },
  });
}
