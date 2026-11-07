import { CORNER_TARGET_SIZE } from '../shared/session';
import { KEYS_NEEDED, scoreGazeCheck, type Sample, type Screen, type Target, type Trial } from './score';
import type { Tracker } from './tracker';

const SETTLE_MS = 800;
// Longer than the 2 second hold, so a slow start can still make it.
const TRIAL_MS = 3000;

const panel = document.getElementById('panel')!;
const status = document.getElementById('status')!;
const start = document.getElementById('start')!;
const copy = document.getElementById('copy')!;
const results = document.getElementById('results')!;
const dot = document.getElementById('dot')!;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let recording: Sample[] | null = null;

async function showDot(x: number, y: number) {
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  await wait(SETTLE_MS);
}

// Dwell, not clicks: the real user can't click, and a click pulls the eyes to the cursor.
async function calibrate(tracker: Tracker, { width, height }: Screen) {
  const outer = [0.03, 0.5, 0.97].flatMap((x) => [0.03, 0.5, 0.97].map((y) => [x, y]));
  const inner = [0.25, 0.75].flatMap((x) => [0.25, 0.75].map((y) => [x, y]));
  for (const [fx, fy] of [...outer, ...inner]) {
    const [x, y] = [fx * width, fy * height];
    await showDot(x, y);
    await tracker.calibrateAt(x, y);
  }
  tracker.finishCalibration();
}

// All but the centre differ from the calibration points, so this measures more than memorised positions.
function testTargets({ width, height }: Screen): Target[] {
  const centre = CORNER_TARGET_SIZE / 2;
  const wake: Target = { kind: 'wake', x: width - centre, y: centre };
  const stop: Target = { kind: 'stop', x: centre, y: height - centre };
  const keys = [0.2, 0.5, 0.8].flatMap((fx) =>
    [0.2, 0.5, 0.8].map((fy): Target => ({ kind: 'key', x: fx * width, y: fy * height })),
  );
  return [wake, ...keys.slice(0, 3), stop, ...keys.slice(3, 6), wake, ...keys.slice(6), stop, wake, stop];
}

async function runTrial(target: Target): Promise<Trial> {
  await showDot(target.x, target.y);
  const samples: Sample[] = [];
  recording = samples;
  await wait(TRIAL_MS);
  recording = null;
  return { target, samples };
}

function formatReport(report: ReturnType<typeof scoreGazeCheck>, trackerName: string, { width, height }: Screen) {
  const corner = (name: string, { hits, trials, targetSize }: typeof report.corners.wake) =>
    `- ${name} corner: ${hits}/${trials} holds of 2 s, smallest target ${Math.ceil(targetSize)} px (current: ${CORNER_TARGET_SIZE} px)`;
  const signed = (value: number) => `${value < 0 ? '' : '+'}${Math.round(value)}`;
  const offsets = report.targets.map(({ kind, x, y, offset }) => {
    const landed = offset ? `${signed(offset.x)}, ${signed(offset.y)}` : 'never tracked';
    return `  - ${kind} at ${Math.round(x)}, ${Math.round(y)}: ${landed}`;
  });
  return [
    `Gaze check with ${trackerName} on ${width} x ${height}, ${new Date().toISOString()}`,
    corner('Wake', report.corners.wake),
    corner('Stop', report.corners.stop),
    `- Smallest usable key: ${Math.ceil(report.keys.keySize)} px, ${report.keys.keysThatFit} fit on screen (${KEYS_NEEDED} needed)`,
    `- Smallest key if steady offset is removed: ${Math.ceil(report.keys.steadyKeySize)} px`,
    `- Median error: ${Math.round(report.keys.medianError)} px, jitter: ${Math.round(report.keys.jitter)} px`,
    `- Samples per second: ${report.samplesPerSecond.toFixed(1)}, lost: ${(report.lostShare * 100).toFixed(1)}%`,
    `- Suggested verdict: ${report.verdict}`,
    '- Mean offset per target, in px (x right, y down):',
    ...offsets,
  ].join('\n');
}

async function run(tracker: Tracker) {
  await document.documentElement.requestFullscreen();
  await wait(SETTLE_MS);
  const screen = { width: window.innerWidth, height: window.innerHeight };

  tracker.hidePreview();
  panel.hidden = true;
  dot.hidden = false;
  await calibrate(tracker, screen);
  const trials: Trial[] = [];
  for (const target of testTargets(screen)) trials.push(await runTrial(target));
  dot.hidden = true;
  panel.hidden = false;

  tracker.stop();
  results.textContent = formatReport(scoreGazeCheck(trials, screen), tracker.name, screen);
  // Esc may have left fullscreen already, and exiting again would reject.
  if (document.fullscreenElement) await document.exitFullscreen();
  status.textContent = 'Done. Reload to run again.';
  start.hidden = true;
  copy.hidden = false;
}

copy.addEventListener('click', () => navigator.clipboard.writeText(results.textContent!));

const useIris = new URLSearchParams(location.search).get('tracker') === 'mediapipe';
// Imported on demand so only the chosen tracker ever opens the camera.
(useIris ? import('./iris-tracker') : import('./webgazer-tracker'))
  .then(({ createTracker }) => createTracker((sample) => recording?.push(sample)))
  .then((tracker) => {
    start.addEventListener('click', () => run(tracker));
    status.textContent = 'Centre your face in the box, sit as you will for the demo, then press Start. Follow the dot with your eyes, keeping your head still. It takes about 90 seconds.';
    start.hidden = false;
  })
  .catch((error: Error) => {
    status.textContent = `Could not start the camera: ${error.message}`;
  });
