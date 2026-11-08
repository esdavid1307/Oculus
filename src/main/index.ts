import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { Rect } from '../shared/geometry';
import { createSession, type AgentAction, type DockItem, type SessionInput } from '../shared/session';

const TICK_MS = 100;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
// shortcut: polls for apps opening and closing, listen to Dock changes if the delay shows up in use.
const DOCK_READ_MS = 5000;
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

// Reads the Dock icons through System Events, which needs the Accessibility permission. Separators have no name.
const READ_DOCK = `const icons = Application('System Events').processes.byName('Dock').lists[0].uiElements;
JSON.stringify({ names: icons.name(), positions: icons.position(), sizes: icons.size() })`;
const PRESS_DOCK_ITEM = `function run([name]) {
  Application('System Events').processes.byName('Dock').lists[0].uiElements.byName(name).actions.byName('AXPress').perform();
}`;

function readDock(origin: Rect, done: (items: DockItem[]) => void) {
  execFile('osascript', ['-l', 'JavaScript', '-e', READ_DOCK], (error, stdout) => {
    if (error) return console.error('Could not read the Dock:', error.message);
    const { names, positions, sizes } = JSON.parse(stdout) as { names: (string | null)[]; positions: number[][]; sizes: number[][] };
    const items = names.flatMap((name, i) => {
      const [x, y] = positions[i];
      const [width, height] = sizes[i];
      return name === null ? [] : [{ name, rect: { x: x - origin.x, y: y - origin.y, width, height } }];
    });
    done(items);
  });
}

// The overlay never takes focus, so keystrokes land in the box that has focus in the app beneath.
// shortcut: types through System Events, which needs the Accessibility permission. #6 may replace this.
function perform(action: AgentAction) {
  if (action.type === 'open-dock-item') {
    execFile('osascript', ['-l', 'JavaScript', '-e', PRESS_DOCK_ITEM, action.name], (error) => {
      if (error) console.error(`Could not open ${action.name} from the Dock:`, error.message);
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

  let dock: DockItem[] = [];
  const refreshDock = () => readDock(bounds, (items) => (dock = items));
  refreshDock();
  const session = createSession({ screen: bounds, timings: readTimingsFile(), act: perform, dock: () => dock });
  const advance = (input: SessionInput) => overlay.webContents.send('overlay-state', session(input));

  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS), setInterval(refreshDock, DOCK_READ_MS)];
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
