import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { GazeEvent } from '../shared/gaze';
import { createSession, type AgentAction, type SessionInput } from '../shared/session';
import { runAgentCheckInElectron } from './agent/check';
import { readAgentConfig } from './agent/config';

// Holds ANTHROPIC_API_KEY and the OCULUS_AGENT_* settings. Loaded before anything reads process.env.
try {
  process.loadEnvFile(join(app.getAppPath(), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Ignoring .env:', error);
}

const TICK_MS = 100;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
// shortcut: opens the Gaze Keyboard until #13 opens it from a text box target.
const DEV_OPEN_KEYBOARD_SHORTCUT = 'CommandOrControl+Shift+K';
// shortcut: runs one agent check on Chrome until the Intent flow exists.
const DEV_AGENT_CHECK_SHORTCUT = 'CommandOrControl+Shift+A';
// Time for the Centre Box to be drawn before the first screenshot.
const OVERLAY_DRAW_MS = 1000;
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
function perform(action: AgentAction) {
  const script = ['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'];
  execFile('osascript', [...script.flatMap((line) => ['-e', line]), action.text], (error) => {
    if (!error) return;
    // The keyboard has already closed, so the clipboard is the only copy of the text left.
    clipboard.writeText(action.text);
    console.error('Could not type the Gaze Keyboard text, so it is on the clipboard:', error.message);
  });
}

// Runs never overlap: two would fight over the same cursor.
let running = false;
async function runAgentCheckOnce(overlay: BrowserWindow, trigger: 'env' | 'shortcut') {
  const config = readAgentConfig(process.env, trigger);
  if (!config || running) return;
  running = true;
  try {
    const result = await runAgentCheckInElectron(overlay, config);
    if (config.quitWhenDone) app.exit(result.ok ? 0 : 1);
  } finally {
    running = false;
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

  const session = createSession({ screen: bounds, timings: readTimingsFile(), act: perform });
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
  return overlay;
}

app.whenReady().then(async () => {
  // A refusal shows up as a camera error on the overlay.
  if (!useMouse) await systemPreferences.askForMediaAccess('camera');
  const overlay = createOverlay();
  if (app.isPackaged) return;
  globalShortcut.register(DEV_AGENT_CHECK_SHORTCUT, () => void runAgentCheckOnce(overlay, 'shortcut'));
  overlay.webContents.once('did-finish-load', () => setTimeout(() => void runAgentCheckOnce(overlay, 'env'), OVERLAY_DRAW_MS));
});
app.on('will-quit', () => globalShortcut.unregisterAll());
