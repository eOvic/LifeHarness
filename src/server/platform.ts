// The OS LifeHarness is RUNNING on.
//
// Never test `process.platform` in a condition in server code. Turbopack evaluates
// `process.platform === "win32"` at BUILD time wherever the result decides a branch, and drops the
// other branch: a build made on Linux then behaves like Linux on Windows (it looked only for `claude`,
// never `claude.exe`). A call into this module can't be evaluated that way, so it's decided at run
// time. LIFEHARNESS_PLATFORM overrides it, so tests can exercise the Windows code on Linux.
// (tests/platform.test.ts fails on any other use of process.platform in bundled code.)
export function platform(): NodeJS.Platform {
  return (process.env.LIFEHARNESS_PLATFORM as NodeJS.Platform | undefined) || process.platform;
}

export const isWindows = (): boolean => platform() === "win32";
export const isMac = (): boolean => platform() === "darwin";
