import type { Rect } from '../shared/geometry';
import { layoutIntents, layoutKeyboard, type Key, type KeyId } from '../shared/keyboard';
import type { OverlayState, SessionInput } from '../shared/session';

declare global {
  interface Window {
    overlay: { onState(listener: (state: OverlayState) => void): void; sendGaze(input: SessionInput): void };
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
const status = document.getElementById('status')!;

function place(element: HTMLElement, { x, y, width, height }: Rect) {
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
}

// The overlay covers the primary display, so this is the same layout the session core hit-tests against.
const screenSize = { width: innerWidth, height: innerHeight };
place(typed, layoutKeyboard(screenSize, null).text);

// Which screen of keys is drawn, so they are only rebuilt when it changes.
let shownKeys: string | undefined;
let keyElements = new Map<string, HTMLElement>();

function showKeys(name: string, keys: Key[]) {
  if (name === shownKeys) return;
  keyElements.forEach((element) => element.remove());
  keyElements = new Map(
    keys.map(({ id, label, rect }) => {
      const element = document.createElement('div');
      element.className = 'key';
      element.dataset.key = id;
      element.textContent = label;
      place(element, rect);
      keyboard.append(element);
      return [id, element];
    }),
  );
  shownKeys = name;
}

let lastPhase: OverlayState['phase'] = 'idle';
let litKey: HTMLElement | undefined;

function showKeyboard({ text, group, highlight, suggestions }: Extract<OverlayState, { phase: 'typing' }>) {
  if (typed.textContent !== text) {
    typed.textContent = text;
    typed.scrollLeft = typed.scrollWidth;
  }
  showKeys(`typing ${JSON.stringify([group, suggestions])}`, layoutKeyboard(screenSize, group, suggestions).keys);
  highlightKey(highlight);
}

function highlightKey(id: KeyId) {
  litKey?.classList.remove('highlighted');
  litKey = keyElements.get(id);
  litKey?.classList.add('highlighted');
}

// textContent and text nodes only: the summary comes from a web page Claude read.
function showStatus(state: OverlayState) {
  status.hidden = state.phase !== 'thinking' && state.phase !== 'running' && state.phase !== 'finished';
  if (status.hidden) return;
  if (state.phase === 'running') {
    const hint = document.createElement('small');
    hint.textContent = 'Look away to stop';
    status.replaceChildren(document.createTextNode(`Running: ${state.intent}`), hint);
  } else if (state.phase === 'finished') {
    status.textContent = `${state.ok ? 'Done' : "Couldn't finish"}: ${state.summary}`;
    root.dataset.ok = String(state.ok);
  } else status.textContent = 'Thinking…';
}

window.overlay.onState((state) => {
  root.style.setProperty('--wake-progress', String(state.wakeProgress));
  if (state.phase === 'typing') showKeyboard(state);
  if (state.phase === 'icons') place(iconHighlight, state.highlight.rect);
  if (state.phase === 'choosing') {
    showKeys(`choosing ${state.intents.join('\n')}`, layoutIntents(screenSize, state.intents));
    highlightKey(state.highlight);
  }
  showStatus(state);
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
