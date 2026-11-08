import { blinkCounter, holdTimer } from '../gaze-check/free-look';
import { smoother, type Sample } from '../gaze-check/score';
import type { SessionInput } from '../shared/session';

// Around the 66 to 154 px median error of the MediaPipe runs for #5, so the region covers where the user is probably looking.
export const GAZE_REGION_RADIUS = 120;

// Natural blinks take about 100 to 300 ms, so they never reach this.
const SELECT_BLINK_MS = 500;

export function createGazeSource(
  send: (input: SessionInput) => void,
  onRecalibrate: () => void,
  onDot: (position: Sample['estimate']) => void,
) {
  const smooth = smoother();
  const blinked = blinkCounter();
  const closedLongEnough = holdTimer(SELECT_BLINK_MS);
  let selected = false;
  return (sample: Sample) => {
    // Handled here so that blinks stay out of the GazeEvent format.
    if (blinked(sample.t, !!sample.eyesClosed)) return onRecalibrate();
    // One select per closing of the eyes, however long they stay closed.
    if (!closedLongEnough(sample.t, !!sample.eyesClosed)) selected = false;
    else if (!selected) {
      selected = true;
      send({ type: 'select', t: sample.t });
    }
    const { t, estimate } = smooth(sample);
    onDot(estimate);
    send({ type: 'gaze', t, region: estimate && { ...estimate, radius: GAZE_REGION_RADIUS } });
  };
}
