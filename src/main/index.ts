import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { GazeEvent } from '../shared/gaze';
import { createSession, type AgentAction, type SessionInput } from '../shared/session';

const TICK_MS = 100;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
// shortcut: fixed suggestions until the Intent engine calls the model with a screenshot (#6, #10).
const STUB_INTENTS = ['Continue my essay', 'Open a related video', 'Skip the ad'];
const STUB_THINKING_MS = 1500;
// shortcut: opens the Gaze Keyboard until #13 opens it from a text box target.
const DEV_OPEN_KEYBOARD_SHORTCUT = 'CommandOrControl+Shift+K';
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

// The overlay never takes focus, so keystrokes land in the box that has focus in the app beneath.
// shortcut: types through System Events, which needs the Accessibility permission. #6 may replace this.
function typeText(action: { text: string }) {
  const script = ['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'];
  execFile('osascript', [...script.flatMap((line) => ['-e', line]), action.text], (error) => {
    if (!error) return;
    // The keyboard has already closed, so the clipboard is the only copy of the text left.
    clipboard.writeText(action.text);
    console.error('Could not type the Gaze Keyboard text, so it is on the clipboard:', error.message);
  });
}

// The model is only reached from here, after the user has asked, so no screenshot is ever taken before a request.
function perform(action: AgentAction, advance: (input: SessionInput) => void) {
  if (action.type === 'type-text') typeText(action);
  // Later, so the reply doesn't re-enter the session while it is still handling the input that asked.
  else if (action.type === 'suggest-intents')
    setTimeout(() => advance({ type: 'intents', t: Date.now(), intents: STUB_INTENTS }), STUB_THINKING_MS);
  else console.log('Run the Intent, once #10 is built:', action.intent);
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

  const session = createSession({ screen: bounds, timings: readTimingsFile(), act: (action) => perform(action, advance) });
  const advance = (input: SessionInput) => overlay.webContents.send('overlay-state', session(input));

  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS)];
  if (useMouse) {
    timers.push(
      setInterval(() => {
        const { x, y } = screen.getCursorScreenPoint();
        const region = { x: x - bounds.x, y: y - bounds.y, radius: MOUSE_REGION_RADIUS };
        advance({ type: 'gaze', t: Date.now(), region });
      }, MOUSE_SAMPLE_MS),
    );
  } else {
    ipcMain.on('gaze', (_event, gaze: GazeEvent) => advance(gaze));
  }
  if (!app.isPackaged) globalShortcut.register(DEV_OPEN_KEYBOARD_SHORTCUT, () => advance({ type: 'open-keyboard', t: Date.now() }));
  overlay.on('closed', () => timers.forEach(clearInterval));
}

app.whenReady().then(async () => {
  // A refusal shows up as a camera error on the overlay.
  if (!useMouse) await systemPreferences.askForMediaAccess('camera');
  createOverlay();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
