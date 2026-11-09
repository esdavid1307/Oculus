import { offScreen, type GazeEvent, type GazeRegion } from './gaze';
import type { LearningSignal } from './neural/layer';
import type { Rect, Screen } from './geometry';
import {
  CLOSE_KEY,
  GROUPS,
  layoutIntents,
  layoutKeyboard,
  MAX_SHOWN_PHRASES,
  MAX_SUGGESTIONS,
  PHRASE_KEY,
  SUGGESTION_KEY,
  type FixedIntent,
  type IntentsSide,
  type KeyId,
} from './keyboard';

export type OverlayState = (
  | { phase: 'idle' | 'waiting-for-target' | 'thinking'; wakeProgress: number }
  // stepMs is how long the highlight stays on one key or icon, for the bar drawn under it. Display only.
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; highlight: KeyId; suggestions: string[]; phrases: string[]; stepMs: number }
  // cells is how many slots layoutIntents draws before Close, with room kept for the Intents still to come.
  // recent is how many of the intents, from the first, are past Intents. fixed are the Fixed Intents shown after them.
  // side is where the column goes, away from the target.
  // stepProgress runs from 0 to 1 while the highlight stays on one choice, for the ring drawn around it. Display only.
  | {
      phase: 'choosing';
      wakeProgress: number;
      intents: string[];
      highlight: KeyId;
      cells: number;
      recent: number;
      fixed: FixedIntent[];
      side: IntentsSide;
      stepProgress: number;
    }
  // activity is what the agent is doing right now, such as "Typing", or '' before its first step.
  | { phase: 'running'; wakeProgress: number; intent: string; activity: string }
  | { phase: 'icons'; wakeProgress: number; source: IconSource; highlight: Icon; stepMs: number }
  // Shown for finishedMs after a run ends on its own, then idle. A stopped run goes straight to idle.
  | { phase: 'finished'; wakeProgress: number; intent: string; ok: boolean; summary: string }
) & {
  // The milliseconds left before the Stop Gesture stops the agent. Only there while the gaze is off the screen.
  stopInMs?: number;
};

// Something on screen a scan steps through: a Dock or Desktop icon, a menu bar item or a command in an open menu, which
// a Select Blink opens, or a Chrome element near the gaze, which a Select Blink makes the target of Suggested Intents.
// The name is what the outside world needs to find it again, in overlay coordinates. The label is what a person reads:
// the name itself can be a lookup key, as for menu bar items.
export type Icon = { name: string; rect: Rect; label?: string };

// A text field or search box on screen the Gaze Keyboard can type into. The name is the outside world's handle for it,
// used to focus the box again before typing lands.
export type TextBox = { name: string; rect: Rect };

// 'menu' is the menu a menu bar item just opened. 'chrome' is the Chrome elements near the gaze (Gaze Scan in Chrome).
export type IconSource = 'dock' | 'desktop' | 'menubar' | 'menu' | 'chrome';

// The Chrome element a Gaze Scan chose, which goes to the model next to the Gaze Region. rect is in overlay coordinates.
export type ElementHint = { name: string; rect: Rect };

// A select comes from a Select Blink, which real tracking detects outside the GazeEvent format.
// menu-opened reports the commands of the menu a menu bar item opened.
export type SessionInput =
  | GazeEvent
  | { type: 'tick' | 'open-keyboard' | 'select'; t: number }
  // Recalibrating counts as a Stop at once: the old calibration no longer says where the user is looking.
  | { type: 'recalibrate'; t: number }
  // The model's answer to the suggest-intents request with the same number.
  | { type: 'intents'; t: number; request: number; intents: string[] }
  // The user's own past Intents for the target of the suggest-intents request with the same number, best first.
  | { type: 'past-intents'; t: number; request: number; intents: string[] }
  | { type: 'menu-opened'; t: number; icons: Icon[] }
  // The end of the run-intent request with the same number. summary is one short sentence for the overlay.
  | { type: 'run-finished'; t: number; request: number; ok: boolean; summary: string }
  // A step of the run-intent request with the same number, in a few words for the overlay.
  | { type: 'run-progress'; t: number; request: number; activity: string };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction =
  // submit presses Return after the text whatever the field. Left out, Return follows only in a single-line field.
  | { type: 'type-text'; text: string; submit?: boolean }
  // A Fixed Intent was chosen. It never goes through Claude.
  | { type: 'fixed-intent'; name: FixedIntent }
  // Focus a text box the user looked at, so the Gaze Keyboard's text lands there.
  // rect is the box as matched, in overlay coordinates. name is for the log.
  // held is the time window the user held their gaze on that box, so the outside world can snapshot the uncorrected
  // gaze right then: by the time Done confirms the typed text (which fires the gaze learn), the raw buffer may have
  // evicted the samples.
  | { type: 'focus-text-box'; name: string; rect: Rect; held: { from: number; to: number } }
  // turnedDown holds the Suggested Intents passed over with Something else, so the model offers different ones.
  // element is the Chrome element the Suggested Intents are for, when a Gaze Scan in Chrome chose it.
  | { type: 'suggest-intents'; region: GazeRegion; request: number; turnedDown: string[]; element?: ElementHint }
  // region is the target the Intent was suggested for, so "Open this video" knows which video.
  // sinceWakeMs is the time from the Start Gesture waking the agent (or the last icon opened) to the Select Blink that
  // chose this Intent, for Time to Action.
  // held is when the user held their gaze on that target, so a run that went well can teach Gaze Correction.
  | { type: 'run-intent'; intent: string; region: GazeRegion; request: number; sinceWakeMs: number; held: { from: number; to: number }; element?: ElementHint }
  // The Stop Gesture during a run: the agent must stop acting at once.
  | { type: 'stop-run'; request: number }
  | { type: 'open-icon'; source: IconSource; name: string }
  | { type: 'show-dock' }
  // A hold whose uncorrected gaze must be kept now, since it may only teach Gaze Correction long after.
  | { type: 'snapshot-gaze'; held: { from: number; to: number } }
  | { type: 'release-dock' }
  | { type: 'close-menu' }
  // A confirmed choice for the Neural Layer to learn from. See src/shared/neural/layer.ts.
  | { type: 'learn'; signal: LearningSignal };

// Word prediction: the typed text in, the best words to finish it or follow it out. See src/shared/predict.ts.
export type Suggest = (text: string) => string[];

// Up to a few texts the user submitted before that the typed text starts, best first. See src/shared/predict.ts.
export type SuggestPhrases = (text: string) => string[];

const MAX_INTENTS = 3;
// In every picker, in this order, so the user learns where each one is in the scan.
const FIXED_INTENTS: FixedIntent[] = ['type'];

// The sources an icon hold can stick to.
type HeldSource = 'dock' | 'desktop' | 'menubar' | 'chrome';
const MAX_PAST_INTENTS = 2;

// Shaky gaze leaves a target for a moment, or lands closer to another one, without the user meaning to.
const HOLD_GRACE_MS = 500;
// The gaze must be off the screen this long before the Stop Gesture countdown shows, so a lost camera frame or a blink
// doesn't flash it while the user is just reading. The 5 s still count from the first sample off the screen.
const STOP_HINT_DELAY_MS = 1000;

// The Centre Box is large, so where the user looked inside it is a guess. It counts for a quarter of a sure selection.
const WAKE_GAZE_WEIGHT = 0.25;

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, scanStepMs: 2000, targetHoldMs: 1000, iconHoldMs: 3000, finishedMs: 3000 };

type Timings = typeof DEFAULT_TIMINGS;

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown): Timings {
  const timing = (key: keyof Timings) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return {
    wakeHoldMs: timing('wakeHoldMs'),
    lookAwayMs: timing('lookAwayMs'),
    scanStepMs: timing('scanStepMs'),
    targetHoldMs: timing('targetHoldMs'),
    iconHoldMs: timing('iconHoldMs'),
    finishedMs: timing('finishedMs'),
  };
}

// The box is 50vmin, as drawn in overlay.css. The centre must be inside, so a large radius can't start a hold.
function onCentreBox(region: GazeRegion | null, { width, height }: Screen) {
  if (region === null) return false;
  const half = Math.min(width, height) / 4;
  return Math.abs(region.x - width / 2) <= half && Math.abs(region.y - height / 2) <= half;
}

// How far the centre of the Gaze Region is from the nearest icon. The Dock, the menu bar and the Desktop icons sit on
// screen edges, and looking at them puts the camera's estimate hundreds of pixels past the edge, so the centre is
// pulled back onto the screen first.
function iconDistance(region: GazeRegion | null, icons: Icon[], { width, height }: Screen) {
  if (region === null) return Infinity;
  const x = Math.min(Math.max(region.x, 0), width);
  const y = Math.min(Math.max(region.y, 0), height);
  return Math.min(
    ...icons.map(({ rect }) => {
      const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
      const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
      return Math.hypot(dx, dy);
    }),
  );
}

// Near means the Gaze Region touches one of the icons.
function nearIcon(region: GazeRegion | null, icons: Icon[], screen: Screen) {
  return region !== null && iconDistance(region, icons, screen) <= region.radius;
}

// The whole width of the menu bar counts, since its menus and status items leave a wide gap between them. With centreOnly,
// only the gaze centre on it or past the top counts, not a whole radius below: in Chrome the tabs, the address bar and a
// page's search box sit within one radius of it and need their own 1 second hold.
function menuBarDistance(region: GazeRegion | null, items: Icon[], screen: Screen, centreOnly = false) {
  if (region === null || items.length === 0) return Infinity;
  const height = Math.max(...items.map(({ rect }) => rect.y + rect.height));
  if (centreOnly && region.y > height) return Infinity;
  return iconDistance(region, [{ name: '', rect: { x: 0, y: 0, width: screen.width, height } }], screen);
}

function nearMenuBar(region: GazeRegion | null, items: Icon[], screen: Screen) {
  return region !== null && menuBarDistance(region, items, screen) <= region.radius;
}

export function createSession({
  screen,
  timings,
  act = () => {},
  suggest = () => [],
  suggestPhrases = () => [],
  dock = () => [],
  desktop = () => [],
  menubar = () => [],
  textBoxes = () => [],
  chrome = () => [],
  chromeInFront = () => false,
  orderIcons = (_source, names) => names.map((_, i) => i),
  scanPace,
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
  suggest?: Suggest;
  suggestPhrases?: SuggestPhrases;
  dock?: () => Icon[];
  // Only the Desktop icons no window covers.
  desktop?: () => Icon[];
  // The menus of the app in front, then the status items.
  menubar?: () => Icon[];
  // Text fields the Gaze Keyboard can type into, read from the app in front.
  textBoxes?: () => TextBox[];
  // The named Chrome elements near the latest gaze, read by an Accessibility lookup. Empty when Chrome isn't in front or
  // "chromeScan" is off, which leaves the 1 second target hold as it was.
  chrome?: () => Icon[];
  // Whether Chrome is the app in front, whose tabs and address bar sit just under the menu bar.
  chromeInFront?: () => boolean;
  // The Neural Layer's Icon Order: icon names in screen order in, the indices to scan them in out. Indices, not names,
  // so two icons sharing a name can still be reordered without collapsing to one.
  orderIcons?: (source: IconSource, names: string[]) => number[];
  // The Neural Layer's Scan Pace: the step to use from the next restart of a scan. scanStepMs when left out.
  scanPace?: () => number;
}) {
  const { wakeHoldMs, lookAwayMs, scanStepMs, targetHoldMs, iconHoldMs, finishedMs } = parseTimings(timings);
  const iconsOf = { dock, desktop, menubar, chrome };
  const distance = (region: GazeRegion | null, from: HeldSource) =>
    from === 'menubar' ? menuBarDistance(region, menubar(), screen, chromeInFront()) : iconDistance(region, iconsOf[from](), screen);
  const near = (region: GazeRegion | null, from: HeldSource) =>
    region !== null && distance(region, from) <= region.radius;
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  // The time of the latest input, which the Stop Gesture countdown counts from.
  let now = 0;
  // The Gaze Region where the user started holding on a target after waking.
  let target: { region: GazeRegion; start: number } | null = null;
  // The wake hold ends on the Centre Box, so a target hold only starts after a Move Off from it.
  let movedOffCentreBox = false;
  let text = '';
  let group: string | null = null;
  // The Gaze Keyboard scans: the highlight steps through the keys in order, from the first key after every press.
  let scanStart = 0;
  // Read when a scan starts again, so a learned Scan Pace never changes the step under a highlight.
  let stepMs = scanStepMs;
  // A text box the user looked at, which teaches Gaze Correction once Done confirms what was typed into it.
  let textBoxGaze: { from: number; to: number; target: { x: number; y: number } } | null = null;
  // When the gaze settled on the target the Suggested Intents are for, or on the icons or Chrome elements of the latest scan.
  let held = { from: 0, to: 0 };
  // The Gaze Region radius of the hold that started the latest scan of icons or Chrome elements.
  let heldRadius = 0;
  // Every icon of the current Icon Scan, in screen order. scannedInOrder keeps the Icon objects themselves so the
  // chosen index can be found by identity, even when two icons share a name.
  let scanned: string[] = [];
  let scannedInOrder: Icon[] = [];
  // Whether the last Gaze Keyboard press was a letter (or group / word / phrase), so only a Back/Delete that follows one
  // counts as an undo: a second Delete in a row, or a deliberate round of editing, is not a mis-timed press.
  let lastKeyboardPressWasLetter = false;
  // Set for text that is always submitted, whatever the field.
  let submitOnDone = false;
  let highlight: KeyId = '';
  let suggestions: string[] = [];
  let phrases: string[] = [];
  let intents: string[] = [];
  let cells = 0;
  let recent = 0;
  // The target the model was asked about and what was turned down there, so Something else can ask again.
  let asked: GazeRegion | null = null;
  let askedElement: ElementHint | undefined;
  let turnedDown: string[] = [];
  // Numbers each request, so a late answer to an earlier one is dropped.
  let request = 0;
  let intent = '';
  // When the Start Gesture finished waking the agent, or the last icon was opened. Time to Action counts from here.
  let wokeAt = 0;
  let activity = '';
  // seen is when the gaze was last near the held icon target.
  let iconHold: { source: HeldSource; start: number; seen: number } | null = null;
  // A Dock that was asked to show stays up until it's released, or an icon is opened from it.
  let dockShown = false;
  // Copied when the icon scan starts, so the icons can't shift under the highlight.
  let source: IconSource = 'dock';
  let icons: Icon[] = [];
  let iconHighlight: Icon | undefined;
  let runOk = false;
  let summary = '';
  let finishedAt = 0;

  function restartScan(t: number) {
    scanStart = t;
    stepMs = scanPace?.() ?? scanStepMs;
  }

  const learn = (signal: LearningSignal) => act({ type: 'learn', signal });

  // Suggested Intents and icons scan the same way as the Gaze Keyboard.
  function scan(t: number) {
    const step = (length: number) => Math.floor(Math.max(t - scanStart, 0) / stepMs) % length;
    if (phase === 'icons') iconHighlight = icons[step(icons.length)];
    else {
      const keys = phase === 'choosing' ? pickerKeys() : layoutKeyboard(screen, group, suggestions, phrases).keys;
      highlight = keys[step(keys.length)].id;
    }
  }

  // Steps through the icons column by column from the left, top to bottom.
  function scanIcons(from: IconSource, all: Icon[], t: number) {
    iconHold = null;
    // A menu bar item that opens a panel, not a menu, reports no commands, and a scan needs something to highlight.
    if (all.length === 0) return;
    phase = 'icons';
    source = from;
    // Chrome elements come nearest the gaze first, so the scan starts on what the user looked at.
    const inScreenOrder = from === 'chrome' ? all : [...all].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
    scanned = inScreenOrder.map(({ name }) => name);
    scannedInOrder = inScreenOrder;
    // The icons this user opens most come first. Ordering by index, not by name, so two icons sharing a name still get
    // ranked; the ranker ties on their shared score and the input-order tie-break keeps them adjacent.
    // Chrome elements change with every page, so there is no order to learn for them.
    const orderedIndices = from === 'chrome' ? [] : orderIcons(from, scanned);
    icons = orderedIndices.length === inScreenOrder.length ? orderedIndices.map((i) => inScreenOrder[i]) : inScreenOrder;
    restartScan(t);
    scan(t);
  }

  // Looking near the Dock, the menu bar or a Desktop icon for 3 seconds sticks to it, and the scan steps through all
  // of its icons. Where two are near, as with a Desktop icon just under the menu bar, the closer one wins.
  // Returns whether an icon hold is going, which then takes the place of a target hold.
  function holdIcons(region: GazeRegion | null, t: number) {
    // A text box keeps its 1 second hold to the Gaze Keyboard, even among Chrome elements.
    const onTextBox = region !== null && textBoxAt(region) !== undefined;
    // The hold grace lets it finish on a sample with no gaze, so the radius is the last one seen.
    if (region !== null) heldRadius = region.radius;
    const nearest = (['dock', 'menubar', 'desktop', 'chrome'] as const)
      .filter((from) => !(from === 'chrome' && onTextBox) && near(region, from))
      .sort((a, b) => distance(region, a) - distance(region, b))[0];
    // Other apps can hide the Dock just past the bottom edge, so looking down starts a hold on it. Asks for it to
    // show, as the mouse would. Whether it's hidden right now is checked on the spot, outside the session.
    if (iconHold !== null && nearest === iconHold.source) iconHold.seen = t;
    else if (iconHold === null || t - iconHold.seen > HOLD_GRACE_MS) {
      if (nearest === 'dock' && !dockShown) {
        act({ type: 'show-dock' });
        dockShown = true;
      }
      iconHold = nearest === undefined ? null : { source: nearest, start: t, seen: t };
    }
    if (iconHold !== null && t - iconHold.start >= iconHoldMs) {
      held = { from: iconHold.start, to: t };
      scanIcons(iconHold.source, iconsOf[iconHold.source](), t);
      // A Chrome scan can loop past the 30 s of raw gaze kept, so a run that goes well later still has this hold.
      if (phase === 'icons' && source === 'chrome') act({ type: 'snapshot-gaze', held });
    }
    return iconHold !== null;
  }

  function refreshSuggestions() {
    suggestions = suggest(text).slice(0, MAX_SUGGESTIONS);
    phrases = suggestPhrases(text).slice(0, MAX_SHOWN_PHRASES);
  }

  // submit makes Done press Return after the text, whatever the field.
  function openKeyboard(t: number, submit = false) {
    phase = 'typing';
    submitOnDone = submit;
    holdStart = null;
    wakeProgress = 0;
    text = '';
    group = null;
    lastKeyboardPressWasLetter = false;
    refreshSuggestions();
    restartScan(t);
    scan(t);
  }

  function press(key: KeyId, t: number) {
    if (phase === 'choosing') choose(key, t);
    else if (key.startsWith(PHRASE_KEY)) {
      // The phrase starts with what was typed, so it replaces all of it. The chosen text is carried in the key id.
      text = key.slice(PHRASE_KEY.length);
      group = null;
    } else if (key.startsWith(SUGGESTION_KEY)) {
      // The word replaces the letters typed so far, and the space after it is free.
      text = text.replace(/[a-z]*$/, '') + key.slice(SUGGESTION_KEY.length) + ' ';
      group = null;
    } else if (GROUPS.includes(key)) group = key;
    else if (key === 'back') group = null;
    else if (key === 'delete') text = text.slice(0, -1);
    else if (key === 'space') text += ' ';
    else if (key === 'done') {
      if (text !== '') {
        act({ type: 'type-text', text, ...(submitOnDone && { submit: true }) });
        if (textBoxGaze) learn({ kind: 'gaze', ...textBoxGaze, weight: 1 });
      }
      textBoxGaze = null;
      phase = 'idle';
    } else {
      text += key;
      group = null;
    }
  }

  // The picker goes on the half of the screen the target isn't on.
  const side = (): IntentsSide => (asked !== null && asked.x >= screen.width / 2 ? 'left' : 'right');
  const pickerKeys = () => layoutIntents(screen, intents, cells, side(), recent, FIXED_INTENTS);

  function suggestIntents(region: GazeRegion, passedOver: string[], element?: ElementHint) {
    asked = region;
    askedElement = element;
    turnedDown = passedOver;
    act({ type: 'suggest-intents', region, request: ++request, turnedDown, ...(element && { element }) });
    phase = 'thinking';
  }

  function choose(key: KeyId, t: number) {
    if (key === 'something-else') return suggestIntents(asked!, [...turnedDown, ...intents], askedElement);
    // Back to idle, like a stop: staying awake would pick wherever the gaze rests on the panel as the next target.
    if (key === CLOSE_KEY) return stop();
    if (key === 'type') {
      act({ type: 'fixed-intent', name: 'type' });
      // The text goes to whatever already has focus, so no Text Box is focused and nothing teaches Gaze Correction.
      textBoxGaze = null;
      return openKeyboard(t);
    }
    intent = intents[Number(key.replace('intent-', ''))];
    activity = '';
    phase = 'running';
    act({ type: 'run-intent', intent, region: asked!, request: ++request, sinceWakeMs: t - wokeAt, held, ...(askedElement && { element: askedElement }) });
  }

  // The text box the Gaze Region touches, nearest first, so staring between two picks the one closer in.
  function textBoxAt(region: GazeRegion): TextBox | undefined {
    let best: TextBox | undefined;
    let bestD = region.radius;
    for (const box of textBoxes()) {
      const d = iconDistance(region, [box], screen);
      if (d <= bestD) {
        best = box;
        bestD = d;
      }
    }
    return best;
  }

  function holdTarget(region: GazeRegion | null, t: number) {
    if (region === null || offScreen(region, screen)) {
      target = null;
      return;
    }
    if (!onCentreBox(region, screen)) movedOffCentreBox = true;
    if (!movedOffCentreBox) return;
    // Jitter inside the first Gaze Region still counts as the same target.
    const moved = target && Math.hypot(region.x - target.region.x, region.y - target.region.y) > target.region.radius;
    if (target === null || moved) target = { region, start: t };
    if (t - target.start >= targetHoldMs) {
      // Where the gaze settled, not where the hold began: the first sample is often still on the way in.
      const box = textBoxAt(region);
      held = { from: target.start, to: t };
      if (box) {
        act({ type: 'focus-text-box', name: box.name, rect: box.rect, held });
        textBoxGaze = { ...held, target: { x: box.rect.x + box.rect.width / 2, y: box.rect.y + box.rect.height / 2 } };
        openKeyboard(t);
      } else suggestIntents(region, []);
      target = null;
    }
  }

  // The Stop Gesture, and recalibrating. Closes the Gaze Keyboard without typing the text, the icon scan without
  // opening anything, and stops a run. Nothing is asked of the outside world after the stop-run.
  function stop() {
    if (phase === 'running') act({ type: 'stop-run', request });
    if (phase === 'icons' && source === 'menu') act({ type: 'close-menu' });
    phase = 'idle';
    awaySince = null;
    textBoxGaze = null;
    // A Dock hold in progress ends too, so the Dock is released at the end of this input and not left forced open.
    iconHold = null;
  }

  function shown(): OverlayState {
    if (phase === 'typing') return { phase, wakeProgress, text, group, highlight, suggestions, phrases, stepMs };
    if (phase === 'choosing') {
      const stepProgress = (Math.max(now - scanStart, 0) % stepMs) / stepMs;
      return { phase, wakeProgress, intents, highlight, cells, recent, fixed: FIXED_INTENTS, side: side(), stepProgress };
    }
    if (phase === 'running') return { phase, wakeProgress, intent, activity };
    if (phase === 'icons') return { phase, wakeProgress, source, highlight: iconHighlight!, stepMs };
    if (phase === 'finished') return { phase, wakeProgress, intent, ok: runOk, summary };
    return { phase, wakeProgress };
  }

  function state(): OverlayState {
    const base = shown();
    // The result of a finished run isn't stopped by looking away, it just goes away.
    if (awaySince === null || now - awaySince < STOP_HINT_DELAY_MS || phase === 'idle' || phase === 'finished') return base;
    return { ...base, stopInMs: Math.max(lookAwayMs - (now - awaySince), 0) };
  }

  return (input: SessionInput): OverlayState => {
    now = input.t;
    if (input.type === 'recalibrate') {
      if (phase !== 'idle') stop();
    } else if (input.type === 'open-keyboard') {
      // The agent owns the mouse and keys while it runs, so typing would collide with it.
      if (phase !== 'typing' && phase !== 'running') openKeyboard(input.t);
    } else if (input.type === 'past-intents') {
      // Only before Claude has answered: after that the picker is already up and the past ones would be reordering it.
      if (phase === 'thinking' && input.request === request && input.intents.length > 0) {
        phase = 'choosing';
        intents = input.intents.slice(0, MAX_PAST_INTENTS);
        recent = intents.length;
        // Room for the Fixed Intents, Claude's Intents, which join later, and Something else.
        cells = recent + FIXED_INTENTS.length + MAX_INTENTS + 1;
        restartScan(input.t);
        scan(input.t);
      }
    } else if (input.type === 'intents') {
      if (phase === 'thinking' && input.request === request) {
        phase = 'choosing';
        intents = input.intents.slice(0, MAX_INTENTS);
        recent = 0;
        cells = FIXED_INTENTS.length + MAX_INTENTS + 1;
        restartScan(input.t);
        scan(input.t);
      } else if (phase === 'choosing' && input.request === request) {
        // Claude's Suggested Intents join the end of what the user is already scanning. Nothing moves.
        const shown = new Set(intents.map((text) => text.toLowerCase()));
        const added = input.intents.filter((text) => !shown.has(text.toLowerCase()) && shown.add(text.toLowerCase())).slice(0, MAX_INTENTS);
        if (added.length > 0) {
          scan(input.t);
          const before = highlight;
          const spent = Math.max(input.t - scanStart, 0) % stepMs;
          intents = [...intents, ...added];
          // Something else moves later in the key order, which changes the wrap-round. Start the scan again from
          // where it was, so the same key stays lit and keeps the time it already had.
          const at = pickerKeys().findIndex((key) => key.id === before);
          scanStart = input.t - at * stepMs - spent;
          scan(input.t);
        }
      }
    } else if (input.type === 'run-finished') {
      if (phase === 'running' && input.request === request) {
        phase = 'finished';
        runOk = input.ok;
        summary = input.summary;
        finishedAt = input.t;
      }
    } else if (input.type === 'run-progress') {
      if (phase === 'running' && input.request === request) activity = input.activity;
    } else if (input.type === 'menu-opened') {
      // The menu opens after the Select Blink. If the user has moved on by then, it's closed again.
      if (phase === 'waiting-for-target') scanIcons('menu', input.icons, input.t);
      else if (input.icons.length > 0) act({ type: 'close-menu' });
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') {
        // Watching an icon on a screen edge during its scan is often read as off the screen, and it mustn't count as
        // Look Away. Elsewhere, past the edge is still off the screen, so the Stop Gesture works over the Dock too.
        const onEdgeIcon =
          phase === 'icons' &&
          source !== 'chrome' &&
          (source === 'menubar' ? nearMenuBar(input.region, icons, screen) : nearIcon(input.region, icons, screen));
        const away = offScreen(input.region, screen) && !onEdgeIcon;
        awaySince = away ? (awaySince ?? input.t) : null;
      }
      if (phase === 'finished' && input.t - finishedAt >= finishedMs) {
        stop();
      } else if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        stop();
      } else if (phase === 'waiting-for-target' && input.type === 'gaze') {
        // An icon hold wins, so the shorter target hold can't fire on the way to the Dock.
        if (holdIcons(input.region, input.t)) target = null;
        else holdTarget(input.region, input.t);
      } else if (phase === 'icons') {
        scan(input.t);
        if (input.type === 'select') {
          learn({ kind: 'select', offsetMs: Math.max(input.t - scanStart, 0) % stepMs, stepMs, undoes: false });
          if (source === 'chrome') {
            // A Chrome element isn't opened: it becomes the target of the Suggested Intents, with its name and bounds as
            // the hint. Nothing is confirmed yet, so it teaches Gaze Correction only through a run that goes well (held).
            const { rect, label, name } = iconHighlight!;
            const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            suggestIntents({ ...centre, radius: heldRadius }, [], { name: label ?? name, rect });
          } else {
            // Identity, not name, so a Dock with two icons sharing a name teaches on the exact one picked.
            const chosenIndex = scannedInOrder.indexOf(iconHighlight!);
            if (chosenIndex >= 0) learn({ kind: 'icon-opened', source, scanned, chosenIndex });
            act({ type: 'open-icon', source, name: iconHighlight!.name });
            // The opened app takes the focus, which drops the Dock. Opening also gives back any focus the Dock kept.
            dockShown = false;
            // Stays awake, so the user can pick the next icon without the Start Gesture again. A menu bar item that
            // opens a menu reports its commands with menu-opened, which scans them next.
            phase = 'waiting-for-target';
            // Staying awake stands in for a new Start Gesture, so Time to Action counts from here, not the first wake.
            wokeAt = input.t;
          }
        }
      } else if (phase === 'typing' || phase === 'choosing') {
        scan(input.t);
        if (input.type === 'select') {
          // Back and Delete take back the press before, which then landed a step late — but only when the press before
          // was a letter. A second Delete in a row, or deliberate editing, is not a mis-timed press.
          const typing = phase === 'typing';
          const isUndoKey = typing && (highlight === 'back' || highlight === 'delete');
          const undoes = isUndoKey && lastKeyboardPressWasLetter;
          learn({ kind: 'select', offsetMs: Math.max(input.t - scanStart, 0) % stepMs, stepMs, undoes });
          press(highlight, input.t);
          if (phase === 'typing') refreshSuggestions();
          // Type opening the keyboard is not a letter press, so a first Delete there is not an undo.
          if (typing && phase === 'typing') lastKeyboardPressWasLetter = !isUndoKey;
          restartScan(input.t);
          scan(input.t);
        }
      }
    } else if (input.type === 'gaze') {
      if (onCentreBox(input.region, screen)) {
        holdStart ??= input.t;
        wakeProgress = Math.min((input.t - holdStart) / wakeHoldMs, 1);
      } else {
        holdStart = null;
        wakeProgress = 0;
      }
      if (wakeProgress === 1) {
        // A weak label: the user looked at the Centre Box, most likely its middle, where the words are.
        learn({ kind: 'gaze', from: holdStart!, to: input.t, target: { x: screen.width / 2, y: screen.height / 2 }, weight: WAKE_GAZE_WEIGHT });
        phase = 'waiting-for-target';
        wokeAt = input.t;
        iconHold = null;
        holdStart = null;
        wakeProgress = 0;
        // A target hold cut short last time, for example by the Gaze Keyboard, must not carry over.
        target = null;
        movedOffCentreBox = false;
      }
    }
    // Leaving the Dock without opening anything takes the focus off it, so the app that hid it hides it again.
    const onDock = iconHold?.source === 'dock' || (phase === 'icons' && source === 'dock');
    if (dockShown && !onDock) {
      act({ type: 'release-dock' });
      dockShown = false;
    }
    return state();
  };
}
