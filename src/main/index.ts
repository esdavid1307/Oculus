import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, screen, systemPreferences } from 'electron';
import type { GazeEvent } from '../shared/gaze';
import { createSession, type SessionInput } from '../shared/session';

const TICK_MS = 100;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
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

  const session = createSession({ screen: bounds, timings: readTimingsFile() });
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
  overlay.on('closed', () => timers.forEach(clearInterval));
}

app.whenReady().then(async () => {
  // A refusal shows up as a camera error on the overlay.
  if (!useMouse) await systemPreferences.askForMediaAccess('camera');
  createOverlay();
});
