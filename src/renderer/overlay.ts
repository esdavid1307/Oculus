import type { Rect } from '../shared/geometry';
import { layoutKeyboard } from '../shared/keyboard';
import { CORNER_TARGET_SIZE, type OverlayState } from '../shared/session';

declare global {
  interface Window {
    overlay: { onState(listener: (state: OverlayState) => void): void };
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
const wakeLabel = document.getElementById('wake-label')!;
const keyboard = document.getElementById('keyboard')!;
const typed = document.getElementById('typed')!;
root.style.setProperty('--target-size', `${CORNER_TARGET_SIZE}px`);

function place(element: HTMLElement, { x, y, width, height }: Rect) {
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
}

// The overlay covers the primary display, so this is the same layout the session core hit-tests against.
const layout = layoutKeyboard({ width: innerWidth, height: innerHeight });
place(typed, layout.text);
const keyElements = new Map(
  layout.keys.map(({ id, label, rect }) => {
    const element = document.createElement('div');
    element.className = 'key';
    element.dataset.key = id;
    element.textContent = label;
    place(element, rect);
    keyboard.append(element);
    return [id, element];
  }),
);

let lastPhase: OverlayState['phase'] = 'idle';
let litKey: HTMLElement | undefined;

function showKeyboard(text: string, dwell: Extract<OverlayState, { phase: 'typing' }>['dwell']) {
  if (typed.textContent !== text) {
    typed.textContent = text;
    typed.scrollLeft = typed.scrollWidth;
  }
  const element = dwell ? keyElements.get(dwell.key) : undefined;
  if (litKey !== element) litKey?.style.removeProperty('--dwell');
  element?.style.setProperty('--dwell', String(dwell!.progress));
  litKey = element;
}

window.overlay.onState((state) => {
  root.style.setProperty('--wake-progress', String(state.wakeProgress));
  if (state.phase === 'typing') showKeyboard(state.text, state.dwell);
  if (state.phase === lastPhase) return;
  if (state.phase === 'waiting-for-target') chime();
  root.dataset.phase = state.phase;
  wakeLabel.textContent = state.phase === 'waiting-for-target' ? 'Listening' : 'Wake';
  lastPhase = state.phase;
});
