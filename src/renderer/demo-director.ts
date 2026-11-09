import type { FixedIntent } from '../shared/keyboard';
import type { OverlayState } from '../shared/session';

declare global {
  interface Window {
    __push?: (state: OverlayState) => void;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const root = document.documentElement;
const message = document.getElementById('gaze-message')!;
const dot = document.getElementById('dot')!;
const faceRing = document.getElementById('face-ring')!;

function push(state: OverlayState) {
  window.__push!(state);
}

function say(title: string, detail: string) {
  const heading = document.createElement('strong');
  heading.textContent = title;
  const line = document.createElement('span');
  line.textContent = detail;
  message.replaceChildren(heading, line);
  message.hidden = false;
}

function placeDot(x: number, y: number) {
  dot.hidden = false;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
}

function hideDot() {
  dot.hidden = true;
}

function tile(label: string) {
  const rect = document.querySelector<HTMLElement>(`[data-label="${label}"]`)!.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

const past = ['Open this video', 'Skip the ad'];
const intents = [...past, 'Turn on captions', 'Save for later', 'Share this video'];

async function wake() {
  const steps = 28;
  for (let i = 1; i <= steps; i++) {
    push({ phase: 'idle', wakeProgress: i / steps });
    await sleep(70);
  }
}

async function play() {
  while (!window.__push) await sleep(16);
  push({ phase: 'idle', wakeProgress: 0 });

  faceRing.animate([{ '--framed': 0 }, { '--framed': 1 }], { duration: 2800, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' });
  await sleep(3000);

  message.hidden = true;
  root.dataset.calibrating = 'dots';
  const points = [
    [0.18, 0.72],
    [0.5, 0.5],
    [0.82, 0.62],
    [0.5, 0.34],
  ];
  for (const [x, y] of points) {
    placeDot(x * innerWidth, y * innerHeight);
    await sleep(1100);
  }

  hideDot();
  root.dataset.calibrating = 'ready';
  say("You're ready", 'Look at the circle to begin.');
  await sleep(1600);

  message.hidden = true;
  delete root.dataset.calibrating;
  push({ phase: 'idle', wakeProgress: 0 });
  await sleep(1400);
  await wake();
  await sleep(350);

  push({ phase: 'waiting-for-target', wakeProgress: 1 });
  const hero = document.getElementById('hero')!.getBoundingClientRect();
  dot.style.transition = 'left 1.5s cubic-bezier(0.32, 0.72, 0, 1), top 1.5s cubic-bezier(0.32, 0.72, 0, 1)';
  placeDot(innerWidth / 2, innerHeight / 2);
  await sleep(200);
  placeDot(hero.x + hero.width / 2, hero.y + hero.height / 2);
  await sleep(1900);
  dot.style.transition = '';

  push({ phase: 'thinking', wakeProgress: 1 });
  await sleep(2200);

  const fixed: FixedIntent[] = ['close', 'quit', 'minimize', 'type', 'search', 'dock', 'chrome'];
  const picker = { phase: 'choosing' as const, wakeProgress: 1, fixed, app: 'Google Chrome', fixedAt: past.length, cells: 12, recent: past.length, side: 'right' as const, stepProgress: 0 };
  push({ ...picker, intents: past, highlight: 'intent-0', suggesting: true });
  push({ ...picker, intents, highlight: 'intent-0', suggesting: false });
  await sleep(950);
  for (const highlight of ['intent-1', 'close', 'quit', 'minimize', 'type', 'search', 'dock', 'chrome', 'intent-2', 'intent-0']) {
    push({ ...picker, intents, highlight, suggesting: false });
    await sleep(850);
  }

  const typing = {
    phase: 'typing' as const,
    wakeProgress: 1,
    text: 'I woul',
    group: null,
    suggestions: ['water', 'help', 'rest'],
    phrases: ['I would like some water please'],
    stepMs: 1000,
  };
  push({ ...typing, highlight: 'phrase:I would like some water please' });
  await sleep(1100);
  push({ ...typing, highlight: 'word:water' });
  await sleep(900);
  push({ ...typing, highlight: 'abcde' });
  await sleep(900);
  push({ phase: 'typing', wakeProgress: 1, text: 'I woul', group: 'abcde', highlight: 'c', suggestions: [], phrases: [], stepMs: 1000 });
  await sleep(1000);
  push({ phase: 'typing', wakeProgress: 1, text: 'I would like some water', group: null, highlight: 'done', suggestions: [], phrases: [], stepMs: 1000 });
  await sleep(1400);

  push({ phase: 'running', wakeProgress: 1, intent: 'Open this video', activity: 'Clicking' });
  await sleep(2300);
  push({ phase: 'finished', wakeProgress: 1, intent: 'Open this video', ok: true, summary: 'Opened the video you were looking at.' });
  await sleep(2400);

  push({ phase: 'icons', wakeProgress: 1, source: 'dock', highlight: { name: 'Safari', label: 'Safari', rect: tile('Safari') }, stepMs: 1400 });
  await sleep(1400);
  push({ phase: 'icons', wakeProgress: 1, source: 'dock', highlight: { name: 'Notes', label: 'Notes', rect: tile('Notes') }, stepMs: 1400 });
  await sleep(1400);

  hideDot();
  for (const stopInMs of [3000, 2000, 1000]) {
    push({ phase: 'waiting-for-target', wakeProgress: 1, stopInMs });
    await sleep(750);
  }

  push({ phase: 'idle', wakeProgress: 0 });
  await sleep(1800);
  root.dataset.demo = 'done';
}

void play();
