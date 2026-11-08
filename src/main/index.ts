import { execFile } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import type { Rect } from '../shared/geometry';
import { createIntentHistory, historyContext, parseIntentRanker, readIntentHistory } from '../shared/intent-history';
import { readLargeView } from '../shared/large-view';
import { createPredictor, readWordModel, type BaseWords } from '../shared/predict';
import { createSession, type AgentAction, type Icon, type SessionInput } from '../shared/session';
import { applyDockSize, restoreDock } from './dock-size';
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
// shortcut: polls for icons and windows moving, listen for Accessibility changes if the delay shows up in use.
const ICON_READ_MS = 2000;
// shortcut: opens the Gaze Keyboard until #13 opens it from a text box target.
const DEV_OPEN_KEYBOARD_SHORTCUT = 'CommandOrControl+Shift+K';
// The mouse can't blink, so this stands in for the Select Blink.
const DEV_SELECT_SHORTCUT = 'CommandOrControl+Shift+Space';
// The overlay ignores clicks and has no menu, so this is the only way to quit besides the terminal.
// Not Cmd+Shift+Q, which is macOS's Log Out.
const QUIT_SHORTCUT = 'CommandOrControl+Alt+Q';
// shortcut: runs one agent check on Chrome until the Intent flow exists.
const DEV_AGENT_CHECK_SHORTCUT = 'CommandOrControl+Shift+A';
// shortcut: one display can't put the mouse off screen, so this toggles Look Away for the mouse input.
const DEV_LOOK_AWAY_SHORTCUT = 'CommandOrControl+Shift+L';
// Time for the Centre Box to be drawn before the first screenshot.
const OVERLAY_DRAW_MS = 1000;
// Time for the Dock to come back up after it restarts with a new icon size.
const DOCK_RESTART_MS = 1500;
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
// is, until the Dock loses focus. A Dock that is already up, as on the Desktop, is left alone.
const FOCUS_DOCK = `function run([bottom]) {
  const events = Application('System Events');
  if (events.processes.byName('Dock').lists[0].position()[1] < Number(bottom)) return;
  events.keyCode(99, { using: 'control down' });
  delay(0.7);
}`;

// Escape leaves the Dock, which hides it again. It's sent only while the Dock has the focus, so the app in front
// never gets it. Activating the app in front doesn't reliably take the focus back.
const UNFOCUS_DOCK = `const events = Application('System Events');
if (events.processes.byName('Dock').lists[0].focused()) events.keyCode(53);`;

// Opening an app from the Dock hands it the focus. A failed open, or the app already in front, leaves the Dock with it.
const DOCK_OPEN_SETTLE_MS = 1000;

let focusingDock = false;
let unfocusWhenFocused = false;

function showDock(display: Rect, done: () => void) {
  unfocusWhenFocused = false;
  if (focusingDock) return;
  focusingDock = true;
  execFile('osascript', ['-l', 'JavaScript', '-e', FOCUS_DOCK, String(display.y + display.height)], (error) => {
    focusingDock = false;
    if (error) console.error('Could not show the Dock:', error.message);
    // A release asked for while Ctrl+F3 was still on its way would have found nothing to release.
    if (unfocusWhenFocused) releaseDock();
    else done();
  });
}

function releaseDock() {
  if (focusingDock) {
    unfocusWhenFocused = true;
    return;
  }
  unfocusWhenFocused = false;
  execFile('osascript', ['-l', 'JavaScript', '-e', UNFOCUS_DOCK], (error) => {
    if (error) console.error('Could not give the focus back from the Dock:', error.message);
  });
}

// Menu bar items are found again by their place in the Accessibility tree, [process, menu bar, item], since status
// items have no name. Commands in an open menu add their place in the menu.
// shortcut: reads the app in front and Control Center only, so other apps' status items are left out.
const READ_MENU_BAR = `const events = Application('System Events');
const front = events.processes.whose({ frontmost: true })[0].name();
JSON.stringify([front, 'ControlCenter'].flatMap((process) => {
  // Newer macOS shows no menu bar for Control Center, which failed the whole read, the front app's menus too.
  const bars = events.processes.byName(process).menuBars;
  if (bars.length === 0) return [];
  const items = bars[0].menuBarItems;
  const sizes = items.size();
  const titles = items.name();
  const descriptions = items.description();
  return items.position().map(([x, y], i) => ({ path: [process, 0, i], label: titles[i] || descriptions[i] || 'Menu bar item', x, y, width: sizes[i][0], height: sizes[i][1] }));
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
    names[i] && enabled[i] ? [{ path: [process, bar, item, i], label: names[i], x, y, width: sizes[i][0], height: sizes[i][1] }] : []));
}`;

const PRESS_MENU_COMMAND = `function run([path]) {
  const [process, bar, item, command] = JSON.parse(path);
  Application('System Events').processes.byName(process).menuBars[bar].menuBarItems[item].menus[0].menuItems[command].actions.byName('AXPress').perform();
}`;

const CLOSE_MENU = `function run([path]) {
  const [process, bar, item] = JSON.parse(path);
  Application('System Events').processes.byName(process).menuBars[bar].menuBarItems[item].menus[0].actions.byName('AXCancel').perform();
}`;

type PlacedPath = { path: unknown[]; label: string; x: number; y: number; width: number; height: number };

const toIcons = (placed: PlacedPath[], origin: Rect): Icon[] =>
  placed.map(({ path, label, x, y, width, height }) => ({ name: JSON.stringify(path), label, rect: { x: x - origin.x, y: y - origin.y, width, height } }));

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
      // The three lists are read one after another, so an icon added in between (the app's own, at launch) has no place yet.
      if (!positions[i] || !sizes[i]) return [];
      const [x, y] = positions[i];
      const [width, height] = sizes[i];
      const rect = { x, y, width, height };
      if (name === null || windows.some((window) => overlaps(rect, window))) return [];
      return [{ name, label: name, rect: { ...rect, x: x - origin.x, y: y - origin.y } }];
    });
    done(icons);
  });
}

function openIcon(source: 'dock' | 'desktop', name: string) {
  const { elements, open } = ICONS[source];
  const script = `function run([name]) { Application('System Events').${elements}.byName(name).actions.byName('${open}').perform(); }`;
  execFile('osascript', ['-l', 'JavaScript', '-e', script, name], (error) => {
    if (error) console.error(`Could not open ${name} from the ${source}:`, error.message);
    if (source === 'dock') setTimeout(releaseDock, DOCK_OPEN_SETTLE_MS);
  });
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
    suggestPhrase: (text: string) => (enabled ? predictor.suggestPhrase(text) : undefined),
    learn(text: string) {
      if (!enabled) return;
      predictor.learn(text);
      // Write then rename, so a crash mid-write never leaves a half file that would start the model fresh.
      writeFileSync(`${file}.tmp`, JSON.stringify(predictor.model()));
      renameSync(`${file}.tmp`, file);
    },
  };
}

// What the user ran before, per app. Chosen Intents only, kept on this machine.
function createHistory(ranker: unknown) {
  const file = join(app.getPath('userData'), 'intent-history.json');
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Starting Intent History fresh, ignoring ${file}:`, error);
  }
  const history = createIntentHistory(readIntentHistory(saved), parseIntentRanker(ranker));
  return {
    suggest: history.suggest,
    learn(context: string, intent: string) {
      history.learn(context, intent);
      // Write then rename, so a crash mid-write never leaves a half file that would start the history fresh.
      writeFileSync(`${file}.tmp`, JSON.stringify(history.model()));
      renameSync(`${file}.tmp`, file);
    },
  };
}

// The app in front, and with "per-site" the URL of Chrome's front tab. One osascript, so a browser costs no extra
// launch. An Incognito window gives no URL, so private browsing is never written to the history file.
const READ_FRONT = `function run(argv) {
  const name = Application("System Events").processes.whose({frontmost: true})[0].name();
  let url = "";
  if (argv[0] === "per-site" && name === "Google Chrome") {
    try {
      const front = Application("Google Chrome").windows[0];
      if (front.mode() !== "incognito") url = front.activeTab.url();
    } catch (error) {}
  }
  return name + "\\n" + url;
}`;

// Asks macOS once, at start, to let Oculus read Chrome, so the Automation dialog never shows up in the middle of a run.
// running() doesn't launch Chrome. If Chrome isn't open yet, the dialog comes the first time Oculus reads it.
const ASK_CHROME = 'const chrome = Application("Google Chrome"); chrome.running() ? chrome.windows.length : 0';

// The app in front, plus the site in Chrome when perSite is on. The overlay never takes focus, so this is what the user
// is looking at. shortcut: System Events and Chrome through osascript. Any failure, including a denied Automation
// permission, never reaches the user: a site that can't be read gives the app alone, and an app that can't be read
// gives '', which means no history for this request.
function readContext(perSite: boolean): Promise<string> {
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', READ_FRONT, perSite ? 'per-site' : ''], { timeout: 3000 }, (error, stdout) => {
      const [name = '', url = ''] = error ? [] : stdout.split('\n').map((line) => line.trim());
      resolve(historyContext(name, url));
    });
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

// Whether the box the text just went into is a password field, whose text must never be remembered. Checked on the
// focused element's subrole. If it can't be read, that counts as secure: not learning is the safe mistake.
const FOCUSED_SUBROLE = `const events = Application('System Events');
const focused = events.processes.whose({ frontmost: true })[0].attributes.byName('AXFocusedUIElement').value();
let subrole = '';
try { subrole = focused.attributes.byName('AXSubrole').value() || ''; } catch (error) {}
subrole`;

function isSecureField(done: (secure: boolean) => void) {
  execFile('osascript', ['-l', 'JavaScript', '-e', FOCUSED_SUBROLE], (error, stdout) => {
    if (error) console.warn('Could not tell whether the field is a password field, so not learning:', error.message);
    done(error !== null || stdout.trim() === 'AXSecureTextField');
  });
}

// Runs never overlap: two would fight over the same cursor.
let running = false;
// The Intent run in progress, so the Stop Gesture and quitting can abort it.
let currentRun: { request: number; controller: AbortController } | null = null;
// The Suggested Intents request in flight, aborted once the session stops waiting for it.
let pendingIntents: AbortController | null = null;
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

  const icons = { dock: [] as Icon[], desktop: [] as Icon[], menubar: [] as Icon[] };
  const refreshIcons = () => {
    readIcons('dock', bounds, (read) => (icons.dock = read));
    readIcons('desktop', bounds, (read) => (icons.desktop = read));
    readMenuBar(bounds, (read) => (icons.menubar = read));
  };
  const settings = readTimingsFile();
  const largeView = readLargeView(settings);
  // The renderer has no file access, so it gets the settings once the page has loaded.
  overlay.webContents.once('did-finish-load', () => overlay.webContents.send('large-view', largeView));
  // A bigger Dock moves its icons, so they are read again once it has restarted.
  const dockChanged = applyDockSize(app.getPath('userData'), largeView.enabled, largeView.dockIconSize);
  if (dockChanged) setTimeout(refreshIcons, DOCK_RESTART_MS);
  refreshIcons();
  // On unless config.json says "wordPrediction": false.
  const words = createWordPrediction((settings as { wordPrediction?: unknown } | undefined)?.wordPrediction !== false);
  // Count and recency unless config.json says "intentRanker": "neural".
  const history = createHistory((settings as { intentRanker?: unknown } | undefined)?.intentRanker);
  // Off unless config.json says "historyPerSite": true, since it needs a one-time Automation permission for Chrome.
  const perSite = (settings as { historyPerSite?: unknown } | undefined)?.historyPerSite === true;
  if (perSite) execFile('osascript', ['-l', 'JavaScript', '-e', ASK_CHROME], () => {});
  // The context of each suggest-intents request, read when it starts since the front app can change during a run.
  const contexts = new Map<number, Promise<string>>();
  const perform = (action: AgentAction) => {
    if (action.type === 'type-text') {
      typeText(action.text);
      // Only Done reaches this, so text the user stopped or threw away never teaches the predictor.
      // A failed save must not stop the text being typed, so it only warns.
      isSecureField((secure) => {
        if (secure) return;
        try {
          words.learn(action.text);
        } catch (error) {
          console.warn('Could not save word prediction:', error);
        }
      });
    } else if (action.type === 'suggest-intents') {
      const context = readContext(perSite);
      contexts.set(action.request, context);
      for (const old of contexts.keys()) if (old < action.request - 10) contexts.delete(old);
      // Not after Something else: those are the ones the user just turned down. The answer comes after this session
      // call has returned, because osascript is asynchronous.
      if (action.turnedDown.length === 0)
        void context.then((name) => {
          const past = name === '' ? [] : history.suggest(name);
          if (past.length > 0) advance({ type: 'past-intents', t: Date.now(), request: action.request, intents: past });
        });
      // A folder per request, so overlapping requests never share a screenshot. It's deleted once answered.
      const saveDir = join(app.getPath('userData'), 'intents', String(action.request));
      const capture = createCapture({ overlay, display: screen.getPrimaryDisplay(), saveDir, hideOverlay: true });
      pendingIntents?.abort();
      const controller = (pendingIntents = new AbortController());
      void suggestIntents(action.region, action.turnedDown, readAgentConfig(process.env, 'shortcut')!, capture, console.log, controller.signal)
        .then((intents) => advance({ type: 'intents', t: Date.now(), request: action.request, intents }))
        .finally(() => {
          if (pendingIntents === controller) pendingIntents = null;
          rmSync(saveDir, { recursive: true, force: true });
        });
    } else if (action.type === 'run-intent') {
      const { intent, region, request, sinceWakeMs } = action;
      const finish = (ok: boolean, summary: string) => advance({ type: 'run-finished', t: Date.now(), request, ok, summary });
      // Time to Action: Start Gesture (or last icon opened) to the Select Blink that chose the Intent. Logged before the run
      // starts, so a run that fails at once, or is turned away because another is going, is still counted. Only logged, never shown.
      console.log(`[intent-run] time-to-action=${(sinceWakeMs / 1000).toFixed(1)}s request=${request}`);
      // Deferred: perform runs inside the session call that chose the Intent, which must return before the answer goes in.
      if (running || currentRun) return void setImmediate(() => finish(false, 'Another run is going'));
      const controller = new AbortController();
      running = true;
      currentRun = { request, controller };
      const onActivity = (activity: string) => advance({ type: 'run-progress', t: Date.now(), request, activity });
      void runIntentInElectron(overlay, { intent, region, request }, controller.signal, onActivity).then((outcome) => {
        currentRun = null;
        running = false;
        // The run's request number follows the suggest-intents request it was chosen from.
        if (outcome.ok)
          void contexts.get(request - 1)?.then((name) => {
            try {
              history.learn(name, intent);
            } catch (error) {
              console.warn('Could not save Intent History:', error);
            }
          });
        finish(outcome.ok, outcome.summary);
      });
    } else if (action.type === 'stop-run') {
      if (currentRun?.request !== action.request) return;
      console.log(`[intent-run] stop request=${action.request}`);
      currentRun.controller.abort();
    }
    // The Dock moves when it shows, so it is read again for the scan.
    else if (action.type === 'show-dock') showDock(bounds, refreshIcons);
    else if (action.type === 'release-dock') releaseDock();
    else if (action.type === 'close-menu') {
      if (openMenu !== null) runMenuScript(CLOSE_MENU, openMenu, 'Could not close the menu:');
      openMenu = null;
    } else if (action.source === 'menubar')
      openMenuBarItem(action.name, bounds, (opened) => advance({ type: 'menu-opened', t: Date.now(), icons: opened }));
    else if (action.source === 'menu') {
      openMenu = null;
      runMenuScript(PRESS_MENU_COMMAND, action.name, 'Could not run the menu command:');
    } else openIcon(action.source, action.name);
  };
  const session = createSession({
    screen: bounds,
    timings: settings,
    act: perform,
    suggest: words.suggest,
    suggestPhrase: words.suggestPhrase,
    dock: () => icons.dock,
    desktop: () => icons.desktop,
    menubar: () => icons.menubar,
  });
  const advance = (input: SessionInput) => {
    const state = session(input);
    // The Stop Gesture, the Gaze Keyboard or a run ended the wait, so the answer would be dropped anyway.
    // The picker can be up already, with past Intents, while Claude is still answering.
    if (state.phase !== 'thinking' && state.phase !== 'choosing') pendingIntents?.abort();
    overlay.webContents.send('overlay-state', state);
  };

  let lookingAway = false;
  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS), setInterval(refreshIcons, ICON_READ_MS)];
  if (useMouse) {
    timers.push(
      setInterval(() => {
        const { x, y } = screen.getCursorScreenPoint();
        const region = lookingAway ? null : { x: x - bounds.x, y: y - bounds.y, radius: MOUSE_REGION_RADIUS };
        advance({ type: 'gaze', t: Date.now(), region });
      }, MOUSE_SAMPLE_MS),
    );
  } else {
    // The overlay page only sends gaze and Select Blinks. A model answer must never come from it.
    ipcMain.on('gaze', (_event, input: SessionInput) => {
      if (input?.type === 'gaze' || input?.type === 'select') advance(input);
    });
  }
  if (!globalShortcut.register(QUIT_SHORTCUT, () => app.quit())) console.warn(`${QUIT_SHORTCUT} is taken, so quit from the terminal.`);
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
  restoreDock(app.getPath('userData'));
  currentRun?.controller.abort();
});
