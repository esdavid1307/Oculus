import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { Rect } from '../shared/geometry';
import { createSession, type AgentAction, type Icon, type IconSource, type SessionInput } from '../shared/session';

const TICK_MS = 100;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
// shortcut: polls for icons and windows moving, listen for Accessibility changes if the delay shows up in use.
const ICON_READ_MS = 2000;
// shortcut: opens the Gaze Keyboard until #13 opens it from a text box target.
const DEV_OPEN_KEYBOARD_SHORTCUT = 'CommandOrControl+Shift+K';
// The mouse can't blink, so this stands in for the Select Blink.
const DEV_SELECT_SHORTCUT = 'CommandOrControl+Shift+Space';
// The overlay ignores clicks and has no menu, so this is the only way to quit besides the terminal.
const QUIT_SHORTCUT = 'CommandOrControl+Shift+Q';
// Both sources can't feed one session: mouse events off the target would keep restarting the hold.
const useMouse = !app.isPackaged && process.env.OCULUS_GAZE !== 'camera';

function readTimingsFile(): unknown {
  const file = join(app.getPath('userData'), 'config.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Ignoring ${file}:`, error);
  }
}

// The icons are read and opened through System Events, which needs the Accessibility permission.
const ICONS = {
  dock: { elements: "processes.byName('Dock').lists[0].uiElements", open: 'AXPress' },
  desktop: { elements: "processes.byName('Finder').scrollAreas[0].groups[0].uiElements", open: 'AXOpen' },
};

// The bounds of the ordinary app windows on screen, which can cover Desktop icons. Reading bounds needs no permission.
const READ_WINDOWS = `ObjC.import('CoreGraphics');
function windows() {
  const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0));
  const bounds = [];
  for (let i = 0; i < list.count; i++) {
    const window = list.objectAtIndex(i);
    if (window.objectForKey('kCGWindowLayer').js !== 0) continue;
    const b = window.objectForKey('kCGWindowBounds');
    bounds.push({ x: b.objectForKey('X').js, y: b.objectForKey('Y').js, width: b.objectForKey('Width').js, height: b.objectForKey('Height').js });
  }
  return bounds;
}`;

// Ctrl+F3 is macOS's "Move focus to the Dock" shortcut. It shows a hidden Dock and keeps it up, wherever the cursor
// is, until the Dock loses focus. Prints the app in front, which gets the focus back if nothing is opened. A Dock that
// is already up, as on the Desktop, is left alone and prints nothing.
const FOCUS_DOCK = `function run([bottom]) {
  const events = Application('System Events');
  if (events.processes.byName('Dock').lists[0].position()[1] < Number(bottom)) return '';
  const front = events.processes.whose({ frontmost: true })[0].bundleIdentifier();
  events.keyCode(99, { using: 'control down' });
  delay(0.7);
  return front;
}`;

let appBeforeDock: string | null = null;

function showDock(display: Rect, done: () => void) {
  execFile('osascript', ['-l', 'JavaScript', '-e', FOCUS_DOCK, String(display.y + display.height)], (error, stdout) => {
    if (error) return console.error('Could not show the Dock:', error.message);
    appBeforeDock = stdout.trim() || null;
    done();
  });
}

function releaseDock() {
  if (appBeforeDock === null) return;
  execFile('osascript', ['-l', 'JavaScript', '-e', 'function run([id]) { Application(id).activate(); }', appBeforeDock], (error) => {
    if (error) console.error('Could not give the focus back from the Dock:', error.message);
  });
  appBeforeDock = null;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function readIcons(source: IconSource, origin: Rect, done: (icons: Icon[]) => void) {
  const script = `${READ_WINDOWS}
const icons = Application('System Events').${ICONS[source].elements};
JSON.stringify({ names: icons.name(), positions: icons.position(), sizes: icons.size(), windows: ${source === 'desktop' ? 'windows()' : '[]'} })`;
  execFile('osascript', ['-l', 'JavaScript', '-e', script], (error, stdout) => {
    if (error) return console.error(`Could not read the ${source} icons:`, error.message);
    const { names, positions, sizes, windows } = JSON.parse(stdout) as {
      names: (string | null)[];
      positions: number[][];
      sizes: number[][];
      windows: Rect[];
    };
    // Dock separators have no name, and a Desktop icon under a window can't be seen.
    const icons = names.flatMap((name, i) => {
      const [x, y] = positions[i];
      const [width, height] = sizes[i];
      const rect = { x, y, width, height };
      if (name === null || windows.some((window) => overlaps(rect, window))) return [];
      return [{ name, rect: { ...rect, x: x - origin.x, y: y - origin.y } }];
    });
    done(icons);
  });
}

// The overlay never takes focus, so keystrokes land in the box that has focus in the app beneath.
// shortcut: types through System Events, which needs the Accessibility permission. #6 may replace this.
function perform(action: Extract<AgentAction, { type: 'open-icon' | 'type-text' }>) {
  if (action.type === 'open-icon') {
    const { elements, open } = ICONS[action.source];
    const script = `function run([name]) { Application('System Events').${elements}.byName(name).actions.byName('${open}').perform(); }`;
    execFile('osascript', ['-l', 'JavaScript', '-e', script, action.name], (error) => {
      if (error) console.error(`Could not open ${action.name} from the ${action.source}:`, error.message);
    });
    return;
  }
  const script = ['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'];
  execFile('osascript', [...script.flatMap((line) => ['-e', line]), action.text], (error) => {
    if (!error) return;
    // The keyboard has already closed, so the clipboard is the only copy of the text left.
    clipboard.writeText(action.text);
    console.error('Could not type the Gaze Keyboard text, so it is on the clipboard:', error.message);
  });
}

function createOverlay() {
  // shortcut: display size is read once at startup, listen to screen events if the demo needs resolution changes.
  const { bounds } = screen.getPrimaryDisplay();
  const overlay = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    enableLargerThanScreen: true,
    // The tracker must keep running while the user is in another app.
    webPreferences: { preload: join(__dirname, '../preload/index.js'), backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The agent's clicks must reach the apps beneath the overlay.
  overlay.setIgnoreMouseEvents(true);

  const search = useMouse ? '' : '?camera';
  if (process.env.ELECTRON_RENDERER_URL) overlay.loadURL(process.env.ELECTRON_RENDERER_URL + search);
  else overlay.loadFile(join(__dirname, '../renderer/index.html'), { search });

  const icons: Record<IconSource, Icon[]> = { dock: [], desktop: [] };
  const refreshIcons = () => {
    readIcons('dock', bounds, (read) => (icons.dock = read));
    readIcons('desktop', bounds, (read) => (icons.desktop = read));
  };
  refreshIcons();
  const session = createSession({
    screen: bounds,
    timings: readTimingsFile(),
    // The Dock moves when it shows, so it is read again for the scan.
    act: (action) => {
      if (action.type === 'show-dock') showDock(bounds, refreshIcons);
      else if (action.type === 'release-dock') releaseDock();
      else perform(action);
    },
    dock: () => icons.dock,
    desktop: () => icons.desktop,
  });
  const advance = (input: SessionInput) => overlay.webContents.send('overlay-state', session(input));

  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS), setInterval(refreshIcons, ICON_READ_MS)];
  if (useMouse) {
    timers.push(
      setInterval(() => {
        const { x, y } = screen.getCursorScreenPoint();
        const region = { x: x - bounds.x, y: y - bounds.y, radius: MOUSE_REGION_RADIUS };
        advance({ type: 'gaze', t: Date.now(), region });
      }, MOUSE_SAMPLE_MS),
    );
  } else {
    ipcMain.on('gaze', (_event, input: SessionInput) => advance(input));
  }
  globalShortcut.register(QUIT_SHORTCUT, () => app.quit());
  if (!app.isPackaged) {
    globalShortcut.register(DEV_OPEN_KEYBOARD_SHORTCUT, () => advance({ type: 'open-keyboard', t: Date.now() }));
    if (useMouse) globalShortcut.register(DEV_SELECT_SHORTCUT, () => advance({ type: 'select', t: Date.now() }));
  }
  overlay.on('closed', () => timers.forEach(clearInterval));
}

app.whenReady().then(async () => {
  // A refusal shows up as a camera error on the overlay.
  if (!useMouse) await systemPreferences.askForMediaAccess('camera');
  createOverlay();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
