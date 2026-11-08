import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import { createPredictor, readWordModel, type BaseWords } from '../shared/predict';
import { createSession, type AgentAction, type SessionInput } from '../shared/session';
import { createCapture } from './agent/capture';
import { runAgentCheckInElectron, runIntentInElectron } from './agent/check';
import { readAgentConfig } from './agent/config';
import { suggestIntents } from './agent/intents';
import spokenEnglish from './words/spoken-english.json';

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
// The mouse can't blink, so this stands in for the Select Blink.
const DEV_SELECT_SHORTCUT = 'CommandOrControl+Shift+Space';
// shortcut: runs one agent check on Chrome until the Intent flow exists.
const DEV_AGENT_CHECK_SHORTCUT = 'CommandOrControl+Shift+A';
// shortcut: one display can't put the mouse off screen, so this toggles Look Away for the mouse input.
const DEV_LOOK_AWAY_SHORTCUT = 'CommandOrControl+Shift+L';
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

// The user's own words and the ranker's weights. Typed words only, kept on this machine.
function createWordPrediction(enabled: boolean) {
  const file = join(app.getPath('userData'), 'word-model.json');
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Starting word prediction fresh, ignoring ${file}:`, error);
  }
  const predictor = createPredictor(spokenEnglish as BaseWords, readWordModel(saved));
  return {
    suggest: (text: string) => (enabled ? predictor.suggest(text) : []),
    learn(text: string) {
      if (!enabled) return;
      predictor.learn(text);
      writeFileSync(file, JSON.stringify(predictor.model()));
    },
  };
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

// Runs never overlap: two would fight over the same cursor.
let running = false;
// The Intent run in progress, so the Stop Gesture and quitting can abort it.
let currentRun: { request: number; controller: AbortController } | null = null;
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

  const settings = readTimingsFile();
  // On unless config.json says "wordPrediction": false.
  const words = createWordPrediction((settings as { wordPrediction?: unknown } | undefined)?.wordPrediction !== false);
  const perform = (action: AgentAction) => {
    if (action.type === 'type-text') {
      // Only Done reaches this, so text the user stopped or threw away never teaches the predictor.
      words.learn(action.text);
      typeText(action.text);
    } else if (action.type === 'suggest-intents') {
      // A fresh capture each time, so the one screenshot on disk is always shot-1.png, overwritten by the next request.
      const capture = createCapture({
        overlay,
        display: screen.getPrimaryDisplay(),
        saveDir: join(app.getPath('userData'), 'intents'),
        hideOverlay: true,
      });
      void suggestIntents(action.region, readAgentConfig(process.env, 'shortcut')!, capture).then((intents) =>
        advance({ type: 'intents', t: Date.now(), request: action.request, intents }),
      );
    } else if (action.type === 'run-intent') {
      const { intent, region, request } = action;
      const finish = (ok: boolean, summary: string) => advance({ type: 'run-finished', t: Date.now(), request, ok, summary });
      // Deferred: perform runs inside the session call that chose the Intent, which must return before the answer goes in.
      if (running || currentRun) return void setImmediate(() => finish(false, 'Another run is going'));
      const controller = new AbortController();
      running = true;
      currentRun = { request, controller };
      void runIntentInElectron(overlay, { intent, region, request }, controller.signal).then((outcome) => {
        currentRun = null;
        running = false;
        finish(outcome.ok, outcome.summary);
      });
    } else if (action.type === 'stop-run' && currentRun?.request === action.request) {
      console.log(`[intent-run] stop request=${action.request}`);
      currentRun.controller.abort();
    }
  };
  const session = createSession({ screen: bounds, timings: settings, act: perform, suggest: words.suggest });
  const advance = (input: SessionInput) => overlay.webContents.send('overlay-state', session(input));

  let lookingAway = false;
  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS)];
  if (useMouse) {
    timers.push(
      setInterval(() => {
        const { x, y } = screen.getCursorScreenPoint();
        const region = lookingAway ? null : { x: x - bounds.x, y: y - bounds.y, radius: MOUSE_REGION_RADIUS };
        advance({ type: 'gaze', t: Date.now(), region });
      }, MOUSE_SAMPLE_MS),
    );
  } else {
    ipcMain.on('gaze', (_event, input: SessionInput) => advance(input));
  }
  if (!app.isPackaged) {
    globalShortcut.register(DEV_OPEN_KEYBOARD_SHORTCUT, () => advance({ type: 'open-keyboard', t: Date.now() }));
    if (useMouse) {
      globalShortcut.register(DEV_SELECT_SHORTCUT, () => advance({ type: 'select', t: Date.now() }));
      globalShortcut.register(DEV_LOOK_AWAY_SHORTCUT, () => {
        lookingAway = !lookingAway;
        console.log(`[dev] look away ${lookingAway ? 'on' : 'off'}`);
      });
    }
  }
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
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  currentRun?.controller.abort();
});
