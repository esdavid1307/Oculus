import type { Sample } from '../gaze-check/score';
import { createTracker } from '../gaze-check/iris-tracker';
import { calibrate, wait } from '../gaze-check/tracker';
import type { GazeEvent } from '../shared/gaze';
import { createGazeSource } from './gaze-source';

const GET_IN_FRAME_MS = 5000;
const STALL_CHECK_MS = 100;
const STALL_MS = 500;

const root = document.documentElement;
const message = document.getElementById('gaze-message')!;
const dot = document.getElementById('dot')!;

function placeDot(x: number, y: number) {
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
}

type Overlay = {
  sendGaze(event: GazeEvent): void;
  sendRecalibrated(): void;
  onGazeDot(listener: (position: { x: number; y: number } | null) => void): void;
};

export async function startCameraGaze({ sendGaze: send, sendRecalibrated, onGazeDot }: Overlay) {
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

  // The main process sends the dot back with Gaze Correction applied. The calibration dot is placed here instead.
  onGazeDot((position) => {
    if (root.dataset.calibrating !== undefined) return;
    dot.hidden = !position;
    if (position) placeDot(position.x, position.y);
  });

  // No click starts this, so the user gets a moment to get in frame before the dots begin.
  const runCalibration = async () => {
    // Every calibration, the first included, starts Gaze Correction from nothing.
    sendRecalibrated();
    // Null, so calibrating can't count towards a hold, and it stops the agent as a Look Away.
    onSample = ({ t }) => send({ type: 'gaze', t, region: null });
    root.dataset.calibrating = '';
    dot.hidden = true;
    message.textContent = 'Centre your face in the preview, then follow the dot with your eyes. Afterwards, blink 4 times quickly to recalibrate.';
    message.hidden = false;
    tracker.showPreview();
    await wait(GET_IN_FRAME_MS);
    tracker.hidePreview();
    message.hidden = true;
    dot.hidden = false;
    await calibrate(tracker, { width: window.innerWidth, height: window.innerHeight }, placeDot);
    dot.hidden = true;
    delete root.dataset.calibrating;
    onSample = createGazeSource(send, runCalibration, () => {});
  };
  await runCalibration();
}
