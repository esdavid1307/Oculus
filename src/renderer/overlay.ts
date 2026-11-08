import type { Rect } from '../shared/geometry';
import { layoutKeyboard } from '../shared/keyboard';
import type { OverlayState, SessionInput } from '../shared/session';

declare global {
  interface Window {
    overlay: { onState(listener: (state: OverlayState) => void): void; sendGaze(input: SessionInput): void };
  }
}

const audio = new AudioContext();

function chime() {
  [660, 880].forEach((frequency, i) => {
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

function place(element: HTMLElement, { x, y, width, height }: Rect) {
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
}

// The overlay covers the primary display, so this is the same layout the session core hit-tests against.
const screenSize = { width: innerWidth, height: innerHeight };
place(typed, layoutKeyboard(screenSize, null).text);

let shownKeys: string | undefined;
let keyElements = new Map<string, HTMLElement>();

function showKeys(group: string | null, suggestions: string[]) {
  keyElements.forEach((element) => element.remove());
  keyElements = new Map(
    layoutKeyboard(screenSize, group, suggestions).keys.map(({ id, label, rect }) => {
      const element = document.createElement('div');
      element.className = 'key';
      element.dataset.key = id;
      element.textContent = label;
      place(element, rect);
      keyboard.append(element);
      return [id, element];
    }),
  );
  shownKeys = JSON.stringify([group, suggestions]);
}

let lastPhase: OverlayState['phase'] = 'idle';
let litKey: HTMLElement | undefined;

function showKeyboard({ text, group, highlight, suggestions }: Extract<OverlayState, { phase: 'typing' }>) {
  if (typed.textContent !== text) {
    typed.textContent = text;
    typed.scrollLeft = typed.scrollWidth;
  }
  if (JSON.stringify([group, suggestions]) !== shownKeys) showKeys(group, suggestions);
  litKey?.classList.remove('highlighted');
  litKey = keyElements.get(highlight);
  litKey?.classList.add('highlighted');
}

window.overlay.onState((state) => {
  root.style.setProperty('--wake-progress', String(state.wakeProgress));
  if (state.phase === 'typing') showKeyboard(state);
  if (state.phase === lastPhase) return;
  if (state.phase === 'waiting-for-target') chime();
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
