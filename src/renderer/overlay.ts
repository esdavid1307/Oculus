import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  createElement,
  Ellipsis,
  ExternalLink,
  FileText,
  GitBranch,
  Keyboard,
  Maximize2,
  Minimize2,
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
import { CLOSE_KEY, layoutIntents, layoutKeyboard, type Key, type KeyId } from '../shared/keyboard';
import { magnify, type LargeView } from '../shared/large-view';
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
    volume.gain.setValueAtTime(0.3, start);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
    tone.connect(volume).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.4);
  });
}

const root = document.documentElement;
const keyboard = document.getElementById('keyboard')!;
const typed = document.getElementById('typed')!;
const iconHighlight = document.getElementById('icon-highlight')!;
const iconMagnifier = document.getElementById('icon-magnifier')!;
const status = document.getElementById('status')!;
const stopHint = document.getElementById('stop-hint')!;
const noIntents = document.getElementById('no-intents')!;

function place(element: HTMLElement, { x, y, width, height }: Rect) {
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
}

// The overlay covers the primary display, so this is the same layout the session core hit-tests against.
const screenSize = { width: innerWidth, height: innerHeight };
place(typed, layoutKeyboard(screenSize, null).text);

// Which screen of keys is drawn, so they are only rebuilt when it changes.
let shownKeys: string | undefined;
let keyElements = new Map<string, HTMLElement>();

function showKeys(name: string, keys: Key[], draw: (element: HTMLElement, key: Key) => void = (element, { label }) => (element.textContent = label)) {
  if (name === shownKeys) return;
  keyElements.forEach((element) => element.remove());
  keyElements = new Map(
    keys.map((key) => {
      const element = document.createElement('div');
      element.className = 'key';
      element.dataset.key = key.id;
      draw(element, key);
      place(element, key.rect);
      // The CSS caps the label size by this, so the labels still fit when phrases and words add rows.
      element.style.setProperty('--key-height', `${key.rect.height}px`);
      keyboard.append(element);
      return [key.id, element];
    }),
  );
  shownKeys = name;
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

function lookOf({ id, label }: Key): IntentLook {
  if (id === 'something-else') return { label: 'More', icon: 'more' };
  if (id === CLOSE_KEY) return { label: 'Close', icon: 'close' };
  return intentLooks.get(label) ?? fallbackLook(label);
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
  const icon = createElement(INTENT_ICON_NODES[look.icon], { class: 'tile-glyph', 'aria-hidden': 'true' });
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
  keyElements.forEach((element) => element !== litKey && element.style.removeProperty('--step'));
  litKey?.style.setProperty('--step', String(shown));
}

let lastPhase: OverlayState['phase'] = 'idle';
let litKey: HTMLElement | undefined;

function showKeyboard({ text, group, highlight, suggestions, phrases }: Extract<OverlayState, { phase: 'typing' }>) {
  if (typed.textContent !== text) {
    typed.textContent = text;
    typed.scrollLeft = typed.scrollWidth;
  }
  showKeys(`typing ${JSON.stringify([group, suggestions, phrases])}`, layoutKeyboard(screenSize, group, suggestions, phrases).keys);
  highlightKey(highlight);
}

function highlightKey(id: KeyId) {
  litKey?.classList.remove('highlighted');
  litKey = keyElements.get(id);
  litKey?.classList.add('highlighted');
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
// (the "Thinking…" banner is in the middle).
function stopHintPlace(state: OverlayState): 'top' | 'middle' | 'bottom' {
  if (state.phase === 'typing') return 'top';
  // The Suggested Intents are a column on one side and the target is on the other half, so the middle is clear.
  if (state.phase === 'choosing') return 'middle';
  if (state.phase === 'icons') return state.source === 'menubar' || state.source === 'menu' ? 'bottom' : 'top';
  return 'bottom';
}

// textContent and text nodes only: the summary comes from a web page Claude read.
function showStatus(state: OverlayState) {
  status.hidden = state.phase !== 'thinking' && state.phase !== 'running' && state.phase !== 'finished';
  if (status.hidden) return;
  if (state.phase === 'running') {
    const activity = document.createElement('span');
    activity.textContent = state.activity ? `${state.activity}…` : 'Starting…';
    const hint = document.createElement('small');
    hint.textContent = state.stopInMs === undefined ? 'Look away to stop' : stopping(state.stopInMs);
    status.replaceChildren(document.createTextNode(`Running: ${state.intent}`), activity, hint);
  } else if (state.phase === 'finished') {
    status.textContent = `${state.ok ? 'Done' : "Couldn't finish"}: ${state.summary}`;
    root.dataset.ok = String(state.ok);
  } else status.textContent = 'Thinking…';
}

// Set once main has read config.json. Until then, and when Large View is off, everything is drawn at the standard size.
let largeView: LargeView | undefined;
window.overlay.onLargeView((settings) => {
  largeView = settings.enabled ? settings : undefined;
  if (largeView) root.style.setProperty('--ui-scale', String(largeView.uiScale));
  else root.style.removeProperty('--ui-scale');
});

// textContent only: icon names come from other apps.
function showIcon({ highlight }: Extract<OverlayState, { phase: 'icons' }>) {
  iconMagnifier.hidden = largeView === undefined;
  if (largeView === undefined) return place(iconHighlight, highlight.rect);
  const { frame, panel } = magnify(highlight.rect, screenSize, largeView.uiScale);
  place(iconHighlight, frame);
  place(iconMagnifier, panel);
  iconMagnifier.textContent = highlight.label ?? highlight.name;
}

window.overlay.onState((state) => {
  root.style.setProperty('--wake-progress', String(state.wakeProgress));
  if (state.phase === 'typing') showKeyboard(state);
  if (state.phase === 'icons') showIcon(state);
  if (state.phase === 'choosing') {
    showKeys(`choosing ${state.side} ${state.intents.join('\n')}`, layoutIntents(screenSize, state.intents, state.cells, state.side), drawTile);
    highlightKey(state.highlight);
    showStepProgress(state.stepProgress);
    // In the first cell, where an intent would be. The reason is in the log.
    place(noIntents, layoutIntents(screenSize, [''], state.cells, state.side)[0].rect);
  }
  noIntents.hidden = state.phase !== 'choosing' || state.intents.length > 0;
  showStatus(state);
  showStopHint(state);
  if (state.phase === lastPhase) return;
  if (state.phase === 'waiting-for-target') chime();
  if (state.phase === 'finished') chime(state.ok ? [660, 880] : [440, 330]);
  root.dataset.phase = state.phase;
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
