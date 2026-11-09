import type { Sample } from '../gaze-check/score';
import { createTracker } from '../gaze-check/iris-tracker';
import { calibrate, CALIBRATION_DWELL_MS, SETTLE_MS, wait } from '../gaze-check/tracker';
import type { SessionInput } from '../shared/session';
import { createGazeSource } from './gaze-source';

const GET_IN_FRAME_MS = 5000;
const STALL_CHECK_MS = 100;
const STALL_MS = 500;

const root = document.documentElement;
const message = document.getElementById('gaze-message')!;
const faceRing = document.getElementById('face-ring')!;
const dot = document.getElementById('dot')!;

function placeDot(x: number, y: number) {
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
}

// A ring closes in on each calibration point while the dot glides there and records, to hold the eyes on it.
function placeCalibrationDot(x: number, y: number) {
  placeDot(x, y);
  dot.animate(
    [
      { transform: 'scale(4)', opacity: 0 },
      { transform: 'scale(4)', opacity: 0.9, offset: 0.2 },
      { transform: 'scale(1)', opacity: 1, offset: 0.85 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: SETTLE_MS + CALIBRATION_DWELL_MS, easing: 'ease-out', pseudoElement: '::after' },
  );
}

function showMessage(title: string, detail: string) {
  const heading = document.createElement('strong');
  heading.textContent = title;
  const line = document.createElement('span');
  line.textContent = detail;
  message.replaceChildren(heading, line);
  message.hidden = false;
}

export async function startCameraGaze(send: (input: SessionInput) => void) {
  // The dot goes where main put the gaze after Gaze Correction, so it sits where choices will land, not where the
  // tracker's raw estimate is. Calibration places the dot itself.
  window.overlay.onGazeDot((position) => {
    if (position && root.dataset.calibrating === undefined) placeDot(position.x, position.y);
  });
  let onSample: (sample: Sample) => void = () => {};
  let lastSampleAt = Date.now();
  const tracker = await createTracker((sample) => {
    lastSampleAt = sample.t;
    onSample(sample);
  });

  // Frames can stop without an error, for example on sleep, and a silent gap would count as part of a hold.
  setInterval(() => {
    const t = Date.now();
    if (t - lastSampleAt > STALL_MS) onSample({ t, estimate: null });
  }, STALL_CHECK_MS);

  // No click starts this, so the user gets a moment to get in frame before the dots begin. The ring round the preview
  // fills over that moment.
  const runCalibration = async () => {
    // Recalibrating counts as a Stop at once, including discarding typed text. Then null gaze, so calibrating can't
    // count towards a hold.
    send({ type: 'recalibrate', t: Date.now() });
    onSample = ({ t }) => send({ type: 'gaze', t, region: null });
    root.dataset.calibrating = 'face';
    dot.hidden = true;
    showMessage('Centre your face', 'Hold still. Blink 4 times quickly to start over.');
    tracker.showPreview();
    faceRing.animate([{ '--framed': 0 }, { '--framed': 1 }], { duration: GET_IN_FRAME_MS });
    await wait(GET_IN_FRAME_MS);
    tracker.hidePreview();
    message.hidden = true;
    root.dataset.calibrating = 'dots';
    dot.hidden = false;
    await calibrate(tracker, { width: window.innerWidth, height: window.innerHeight }, placeCalibrationDot);
    dot.hidden = true;
    root.dataset.calibrating = 'ready';
    showMessage("You're ready", 'Look at the circle to begin.');
    await wait(1100);
    message.hidden = true;
    delete root.dataset.calibrating;
    // Shown only while there is gaze. Where it goes comes from main, above.
    onSample = createGazeSource(send, runCalibration, (position) => (dot.hidden = !position));
  };
  await runCalibration();
}
