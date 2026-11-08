import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { Rect } from '../shared/geometry';
import { createSession, type Icon, type SessionInput } from '../shared/session';

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

// Menu bar items are found again by their place in the Accessibility tree, [process, menu bar, item], since status
// items have no name. Commands in an open menu add their place in the menu.
// shortcut: reads the app in front and Control Center only, so other apps' status items are left out.
const READ_MENU_BAR = `const events = Application('System Events');
const front = events.processes.whose({ frontmost: true })[0].name();
JSON.stringify([front, 'ControlCenter'].flatMap((process) => {
  const items = events.processes.byName(process).menuBars[0].menuBarItems;
  const sizes = items.size();
  return items.position().map(([x, y], i) => ({ path: [process, 0, i], x, y, width: sizes[i][0], height: sizes[i][1] }));
}))`;

// Prints the commands of the menu the item opened, leaving out separators and disabled commands. A status item that
// opens a panel instead prints none.
// shortcut: a command with a submenu is pressed like any other, scan submenus too if users need them.
const OPEN_MENU_BAR_ITEM = `function run([path]) {
  const [process, bar, item] = JSON.parse(path);
  const menuBarItem = Application('System Events').processes.byName(process).menuBars[bar].menuBarItems[item];
  menuBarItem.actions.byName('AXPress').perform();
  delay(0.5);
  if (menuBarItem.menus.length === 0) return '[]';
  const commands = menuBarItem.menus[0].menuItems;
  const names = commands.name();
  const enabled = commands.enabled();
  const sizes = commands.size();
  return JSON.stringify(commands.position().flatMap(([x, y], i) =>
    names[i] && enabled[i] ? [{ path: [process, bar, item, i], x, y, width: sizes[i][0], height: sizes[i][1] }] : []));
}`;

const PRESS_MENU_COMMAND = `function run([path]) {
  const [process, bar, item, command] = JSON.parse(path);
  Application('System Events').processes.byName(process).menuBars[bar].menuBarItems[item].menus[0].menuItems[command].actions.byName('AXPress').perform();
}`;

const CLOSE_MENU = `function run([path]) {
  const [process, bar, item] = JSON.parse(path);
  Application('System Events').processes.byName(process).menuBars[bar].menuBarItems[item].menus[0].actions.byName('AXCancel').perform();
}`;

type PlacedPath = { path: unknown[]; x: number; y: number; width: number; height: number };

const toIcons = (placed: PlacedPath[], origin: Rect): Icon[] =>
  placed.map(({ path, x, y, width, height }) => ({ name: JSON.stringify(path), rect: { x: x - origin.x, y: y - origin.y, width, height } }));

function readMenuBar(origin: Rect, done: (icons: Icon[]) => void) {
  execFile('osascript', ['-l', 'JavaScript', '-e', READ_MENU_BAR], (error, stdout) => {
    if (error) return console.error('Could not read the menu bar:', error.message);
    // Hidden status items are parked at the bottom of the screen with no width.
    done(toIcons(JSON.parse(stdout) as PlacedPath[], origin).filter(({ rect }) => rect.width > 0 && rect.y < origin.height / 2));
  });
}

// The menu left open by the last menu bar item, which the Stop Gesture closes.
let openMenu: string | null = null;

function openMenuBarItem(path: string, origin: Rect, opened: (icons: Icon[]) => void) {
  execFile('osascript', ['-l', 'JavaScript', '-e', OPEN_MENU_BAR_ITEM, path], (error, stdout) => {
    if (error) return console.error('Could not open the menu bar item:', error.message);
    const icons = toIcons(JSON.parse(stdout) as PlacedPath[], origin);
    openMenu = icons.length > 0 ? path : null;
    opened(icons);
  });
}

function runMenuScript(script: string, path: string, failure: string) {
  execFile('osascript', ['-l', 'JavaScript', '-e', script, path], (error) => {
    if (error) console.error(failure, error.message);
  });
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function readIcons(source: 'dock' | 'desktop', origin: Rect, done: (icons: Icon[]) => void) {
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

function openIcon(source: 'dock' | 'desktop', name: string) {
  const { elements, open } = ICONS[source];
  const script = `function run([name]) { Application('System Events').${elements}.byName(name).actions.byName('${open}').perform(); }`;
  execFile('osascript', ['-l', 'JavaScript', '-e', script, name], (error) => {
    if (error) console.error(`Could not open ${name} from the ${source}:`, error.message);
  });
}

// The overlay never takes focus, so keystrokes land in the box that has focus in the app beneath.
// shortcut: types through System Events, which needs the Accessibility permission. #6 may replace this.
function typeText(text: string) {
  const script = ['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'];
  execFile('osascript', [...script.flatMap((line) => ['-e', line]), text], (error) => {
    if (!error) return;
    // The keyboard has already closed, so the clipboard is the only copy of the text left.
    clipboard.writeText(text);
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

  const icons = { dock: [] as Icon[], desktop: [] as Icon[], menubar: [] as Icon[] };
  const refreshIcons = () => {
    readIcons('dock', bounds, (read) => (icons.dock = read));
    readIcons('desktop', bounds, (read) => (icons.desktop = read));
    readMenuBar(bounds, (read) => (icons.menubar = read));
  };
  refreshIcons();
  const session = createSession({
    screen: bounds,
    timings: readTimingsFile(),
    // The Dock moves when it shows, so it is read again for the scan.
    act: (action) => {
      if (action.type === 'show-dock') showDock(bounds, refreshIcons);
      else if (action.type === 'release-dock') releaseDock();
      else if (action.type === 'type-text') typeText(action.text);
      else if (action.type === 'close-menu') {
        if (openMenu !== null) runMenuScript(CLOSE_MENU, openMenu, 'Could not close the menu:');
        openMenu = null;
      } else if (action.source === 'menubar')
        openMenuBarItem(action.name, bounds, (opened) => advance({ type: 'menu-opened', t: Date.now(), icons: opened }));
      else if (action.source === 'menu') {
        openMenu = null;
        runMenuScript(PRESS_MENU_COMMAND, action.name, 'Could not run the menu command:');
      } else openIcon(action.source, action.name);
    },
    dock: () => icons.dock,
    desktop: () => icons.desktop,
    menubar: () => icons.menubar,
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
