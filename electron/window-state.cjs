// Where the window opens.
//
// Found on a Windows PC: after a monitor was unplugged or the display scaling changed, the saved
// position put the whole window off-screen (Windows and X11 apply saved bounds literally). Keep the
// saved spot while the window still lands on a display (pulled fully inside its work area, and no
// bigger than it); otherwise drop the position, so the OS centers the window on the primary display.
// `screen` is Electron's screen module, passed in so this can be tested without Electron.

/**
 * @param {{x?: number, y?: number, width?: number, height?: number}} state the saved window state
 * @param {{getDisplayMatching: Function, getPrimaryDisplay: Function}} screen
 * @returns {{x?: number, y?: number, width: number, height: number}}
 */
function fitToScreen(state, screen) {
  const width = Number(state.width) || 1440;
  const height = Number(state.height) || 900;
  const fit = (area) => ({ width: Math.min(width, area.width), height: Math.min(height, area.height) });
  try {
    if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
      const area = screen.getDisplayMatching({ x: Math.round(state.x), y: Math.round(state.y), width, height }).workArea;
      const size = fit(area);
      const overlapX = Math.min(state.x + size.width, area.x + area.width) - Math.max(state.x, area.x);
      const overlapY = Math.min(state.y + size.height, area.y + area.height) - Math.max(state.y, area.y);
      if (overlapX >= 120 && overlapY >= 80) {
        return {
          ...size,
          x: Math.round(Math.min(Math.max(state.x, area.x), area.x + area.width - size.width)),
          y: Math.round(Math.min(Math.max(state.y, area.y), area.y + area.height - size.height)),
        };
      }
    }
    return fit(screen.getPrimaryDisplay().workArea); // no usable position: the OS centers the window
  } catch {
    return { width, height };
  }
}

module.exports = { fitToScreen };
