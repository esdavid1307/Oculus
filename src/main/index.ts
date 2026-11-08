import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { GazeEvent } from '../shared/gaze';
import { createSession, type AgentAction, type SessionInput } from '../shared/session';
import { createGazeCorrection } from './gaze-correction';

const TICK_MS = 100;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
// shortcut: opens the Gaze Keyboard until #13 opens it from a text box target.
const DEV_OPEN_KEYBOARD_SHORTCUT = 'CommandOrControl+Shift+K';
// Both sources can't feed one session: mouse events off the target would keep restarting the hold.
const useMouse = !app.isPackaged && process.env.OCULUS_GAZE !== 'camera';
// shortcut: OCULUS_MOUSE_SHIFT="-120,60" makes the mouse input read off like a badly calibrated webcam, to watch Gaze Correction learn.
const [mouseShiftX = 0, mouseShiftY = 0] = (process.env.OCULUS_MOUSE_SHIFT ?? '').split(',').map(Number).map((n) => (Number.isFinite(n) ? n : 0));

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

  const settings = readTimingsFile();
  // On unless config.json says "gazeCorrection": false.
  const correction = createGazeCorrection({ screen: bounds, enabled: (settings as { gazeCorrection?: unknown } | undefined)?.gazeCorrection !== false });
  const perform = (action: AgentAction) => {
    if (action.type === 'type-text') typeText(action.text);
    else if (action.type === 'reset-gaze-correction') {
      correction.reset();
      console.log('Gaze Correction reset');
    } else {
      void correction.learn(action.examples).then(() => {
        if (!correction.active) return;
        const centre = { x: bounds.width / 2, y: bounds.height / 2, radius: 0 };
        const { x, y } = correction.correct(centre);
        console.log(
          `Gaze Correction trained on ${correction.exampleCount} confirmed selections, ` +
            `shifting the screen centre by ${Math.round(x - centre.x)}, ${Math.round(y - centre.y)} px`,
        );
      });
    }
  };
  const session = createSession({ screen: bounds, timings: settings, act: perform, correct: correction.correct });
  const advance = (input: SessionInput) => overlay.webContents.send('overlay-state', session(input));

  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS)];
  if (useMouse) {
    timers.push(
      setInterval(() => {
        const { x, y } = screen.getCursorScreenPoint();
        const region = { x: x - bounds.x + mouseShiftX, y: y - bounds.y + mouseShiftY, radius: MOUSE_REGION_RADIUS };
        advance({ type: 'gaze', t: Date.now(), region });
      }, MOUSE_SAMPLE_MS),
    );
  } else {
    ipcMain.on('gaze', (_event, gaze: GazeEvent) => {
      // The Gaze Dot shows the corrected gaze, so it sits where selections will land.
      overlay.webContents.send('gaze-dot', gaze.region && correction.correct(gaze.region));
      advance(gaze);
    });
    ipcMain.on('recalibrated', () => advance({ type: 'recalibrated', t: Date.now() }));
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
