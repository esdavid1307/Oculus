import { execFile } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import { mouseRegion } from '../shared/gaze';
import type { Rect } from '../shared/geometry';
import { createIntentHistory, historyContext, parseIntentRanker, readIntentHistory } from '../shared/intent-history';
import { readLargeView } from '../shared/large-view';
import { createPredictor, readWordModel, type BaseWords } from '../shared/predict';
import { createSession, type AgentAction, type Icon, type SessionInput, type TextBox } from '../shared/session';
import { execute } from './agent/executor';
import { applyDockSize, restoreDock } from './dock-size';
import { createCapture } from './agent/capture';
import { runAgentCheckInElectron, runIntentInElectron } from './agent/check';
import { createMainNeuralLayer } from './neural';
import { createChromeScan } from './chrome-scan';
import { isSecure, parseFocusedField, pressesReturn, READ_FOCUSED_FIELD, type FocusedField } from './focused-field';
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
// Same default as the session timings, used when config.json leaves the scan step unset.
const DEFAULT_SCAN_STEP_MS = 2000;
const MOUSE_SAMPLE_MS = 33;
const MOUSE_REGION_RADIUS = 60;
// shortcut: polls for icons and windows moving, listen for Accessibility changes if the delay shows up in use.
const ICON_READ_MS = 2000;
// Dev fallback for opening the Gaze Keyboard when no text box is read, for example before Chrome enables its a11y tree.
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
// Time for the Dock to finish resizing to a new icon size.
const DOCK_RESTART_MS = 1500;
// Both sources can't feed one session: mouse events off the target would keep restarting the hold.
const useMouse = !app.isPackaged && process.env.OCULUS_GAZE !== 'camera';
// shortcut: OCULUS_MOUSE_SHIFT="-100,60" makes the mouse input read off like a badly calibrated webcam, to watch Gaze
// Correction learn it. A malformed value (typo, non-finite) warns and falls back to 0, so it never silently distorts the
// gaze or sends every region off-screen through Infinity.
function parseMouseShift(raw: string | undefined): [number, number] {
  if (!raw) return [0, 0];
  const parts = raw.split(',');
  const parsed = parts.map((n) => Number(n.trim()));
  if (parsed.some((n) => !Number.isFinite(n))) {
    console.warn(`Ignoring OCULUS_MOUSE_SHIFT=${JSON.stringify(raw)}: expected two finite numbers like "-100,60"`);
    return [0, 0];
  }
  return [parsed[0] ?? 0, parsed[1] ?? 0];
}
const [mouseShiftX, mouseShiftY] = parseMouseShift(process.env.OCULUS_MOUSE_SHIFT);

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

// The app in front is reached by its pid: with a second "Google Chrome" (another profile), a lookup by name reaches
// whichever launched first. Paths keep the name, so Icon Order still knows the item next launch.
const PROCESS_OF = `const processOf = (name) => {
  const events = Application('System Events');
  const front = events.processes.whose({ frontmost: true })[0];
  return front.name() === name ? events.processes.whose({ unixId: front.unixId() })[0] : events.processes.byName(name);
};`;

// Menu bar items are found again by their place in the Accessibility tree, [process, menu bar, item], since status
// items have no name. Commands in an open menu add their place in the menu.
// shortcut: reads the app in front and Control Center only, so other apps' status items are left out.
const READ_MENU_BAR = `${PROCESS_OF}
const events = Application('System Events');
const front = events.processes.whose({ frontmost: true })[0].name();
JSON.stringify([front, 'ControlCenter'].flatMap((process) => {
  // Newer macOS shows no menu bar for Control Center, which failed the whole read, the front app's menus too.
  const bars = processOf(process).menuBars;
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
const OPEN_MENU_BAR_ITEM = `${PROCESS_OF}
function run([path]) {
  const [process, bar, item] = JSON.parse(path);
  const menuBarItem = processOf(process).menuBars[bar].menuBarItems[item];
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

const PRESS_MENU_COMMAND = `${PROCESS_OF}
function run([path]) {
  const [process, bar, item, command] = JSON.parse(path);
  processOf(process).menuBars[bar].menuBarItems[item].menus[0].menuItems[command].actions.byName('AXPress').perform();
}`;

const CLOSE_MENU = `${PROCESS_OF}
function run([path]) {
  const [process, bar, item] = JSON.parse(path);
  processOf(process).menuBars[bar].menuBarItems[item].menus[0].actions.byName('AXCancel').perform();
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

// Chrome exposes web content through AX only once its accessibility tree is on, so a YouTube search box stays hidden
// until a VoiceOver-like reader has asked. The size floor drops hidden or tiny controls the user couldn't look at.
const READ_TEXT_BOXES = `function run() {
  try {
    const events = Application('System Events');
    const procs = events.processes.whose({ frontmost: true });
    if (procs.length === 0) return '[]';
    // By pid, not name, so a second Chrome can't stand in for the one in front.
    const windows = events.processes.whose({ unixId: procs[0].unixId() })[0].windows;
    if (windows.length === 0) return '[]';
    const roles = { AXTextField: 1, AXTextArea: 1, AXSearchField: 1, AXComboBox: 1 };
    const results = [];
    function walk(el, depth) {
      if (depth > 25) return;
      var role;
      try { role = el.role(); } catch (e) { return; }
      if (roles[role]) {
        try {
          var pos = el.position();
          var size = el.size();
          if (pos && size && size[0] >= 40 && size[1] >= 15) {
            var name = '';
            try { name = el.description() || ''; } catch (e) {}
            if (!name) try { name = el.title() || ''; } catch (e) {}
            if (!name) try { name = el.help() || ''; } catch (e) {}
            results.push({ name: name || role, role: role, x: pos[0], y: pos[1], width: size[0], height: size[1] });
          }
        } catch (e) {}
      }
      var kids;
      try { kids = el.uiElements(); } catch (e) { return; }
      for (var i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
    }
    walk(windows[0], 0);
    return JSON.stringify(results);
  } catch (e) { return '[]'; }
}`;

type RawTextBox = { name: string; role: string; x: number; y: number; width: number; height: number };

// Read can be slow on big web pages, so it gets more time than the icon read.
const READ_TEXT_BOXES_TIMEOUT_MS = 4000;

// Walking a big web page can take longer than the icon refresh, so skip the next read while one is still in flight.
let readingTextBoxes = false;
function readTextBoxes(origin: Rect, done: (boxes: TextBox[]) => void) {
  if (readingTextBoxes) return;
  readingTextBoxes = true;
  execFile('osascript', ['-l', 'JavaScript', '-e', READ_TEXT_BOXES], { timeout: READ_TEXT_BOXES_TIMEOUT_MS }, (error, stdout) => {
    readingTextBoxes = false;
    if (error) return done([]);
    let raw: RawTextBox[];
    try {
      raw = JSON.parse(stdout);
    } catch {
      return done([]);
    }
    // The index keeps the name unique when a page has several boxes of the same role or description.
    done(raw.map((box, i) => ({ name: `${box.role}#${i}:${box.name}`, rect: { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height } })));
  });
}

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
    enabled,
    suggest: (text: string) => (enabled ? predictor.suggest(text) : []),
    suggestPhrases: (text: string) => (enabled ? predictor.suggestPhrases(text) : []),
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

// Presses the key combos for the Chrome Commands Fixed Intents: search is ⌘L (keyCode 37), next-tab is ^Tab (keyCode 48
// with control down), new-tab is ⌘T (keyCode 17) and close-tab is ⌘W (keyCode 13). Search and New Tab leave the focus in
// the address bar for the Gaze Keyboard the session opens. Sent through System Events like the Gaze Keyboard typing, so
// it needs Accessibility; a denied permission surfaces as an error in the log, not an overlay message.
const CHROME_COMMAND_SCRIPTS: Record<'search' | 'next-tab' | 'new-tab' | 'close-tab', string> = {
  search: `Application('System Events').keyCode(37, { using: 'command down' })`,
  'next-tab': `Application('System Events').keyCode(48, { using: 'control down' })`,
  'new-tab': `Application('System Events').keyCode(17, { using: 'command down' })`,
  'close-tab': `Application('System Events').keyCode(13, { using: 'command down' })`,
};

// The app in front, and with "per-site" the URL of Chrome's front tab. One osascript, so a browser costs no extra
// launch. An Incognito window gives no URL, so private browsing is never written to the history file.
const READ_FRONT = `function run(argv) {
  const name = Application("System Events").processes.whose({frontmost: true})[0].name();
  let url = "";
  // Chrome's scripting can't pick between two Chrome processes, so with two the site (and the Incognito check) could
  // come from the wrong one, and the app alone is used.
  const chromes = Application("System Events").processes.whose({name: "Google Chrome"}).length;
  if (argv[0] === "per-site" && name === "Google Chrome" && chromes === 1) {
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
// submit presses Return after the text, in the same script so it can't land before the last keystroke.
function typeText(text: string, submit = false) {
  const script = [
    'on run argv',
    'tell application "System Events" to keystroke (item 1 of argv)',
    ...(submit ? ['tell application "System Events" to key code 36'] : []),
    'end run',
  ];
  execFile('osascript', [...script.flatMap((line) => ['-e', line]), text], (error) => {
    if (!error) return;
    // The keyboard has already closed, so the clipboard is the only copy of the text left.
    clipboard.writeText(text);
    console.error('Could not type the Gaze Keyboard text, so it is on the clipboard:', error.message);
  });
}

// The box the text is about to go into, which decides whether it is learned and whether Done submits it.
// Typing waits on this, so a hung osascript is cut off and, like any other failure, reads as no field: the text is
// still typed, only not learned or submitted.
function readFocusedField(done: (field: FocusedField) => void) {
  execFile('osascript', ['-l', 'JavaScript', '-e', READ_FOCUSED_FIELD], { timeout: 2000 }, (error, stdout) => {
    if (error) console.warn('Could not read the focused field, so not learning or submitting:', error.message);
    done(error ? null : parseFocusedField(stdout));
  });
}

// Home is macOS's Show Desktop: Cmd and the Mission Control key, which is F3 on Apple keyboards. The F3 keycode itself
// doesn't do it, and F11, the Keyboard Shortcuts setting, can be turned off. Cmd+M with no window does nothing.
const FIXED_INTENT_KEYS: Record<'home' | 'minimize', string> = { home: 'cmd+mission_control', minimize: 'cmd+m' };

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
  let textBoxes: TextBox[] = [];
  // Walking the front window's AX tree is costly, so text boxes are only read from the Start Gesture until the session
  // goes back to idle, not all the time. The 3 s Start Gesture gives the first read time to land before a target hold.
  let wantTextBoxes = false;
  // Whether Google Chrome is in front, from the menu bar read every ICON_READ_MS: its first item is the front app's
  // menu. Used for the Chrome menu bar rule and for the Chrome Commands Fixed Intent (Cmd), with no extra osascript.
  const chromeFront = () => icons.menubar[0]?.name.startsWith('["Google Chrome",') === true;
  const refreshTextBoxes = () => readTextBoxes(bounds, (read) => (textBoxes = wantTextBoxes ? read : []));
  const refreshIcons = () => {
    readIcons('dock', bounds, (read) => (icons.dock = read));
    readIcons('desktop', bounds, (read) => (icons.desktop = read));
    readMenuBar(bounds, (read) => (icons.menubar = read));
    if (wantTextBoxes) refreshTextBoxes();
  };
  // Fires a Chrome Commands key combo through System Events. Logs a failure but never surfaces it to the overlay.
  const runFixedIntent = (name: keyof typeof CHROME_COMMAND_SCRIPTS) => {
    const script = CHROME_COMMAND_SCRIPTS[name];
    // The keys go to whatever app is in front. The user may have spent several scan steps in the Chrome Commands, and
    // Chrome may have lost the front (its last tab closed, a notification clicked), so ⌘W must not close another app.
    if (!chromeFront()) return console.warn(`[fixed-intent] ${name} skipped: Google Chrome is no longer in front`);
    execFile('osascript', ['-l', 'JavaScript', '-e', script], (error) => {
      if (error) console.error(`Could not run the ${name} Fixed Intent:`, error.message);
    });
  };
  const settings = readTimingsFile();
  const largeView = readLargeView(settings);
  // The renderer has no file access, so it gets the settings once the page has loaded.
  overlay.webContents.once('did-finish-load', () => overlay.webContents.send('large-view', largeView));
  // A bigger Dock moves its icons, so they are read again once it has resized.
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
  // The context of the latest suggest-intents request, read when it starts since the front app can change during a run.
  // A run is always chosen from the latest picker, so it learns into this context.
  let askedContext: Promise<string> = Promise.resolve('');
  const step = (settings as { scanStepMs?: unknown } | undefined)?.scanStepMs;
  const scanStepSet = typeof step === 'number' && step > 0;
  // On unless config.json says "neuralLayer": false. See docs/neural-layer.md.
  const neural = createMainNeuralLayer({
    file: join(app.getPath('userData'), 'neural-layer.json'),
    screen: bounds,
    scanStepMs: scanStepSet ? step : DEFAULT_SCAN_STEP_MS,
    enabled: (settings as { neuralLayer?: unknown } | undefined)?.neuralLayer !== false,
    scanStepSet,
  });
  // Gaze Scan in Chrome (#22). Off unless config.json says "chromeScan": true, since it needs the Swift helper built and
  // makes Chrome build its Accessibility tree. See docs/chrome-scan.md.
  const chromeScan =
    (settings as { chromeScan?: unknown } | undefined)?.chromeScan === true
      ? createChromeScan({ source: join(app.getAppPath(), 'scripts', 'oculus-ax.swift'), binary: join(app.getPath('userData'), 'oculus-ax'), display: bounds })
      : null;
  const perform = (action: AgentAction) => {
    if (action.type === 'type-text') {
      // Only Done reaches this, so text the user stopped or threw away never teaches the predictor.
      // The field is checked before typing, so typing that moves focus (auto-advancing code boxes) can't fool it.
      readFocusedField((field) => {
        const submit = pressesReturn(field, action.submit);
        console.log(`[type-text] field=${field ? `${field.role}/${field.subrole}` : 'unknown'} submit=${submit}`);
        typeText(action.text, submit);
        if (!words.enabled || isSecure(field)) return;
        // A failed save must not stop the text being typed, so it only warns.
        try {
          words.learn(action.text);
        } catch (error) {
          console.warn('Could not save word prediction:', error);
        }
      });
    } else if (action.type === 'suggest-intents') {
      const context = (askedContext = readContext(perSite));
      // Not after Something else: those are the ones the user just turned down. The answer comes after this session
      // call has returned, because osascript is asynchronous. It goes in even when empty, since it opens the picker.
      if (action.turnedDown.length === 0)
        void context.then((name) => {
          const past = name === '' ? [] : history.suggest(name);
          advance({ type: 'past-intents', t: Date.now(), request: action.request, intents: past });
        });
      // A folder per request, so overlapping requests never share a screenshot. It's deleted once answered.
      const saveDir = join(app.getPath('userData'), 'intents', String(action.request));
      const capture = createCapture({ overlay, display: screen.getPrimaryDisplay(), saveDir, hideOverlay: true });
      pendingIntents?.abort();
      const controller = (pendingIntents = new AbortController());
      void suggestIntents(action.region, action.turnedDown, readAgentConfig(process.env, 'shortcut')!, capture, console.log, controller.signal, action.element)
        .then((intents) => {
          // Looks first, so the tiles have their label and icon the moment the session adds them.
          overlay.webContents.send('intent-looks', Object.fromEntries(intents.map(({ text, look }) => [text, look])));
          advance({ type: 'intents', t: Date.now(), request: action.request, intents: intents.map(({ text }) => text) });
        })
        .finally(() => {
          if (pendingIntents === controller) pendingIntents = null;
          rmSync(saveDir, { recursive: true, force: true });
        });
    } else if (action.type === 'run-intent') {
      const { intent, region, request, sinceWakeMs, held, element } = action;
      // Snapshotted right now, while the hold's gaze samples are still in the raw buffer. A run that takes longer
      // than RAW_GAZE_MS would otherwise lose the samples before runSucceeded tries to look them up.
      neural.snapshotHold(held.from, held.to);
      // Taken now: by the time the run ends, Something else could have asked about a new target.
      const context = askedContext;
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
      void runIntentInElectron(overlay, { intent, region, request, element }, controller.signal, onActivity).then((outcome) => {
        currentRun = null;
        running = false;
        if (outcome.ok) neural.runSucceeded(intent, region, held, outcome.firstClick, bounds);
        if (outcome.ok)
          void context.then((name) => {
            try {
              history.learn(name, intent);
            } catch (error) {
              console.warn('Could not save Intent History:', error);
            }
          });
        finish(outcome.ok, outcome.summary);
      });
    } else if (action.type === 'fixed-intent') {
      // Key presses only, so the overlay, which never takes focus, leaves them to the app in front.
      console.log(`[fixed-intent] ${action.name}`);
      // Type needs nothing from here: the session opens the Gaze Keyboard, and the text goes to whatever has focus.
      if (action.name === 'type') return;
      if (action.name !== 'home' && action.name !== 'minimize') return runFixedIntent(action.name);
      void execute({ type: 'key', keys: FIXED_INTENT_KEYS[action.name], repeat: 1 }).catch((error: Error) =>
        console.error(`Could not run the Fixed Intent ${action.name}:`, error.message),
      );
    } else if (action.type === 'stop-run') {
      if (currentRun?.request !== action.request) return;
      console.log(`[intent-run] stop request=${action.request}`);
      currentRun.controller.abort();
    } else if (action.type === 'focus-text-box') {
      // Clicks the centre of the box the user looked at, at the HID tap, so the focus lands beneath the click-through
      // overlay before typing. The session sends the rect it matched, so a later read can't swap the box.
      const { rect, held } = action;
      // Snapshotted right now, while the hold samples are still in the raw buffer. A slow typist pressing Done 45 s
      // later would otherwise find the samples evicted and the Gaze Correction label dropped.
      neural.snapshotHold(held.from, held.to);
      const at = { x: bounds.x + rect.x + rect.width / 2, y: bounds.y + rect.y + rect.height / 2 };
      void execute({ type: 'click', at, button: 'left', count: 1, modifiers: [] }).catch((error: Error) =>
        console.error('Could not focus the text box:', error.message),
      );
    }
    // The Dock moves when it shows, so it is read again for the scan.
    else if (action.type === 'snapshot-gaze') neural.snapshotHold(action.held.from, action.held.to);
    else if (action.type === 'show-dock') showDock(bounds, refreshIcons);
    else if (action.type === 'release-dock') releaseDock();
    else if (action.type === 'learn') neural.learn(action.signal);
    else if (action.type === 'close-menu') {
      if (openMenu !== null) runMenuScript(CLOSE_MENU, openMenu, 'Could not close the menu:');
      openMenu = null;
    } else if (action.source === 'menubar')
      openMenuBarItem(action.name, bounds, (opened) => advance({ type: 'menu-opened', t: Date.now(), icons: opened }));
    else if (action.source === 'menu') {
      openMenu = null;
      runMenuScript(PRESS_MENU_COMMAND, action.name, 'Could not run the menu command:');
    } else if (action.source === 'dock' || action.source === 'desktop') openIcon(action.source, action.name);
    // A Chrome element is never opened: the session asks for Suggested Intents about it instead.
  };
  const session = createSession({
    screen: bounds,
    timings: settings,
    act: perform,
    suggest: words.suggest,
    suggestPhrases: words.suggestPhrases,
    dock: () => icons.dock,
    desktop: () => icons.desktop,
    menubar: () => icons.menubar,
    // In Chrome the helper sees the web text boxes the System Events read can't (#13).
    textBoxes: () => [...textBoxes, ...(chromeScan?.textBoxes() ?? [])],
    chrome: () => chromeScan?.elements() ?? [],
    // The front app's menus come first in the menu bar read, named by their path [process, bar, item].
    chromeInFront: chromeFront,
    orderIcons: neural.orderIcons,
    scanPace: neural.scanPace,
    inChrome: chromeFront,
  });
  const advance = (input: SessionInput) => {
    const state = session(input);
    const want = state.phase === 'waiting-for-target' || (state.phase === 'idle' && state.wakeProgress > 0);
    if (want !== wantTextBoxes) {
      wantTextBoxes = want;
      // Read at once on the Start Gesture rather than at the next refresh, and drop the old boxes once idle.
      if (want) refreshTextBoxes();
      else textBoxes = [];
    }
    // The Stop Gesture, the Gaze Keyboard or a run ended the wait, so the answer would be dropped anyway.
    // The picker can be up already, with past Intents, while Claude is still answering.
    if (state.phase !== 'thinking' && state.phase !== 'choosing') pendingIntents?.abort();
    // Chrome elements are looked up only while a target can be picked, around the gaze the session just saw.
    if (state.phase === 'waiting-for-target') {
      if (input.type === 'gaze') chromeScan?.look(input.region);
    } else chromeScan?.clear();
    overlay.webContents.send('overlay-state', state);
  };

  let lookingAway = false;
  const timers = [setInterval(() => advance({ type: 'tick', t: Date.now() }), TICK_MS), setInterval(refreshIcons, ICON_READ_MS)];
  if (useMouse) {
    timers.push(
      setInterval(() => {
        const cursor = screen.getCursorScreenPoint();
        const region = mouseRegion({ x: cursor.x + mouseShiftX, y: cursor.y + mouseShiftY }, bounds, MOUSE_REGION_RADIUS, lookingAway);
        const t = Date.now();
        neural.seen(t, region);
        advance({ type: 'gaze', t, region: neural.correct(region) });
      }, MOUSE_SAMPLE_MS),
    );
  } else {
    // The overlay page only sends gaze, Select Blinks and recalibrating. A model answer must never come from it.
    ipcMain.on('gaze', (_event, input: SessionInput) => {
      if (input?.type === 'gaze') {
        neural.seen(input.t, input.region);
        const region = neural.correct(input.region);
        advance({ ...input, region });
      } else if (input?.type === 'select') advance(input);
      else if (input?.type === 'recalibrate') {
        neural.recalibrated();
        advance(input);
      }
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
  overlay.on('closed', () => {
    timers.forEach(clearInterval);
    chromeScan?.stop();
  });
  // Pending debounced saves must reach disk before the process ends, or the tail of a typing burst or an icon scan
  // is lost.
  app.on('will-quit', () => neural.flush());
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
