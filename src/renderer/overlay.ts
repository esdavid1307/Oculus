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
root.style.setProperty('--target-size', `${CORNER_TARGET_SIZE}px`);

let lastPhase: OverlayState['phase'] = 'idle';

window.overlay.onState(({ phase, wakeProgress }) => {
  root.style.setProperty('--wake-progress', String(wakeProgress));
  if (phase === lastPhase) return;
  if (phase === 'waiting-for-target') chime();
  root.dataset.phase = phase;
  wakeLabel.textContent = phase === 'idle' ? 'Wake' : 'Listening';
  lastPhase = phase;
});
