import {
  ArrowDown,
  ArrowUp,
  Ban,
  Camera,
  Copy,
  createElement,
  Ellipsis,
  ExternalLink,
  FileText,
  GitBranch,
  House,
  Keyboard,
  Maximize2,
  Minimize2,
  PanelBottom,
  MousePointerClick,
  Pause,
  PenLine,
  Play,
  RefreshCw,
  Save,
  Search,
  Send,
  SkipForward,
  Sparkles,
  Terminal,
  Trash,
  Volume2,
  VolumeX,
  X,
  type IconNode,
} from 'lucide';
import type { Rect } from '../shared/geometry';
import { fallbackLook, type IntentIcon, type IntentLook } from '../shared/intent-look';
import { layoutIntents, layoutKeyboard, PHRASE_KEY, type FixedIntent, type Key, type KeyId } from '../shared/keyboard';
import { fitFrame, highlightMode, magnify, type LargeView } from '../shared/large-view';
import type { OverlayState, SessionInput } from '../shared/session';

declare global {
  interface Window {
    overlay: {
      onState(listener: (state: OverlayState) => void): void;
      onLargeView(listener: (settings: LargeView) => void): void;
      onIntentLooks(listener: (looks: Record<string, IntentLook>) => void): void;
      sendGaze(input: SessionInput): void;
    };
  }
}

const audio = new AudioContext();

function chime(frequencies = [660, 880]) {
  frequencies.forEach((frequency, i) => {
    const start = audio.currentTime + i * 0.15;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = frequency;
    // A short fade in, so the tone starts without a click.
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(0.3, start + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
    tone.connect(volume).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.4);
  });
}

// Drawn as inline SVG, since the Content-Security-Policy blocks data: URLs for images. 24 x 24, stroked.
const ICONS = {
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M12 7v6', 'M12 17.25v.01'],
  delete: ['M9.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.5L3 12Z', 'M12 9.5l5 5', 'M17 9.5l-5 5'],
  back: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  space: ['M4 9.5V14h16V9.5'],
  sparkle: ['M12 2.5c.7 5.2 2.3 6.8 7.5 7.5-5.2.7-6.8 2.3-7.5 7.5-.7-5.2-2.3-6.8-7.5-7.5 5.2-.7 6.8-2.3 7.5-7.5Z', 'M19 15.5c.3 2.2 1 2.9 3 3.2-2 .3-2.7 1-3 3.2-.3-2.2-1-2.9-3-3.2 2-.3 2.7-1 3-3.2Z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z', 'M12 7.5V12l3 2'],
};

function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.classList.add('icon');
  for (const d of ICONS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const KEY_ICONS: Partial<Record<KeyId, keyof typeof ICONS>> = {
  delete: 'delete',
  back: 'back',
  space: 'space',
  done: 'check',
};

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SPRING = getComputedStyle(document.documentElement).getPropertyValue('--spring') || EASE;

const root = document.documentElement;
const wake = document.getElementById('wake')!;
const keyboard = document.getElementById('keyboard')!;
const typed = document.getElementById('typed')!;
const iconHighlight = document.getElementById('icon-highlight')!;
const iconMagnifier = document.getElementById('icon-magnifier')!;
const status = document.getElementById('status')!;
const stopHint = document.getElementById('stop-hint')!;
const noIntents = document.getElementById('no-intents')!;
const statusGlyph = status.querySelector<HTMLElement>('.glyph')!;
const statusLines = status.querySelector<HTMLElement>('.lines')!;
const [statusTitle, statusDetail, statusHint] = [...statusLines.children] as HTMLElement[];

document.querySelector('#wake .wake-label')!.prepend(icon('eye'));
// The island sits under the menu bar, which on a MacBook is as tall as the notch.
root.style.setProperty('--menu-bar', `${Math.max((screen as Screen & { availTop?: number }).availTop ?? 0, 24)}px`);

function place(element: HTMLElement, { x, y, width, height }: Rect) {
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
}

// The overlay covers the primary display, so this is the same layout the session core hit-tests against.
const screenSize = { width: innerWidth, height: innerHeight };

// The layouts fill the screen edge to edge. The keys are drawn on a sheet a little inside it, which only the scan
// order reaches, so nothing the session hit-tests moves.
const SHEET_MARGIN = 28;
function onSheet({ x, y, width, height }: Rect): Rect {
  const sx = (screenSize.width - 2 * SHEET_MARGIN) / screenSize.width;
  const sy = (screenSize.height - 2 * SHEET_MARGIN) / screenSize.height;
  return { x: SHEET_MARGIN + x * sx, y: SHEET_MARGIN + y * sy, width: width * sx, height: height * sy };
}

const typedRect = onSheet(layoutKeyboard(screenSize, null).text);
place(typed, typedRect);
root.style.setProperty('--typed-middle', `${typedRect.y + typedRect.height / 2}px`);

function drawKey(element: HTMLElement, { id, label }: Key) {
  const name = KEY_ICONS[id] ?? (id.startsWith(PHRASE_KEY) ? 'sparkle' : undefined);
  if (name) element.append(icon(name));
  const text = document.createElement('span');
  text.textContent = label;
  element.append(text);
}

// Which screen of keys is drawn, so they are only rebuilt when it changes.
let shownKeys: string | undefined;
let keyElements = new Map<string, HTMLElement>();
// The keys of the screen before, so only keys that are new animate in, not ones that stay, as when Claude's Suggested
// Intents join the past ones.
let drawnBefore = new Set<string>();

// recent is how many of the keys, from the first, are past Intents.
function showKeys(name: string, keys: Key[], draw: (element: HTMLElement, key: Key) => void = drawKey, recent = 0) {
  if (name === shownKeys) return;
  keyElements.forEach((element) => element.remove());
  const drawn = new Set(keys.map(({ id, label }) => `${id}\n${label}`));
  keyElements = new Map(
    keys.map((key, i) => {
      const { id, label, rect } = key;
      const element = document.createElement('div');
      element.className = drawnBefore.has(`${id}\n${label}`) ? 'key' : 'key enter';
      element.dataset.key = id;
      element.style.setProperty('--i', String(i));
      // The CSS caps the label size by this, so the labels still fit when phrases and words add rows.
      element.style.setProperty('--key-height', `${rect.height}px`);
      const frost = document.createElement('span');
      frost.className = 'frost';
      frost.ariaHidden = 'true';
      element.append(frost);
      if (i < recent) {
        element.classList.add('history');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.append(icon('clock'), 'Recent');
        element.append(badge);
      }
      draw(element, key);
      place(element, onSheet(rect));
      keyboard.append(element);
      return [key.id, element];
    }),
  );
  drawnBefore = drawn;
  shownKeys = name;
  lit = undefined;
}

const INTENT_ICON_NODES: Record<IntentIcon, IconNode> = {
  screenshot: Camera,
  branch: GitBranch,
  'scroll-down': ArrowDown,
  'scroll-up': ArrowUp,
  click: MousePointerClick,
  maximize: Maximize2,
  minimize: Minimize2,
  close: X,
  play: Play,
  pause: Pause,
  skip: SkipForward,
  search: Search,
  type: Keyboard,
  document: FileText,
  open: ExternalLink,
  copy: Copy,
  delete: Trash,
  refresh: RefreshCw,
  sound: Volume2,
  mute: VolumeX,
  send: Send,
  save: Save,
  write: PenLine,
  terminal: Terminal,
  more: Ellipsis,
  other: Sparkles,
};

// Claude's label and icon for each Suggested Intent, kept for the whole run so past Intents it named before keep theirs.
const intentLooks = new Map<string, IntentLook>();
window.overlay.onIntentLooks((looks) => Object.entries(looks).forEach(([text, look]) => intentLooks.set(text, look)));

type TileLook = { label: string; glyph: IconNode };

const FIXED_LOOKS: Record<FixedIntent, TileLook> = {
  // Not an X: Claude's "Close the window" tiles use that, and this only puts the picker away.
  close: { label: 'Cancel', glyph: Ban },
  home: { label: 'Home', glyph: House },
  minimize: { label: 'Minimize', glyph: Minimize2 },
  dock: { label: 'Dock', glyph: PanelBottom },
  cmd: { label: 'Cmd', glyph: Terminal },
  'next-tab': { label: 'Next Tab', glyph: SkipForward },
  'close-tab': { label: 'Close Tab', glyph: X },
};

function lookOf({ id, label }: Key): TileLook {
  if (id in FIXED_LOOKS) return FIXED_LOOKS[id as FixedIntent];
  const look = id === 'something-else' ? { label: 'More', icon: 'more' as const } : (intentLooks.get(label) ?? fallbackLook(label));
  return { label: look.label, glyph: INTENT_ICON_NODES[look.icon] };
}

const SVG = 'http://www.w3.org/2000/svg';

// textContent and attributes only: the intent text comes from Claude, which read the screen.
function drawTile(element: HTMLElement, key: Key) {
  const look = lookOf(key);
  element.classList.add('tile');
  element.setAttribute('role', 'button');
  element.setAttribute('aria-label', key.label);
  element.title = key.label;
  const badge = document.createElement('div');
  badge.className = 'tile-icon';
  // The ring starts at the top and fills clockwise: the stylesheet turns it a quarter back.
  const ring = document.createElementNS(SVG, 'svg');
  ring.setAttribute('class', 'tile-ring');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.setAttribute('aria-hidden', 'true');
  for (const part of ['track', 'fill']) {
    const circle = document.createElementNS(SVG, 'circle');
    for (const [name, value] of Object.entries({ class: `tile-ring-${part}`, cx: '50', cy: '50', r: '46', pathLength: '1' })) circle.setAttribute(name, value);
    ring.append(circle);
  }
  const icon = createElement(look.glyph, { class: 'tile-glyph', 'aria-hidden': 'true' });
  badge.append(ring, icon);
  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = look.label;
  element.append(badge, label);
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// With reduced motion the ring fills in quarters and doesn't animate between them.
const RING_STEPS = 4;

function showStepProgress(progress: number) {
  const shown = reducedMotion.matches ? Math.floor(progress * RING_STEPS) / RING_STEPS : progress;
  keyElements.forEach((element) => element !== lit && element.style.removeProperty('--step'));
  lit?.style.setProperty('--step', String(shown));
}

let lastPhase: OverlayState['phase'] = 'idle';

function showKeyboard({ text, group, highlight, suggestions, phrases, stepMs }: Extract<OverlayState, { phase: 'typing' }>) {
  if (typed.textContent !== text) {
    typed.textContent = text;
    typed.scrollLeft = typed.scrollWidth;
  }
  showKeys(`typing ${JSON.stringify([group, suggestions, phrases])}`, layoutKeyboard(screenSize, group, suggestions, phrases).keys);
  highlightKey(highlight, stepMs);
}

let lit: HTMLElement | undefined;
let stepBar: Animation | undefined;

// stepMs is left out for the Suggested Intents, whose tiles draw the step as a ring instead.
function highlightKey(id: KeyId, stepMs?: number) {
  const element = keyElements.get(id);
  if (!element || element === lit) return;
  lit?.classList.remove('highlighted');
  element.classList.add('highlighted');
  lit = element;
  if (stepMs !== undefined) showStep(element, stepMs);
}

// Fills the bar under the highlight over one step, so the user can see how long is left to blink.
function showStep(element: HTMLElement, stepMs: number) {
  stepBar?.cancel();
  stepBar = element.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
    duration: stepMs,
    iterations: Infinity,
    pseudoElement: '::after',
  });
}

const stopping = (ms: number) => `Stopping in ${Math.ceil(ms / 1000)}…`;

// The countdown on every screen but the run banner, which has its own. Shown only while the gaze is off the screen.
function showStopHint(state: OverlayState) {
  stopHint.hidden = state.stopInMs === undefined || state.phase === 'running';
  if (stopHint.hidden) return;
  stopHint.textContent = stopping(state.stopInMs!);
  stopHint.dataset.at = stopHintPlace(state);
}

// Where the countdown covers nothing the user picks from: over the typed text on the Gaze Keyboard, on the gap between
// the Suggested Intents in the middle, away from the edge being scanned, and at the bottom over the app otherwise
// (the island is at the top).
function stopHintPlace(state: OverlayState): 'top' | 'middle' | 'bottom' {
  if (state.phase === 'typing') return 'top';
  // The Suggested Intents are a column on one side and the target is on the other half, so the middle is clear.
  if (state.phase === 'choosing') return 'middle';
  if (state.phase === 'icons' && state.source === 'chrome') {
    // Chrome elements can be anywhere, so the countdown goes on the half of the screen the highlight isn't on.
    const { y, height } = state.highlight.rect;
    return y + height / 2 < innerHeight / 2 ? 'bottom' : 'top';
  }
  if (state.phase === 'icons') return state.source === 'menubar' || state.source === 'menu' ? 'bottom' : 'top';
  return 'bottom';
}

// Animates an element from its size before change() to its size after, so the island morphs instead of jumping.
function morph(element: HTMLElement, change: () => void) {
  const from = element.getBoundingClientRect();
  change();
  const to = element.getBoundingClientRect();
  if (from.width === 0 || (from.width === to.width && from.height === to.height)) return;
  element.animate(
    [
      { width: `${from.width}px`, height: `${from.height}px` },
      { width: `${to.width}px`, height: `${to.height}px` },
    ],
    { duration: 600, easing: SPRING },
  );
}

// textContent only: the summary comes from a web page Claude read.
function statusText(state: OverlayState): [string, string, string] {
  if (state.phase === 'waiting-for-target') return ['Look at what you want', '', 'Look away to stop'];
  if (state.phase === 'running')
    return [state.intent, state.activity ? `${state.activity}…` : 'Working…', state.stopInMs === undefined ? 'Look away to stop' : stopping(state.stopInMs)];
  if (state.phase === 'finished') return [state.ok ? 'Done' : "Couldn't finish", state.summary, ''];
  return ['Thinking…', 'Finding what you can do', ''];
}

// Waking only needs acknowledging. After this the island tucks back around the notch, out of the way of the target.
const ISLAND_COMPACT_MS = 2500;
let statusShown = '';
let statusPhase: OverlayState['phase'] | undefined;
let compactTimer: ReturnType<typeof setTimeout> | undefined;

function showStatus(state: OverlayState) {
  status.hidden = !['waiting-for-target', 'thinking', 'running', 'finished'].includes(state.phase);
  if (status.hidden) {
    statusShown = '';
    statusPhase = undefined;
    clearTimeout(compactTimer);
    delete status.dataset.compact;
    return;
  }
  const [title, detail, hint] = statusText(state);
  const shown = JSON.stringify([state.phase, title, detail, hint]);
  if (shown === statusShown) return;
  statusShown = shown;
  const entering = state.phase !== statusPhase;
  morph(status, () => {
    if (entering) {
      statusPhase = state.phase;
      clearTimeout(compactTimer);
      delete status.dataset.compact;
      if (state.phase === 'finished') root.dataset.ok = String(state.ok);
      statusGlyph.replaceChildren(
        ...(state.phase === 'waiting-for-target' ? [icon('eye')] : state.phase === 'finished' ? [icon(state.ok ? 'check' : 'alert')] : []),
      );
      if (state.phase === 'waiting-for-target') compactTimer = setTimeout(() => morph(status, () => (status.dataset.compact = '')), ISLAND_COMPACT_MS);
    }
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    statusDetail.hidden = detail === '';
    statusHint.textContent = hint;
    statusHint.hidden = hint === '';
    statusHint.dataset.warn = String(state.stopInMs !== undefined);
  });
  if (entering) statusLines.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 120, easing: EASE, fill: 'backwards' });
}

// Set once main has read config.json. Until then, and when Large View is off, everything is drawn at the standard size.
let largeView: LargeView | undefined;
window.overlay.onLargeView((settings) => {
  largeView = settings.enabled ? settings : undefined;
  if (largeView) root.style.setProperty('--ui-scale', String(largeView.uiScale));
  else root.style.removeProperty('--ui-scale');
});

// textContent only: icon names come from other apps.
function showIcon({ highlight, stepMs, source }: Extract<OverlayState, { phase: 'icons' }>) {
  iconMagnifier.hidden = largeView === undefined;
  // A Chrome element is chosen, never opened, so its label says so.
  iconMagnifier.dataset.source = source;
  // Menu bar items, menu commands and Chrome elements are fitted, with room for the border, so it never covers them:
  // a Chrome element can be a 16 point line of text. Dock and Desktop icons are grown so a small one is easy to see.
  const mode = highlightMode(source);
  iconHighlight.toggleAttribute('data-fit', mode === 'fit');
  if (largeView === undefined) return place(iconHighlight, mode === 'fit' ? fitFrame(highlight.rect, 1) : highlight.rect);
  const { frame, panel } = magnify(highlight.rect, screenSize, largeView.uiScale, mode);
  place(iconHighlight, frame);
  place(iconMagnifier, panel);
  const label = highlight.label ?? highlight.name;
  if (iconMagnifier.textContent === label) return;
  iconMagnifier.textContent = label;
  showStep(iconMagnifier, stepMs);
}

window.overlay.onState((state) => {
  const entering = state.phase !== lastPhase;
  root.dataset.phase = state.phase;
  wake.style.display = state.phase === 'idle' ? '' : 'none';
  root.style.setProperty('--wake-progress', String(state.wakeProgress));
  root.toggleAttribute('data-waking', state.phase === 'idle' && state.wakeProgress > 0);
  if (state.phase === 'typing') showKeyboard(state);
  // A new scan starts its step bar afresh, even on the icon the last one ended on.
  if (state.phase === 'icons' && entering) iconMagnifier.textContent = '';
  if (state.phase === 'icons') showIcon(state);
  if (state.phase === 'choosing') {
    const { side, cells, recent, intents, fixed, fixedAt } = state;
    const keys = layoutIntents(screenSize, state);
    showKeys(`choosing ${side} ${cells} ${recent} ${fixedAt} ${fixed.join(' ')} ${intents.join('\n')}`, keys, drawTile, recent);
    highlightKey(state.highlight);
    showStepProgress(state.stepProgress);
    // In the first empty cell, where Claude's first Intent would be. Why there were none is in the log.
    const note = state.suggesting ? 'Finding more…' : 'Nothing this time. Blink on More to try again.';
    if (noIntents.textContent !== note) noIntents.textContent = note;
    place(noIntents, onSheet(layoutIntents(screenSize, { ...state, intents: [...intents, ''] }).at(-2)!.rect));
  }
  // The Chrome Commands scan has no cell kept for Intents, so no note.
  noIntents.hidden =
    state.phase !== 'choosing' || !(state.suggesting || state.intents.length === 0) || state.intents.length + state.fixed.length + 1 >= state.cells;
  showStatus(state);
  showStopHint(state);
  if (!entering) return;
  if (state.phase === 'waiting-for-target') chime();
  if (state.phase === 'finished') chime(state.ok ? [660, 880] : [440, 330]);
  lastPhase = state.phase;
});

// Loaded on demand, so the mouse input never pulls in MediaPipe.
if (location.search === '?camera') {
  import('./camera-gaze')
    .then(({ startCameraGaze }) => startCameraGaze(window.overlay.sendGaze))
    .catch((error: Error) => {
      const message = document.getElementById('gaze-message')!;
      message.textContent = `Could not start the camera: ${error.message}`;
      message.hidden = false;
    });
}
