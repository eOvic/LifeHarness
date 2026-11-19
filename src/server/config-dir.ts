// Where LifeHarness keeps its own configuration (sign-ins, keys, model catalog cache, helper files).
//   <config> = $LIFEHARNESS_CONFIG_DIR, else ~/.config/LifeHarness (the desktop app's userData).
//   LIFEHARNESS_AUTH_FILE overrides the credentials file (tests, other users); helper files follow it.
import os from "node:os";
import path from "node:path";
import { isMac, isWindows } from "./platform";

export function configDir(): string {
  if (process.env.LIFEHARNESS_CONFIG_DIR) return process.env.LIFEHARNESS_CONFIG_DIR;
  const home = os.homedir();
  if (isMac()) return path.join(/*turbopackIgnore: true*/ home, "Library", "Application Support", "LifeHarness");
  if (isWindows()) return path.join(/*turbopackIgnore: true*/ process.env.APPDATA || path.join(home, "AppData", "Roaming"), "LifeHarness");
  return path.join(/*turbopackIgnore: true*/ process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "LifeHarness");
}

export function authFile(): string {
  return process.env.LIFEHARNESS_AUTH_FILE || path.join(/*turbopackIgnore: true*/ configDir(), "auth.json");
}

/** The folder holding auth.json: other private helper files live beside it. */
export const privateDir = () => path.dirname(/*turbopackIgnore: true*/ authFile());
