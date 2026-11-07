import { CORNER_TARGET_SIZE } from '../shared/session';
import { blinkCounter, holdTimer } from './free-look';
import { KEYS_NEEDED, scoreGazeCheck, smoother, type Sample, type Screen, type Target, type Trial } from './score';
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
const heat = document.getElementById('heat') as HTMLCanvasElement;
const startBox = document.getElementById('start-box')!;

const HEAT_RADIUS = 60;
const START_HOLD_MS = 3000;
const OFF_SCREEN_STOP_MS = 5000;

const params = new URLSearchParams(location.search);
// The heat map is for testing. A real user only gets the dot, as their cursor.
const showHeat = params.get('view') === 'free';
const useFreeLook = showHeat || params.get('view') === 'cursor';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let recording: Sample[] | null = null;
let onGaze: ((sample: Sample) => void) | null = null;

function placeDot(x: number, y: number) {
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
}

async function showDot(x: number, y: number) {
  placeDot(x, y);
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

// Gaze only exists after calibration, so this gates the heat map, not the calibration.
function lookAtStartBox() {
  startBox.hidden = false;
  const { left, right, top, bottom } = startBox.getBoundingClientRect();
  const held = holdTimer(START_HOLD_MS);
  const blinked = blinkCounter();
  const smooth = smoother();
  return new Promise<'started' | 'recalibrate'>((resolve) => {
    onGaze = (sample) => {
      const { t, eyesClosed } = sample;
      // Also here, because a bad calibration can make the box impossible to reach.
      if (blinked(t, !!eyesClosed)) resolve('recalibrate');
      const { estimate: cursor } = smooth(sample);
      dot.hidden = !cursor;
      if (cursor) placeDot(cursor.x, cursor.y);
      const inside = !!cursor && cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;
      if (held(t, inside)) resolve('started');
    };
  });
}

// The dot is smoothed like a cursor. The heat map draws raw samples, to show exactly what the tracker outputs.
function paintHeat(context: CanvasRenderingContext2D, { width, height }: Screen) {
  const away = holdTimer(OFF_SCREEN_STOP_MS);
  const blinked = blinkCounter();
  const smooth = smoother();
  return new Promise<'recalibrate'>((resolve) => {
    onGaze = (sample) => {
      const { t, estimate, eyesClosed } = sample;
      if (blinked(t, !!eyesClosed)) resolve('recalibrate');
      const { estimate: cursor } = smooth(sample);
      dot.hidden = !cursor;
      if (cursor) placeDot(cursor.x, cursor.y);
      const onScreen = !!cursor && cursor.x >= 0 && cursor.x <= width && cursor.y >= 0 && cursor.y <= height;
      if (away(t, !onScreen)) {
        onGaze = null;
        // Leaving fullscreen is what ends the session, the same as pressing Esc.
        void document.exitFullscreen();
      }
      if (!estimate) return;
      const { x, y } = estimate;
      const spot = context.createRadialGradient(x, y, 0, x, y, HEAT_RADIUS);
      spot.addColorStop(0, 'rgba(255, 60, 0, 0.08)');
      spot.addColorStop(1, 'rgba(255, 60, 0, 0)');
      context.fillStyle = spot;
      context.fillRect(x - HEAT_RADIUS, y - HEAT_RADIUS, HEAT_RADIUS * 2, HEAT_RADIUS * 2);
    };
  });
}

async function freeLook(tracker: Tracker, screen: Screen) {
  // Made up front, so Esc during calibration still ends the session once calibration finishes.
  const exited = new Promise<'exited'>((resolve) => {
    document.addEventListener('fullscreenchange', () => resolve('exited'), { once: true });
  });
  heat.width = screen.width;
  heat.height = screen.height;
  const context = heat.getContext('2d')!;

  let outcome: 'exited' | 'started' | 'recalibrate';
  do {
    onGaze = null;
    tracker.hidePreview();
    heat.hidden = true;
    dot.hidden = false;
    await calibrate(tracker, screen);
    tracker.showPreview();
    // The old map came from the old calibration, so it can't be compared with the new one.
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, screen.width, screen.height);
    // Additive, so repeat visits build up from dim red to bright yellow.
    context.globalCompositeOperation = 'lighter';
    heat.hidden = !showHeat;

    outcome = await Promise.race([exited, lookAtStartBox()]);
    startBox.hidden = true;
    if (outcome === 'started') outcome = await Promise.race([exited, paintHeat(context, screen)]);
  } while (outcome === 'recalibrate');
  onGaze = null;
  dot.hidden = true;
}

async function run(tracker: Tracker) {
  await document.documentElement.requestFullscreen();
  await wait(SETTLE_MS);
  const screen = { width: window.innerWidth, height: window.innerHeight };

  tracker.hidePreview();
  panel.hidden = true;
  dot.hidden = false;
  if (useFreeLook) {
    await freeLook(tracker, screen);
    tracker.stop();
    status.textContent = 'Stopped. Reload to run again.';
    start.hidden = true;
    panel.hidden = showHeat;
    return;
  }
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

const useIris = params.get('tracker') === 'mediapipe';
// Imported on demand so only the chosen tracker ever opens the camera.
(useIris ? import('./iris-tracker') : import('./webgazer-tracker'))
  .then(({ createTracker }) =>
    createTracker((sample) => {
      recording?.push(sample);
      onGaze?.(sample);
    }),
  )
  .then((tracker) => {
    start.addEventListener('click', () => run(tracker));
    status.textContent = useFreeLook
      ? 'Centre your face in the box, then press Start. Follow the dot with your eyes for about 25 seconds, keeping your head still. Then look at the box for 3 seconds to start. Blink 4 times quickly to recalibrate. Press Esc or look off screen for 5 seconds to stop.'
      : 'Centre your face in the box, sit as you will for the demo, then press Start. Follow the dot with your eyes, keeping your head still. It takes about 90 seconds.';
    start.hidden = false;
  })
  .catch((error: Error) => {
    status.textContent = `Could not start the camera: ${error.message}`;
  });
