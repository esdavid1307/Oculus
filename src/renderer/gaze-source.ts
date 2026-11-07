import { blinkCounter } from '../gaze-check/free-look';
import { smoother, type Sample } from '../gaze-check/score';
import type { GazeEvent } from '../shared/gaze';

// Around the 66 to 154 px median error of the MediaPipe runs for #5, so the region covers where the user is probably looking.
export const GAZE_REGION_RADIUS = 120;

export function createGazeSource(send: (event: GazeEvent) => void, onRecalibrate: () => void) {
  const smooth = smoother();
  const blinked = blinkCounter();
  return (sample: Sample) => {
    // Handled here so that blinks stay out of the GazeEvent format.
    if (blinked(sample.t, !!sample.eyesClosed)) onRecalibrate();
    const { t, estimate } = smooth(sample);
    send({ type: 'gaze', t, region: estimate && { ...estimate, radius: GAZE_REGION_RADIUS } });
  };
}
