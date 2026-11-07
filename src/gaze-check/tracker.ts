import type { Sample, Screen } from './score';

export const CALIBRATION_DWELL_MS = 900;
export const SETTLE_MS = 800;

export type Tracker = {
  name: string;
  hidePreview(): void;
  showPreview(): void;
  calibrateAt(x: number, y: number): Promise<void>;
  finishCalibration(): void;
  stop(): void;
};

export type CreateTracker = (onSample: (sample: Sample) => void) => Promise<Tracker>;

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Dwell, not clicks: the real user can't click, and a click pulls the eyes to the cursor.
export async function calibrate(tracker: Tracker, { width, height }: Screen, placeDot: (x: number, y: number) => void) {
  const outer = [0.03, 0.5, 0.97].flatMap((x) => [0.03, 0.5, 0.97].map((y) => [x, y]));
  const inner = [0.25, 0.75].flatMap((x) => [0.25, 0.75].map((y) => [x, y]));
  for (const [fx, fy] of [...outer, ...inner]) {
    const [x, y] = [fx * width, fy * height];
    placeDot(x, y);
    await wait(SETTLE_MS);
    await tracker.calibrateAt(x, y);
  }
  tracker.finishCalibration();
}
