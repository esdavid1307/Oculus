import type { Sample } from './score';

export const CALIBRATION_DWELL_MS = 900;

export type Tracker = {
  name: string;
  hidePreview(): void;
  showPreview(): void;
  calibrateAt(x: number, y: number): Promise<void>;
  finishCalibration(): void;
  stop(): void;
};

export type CreateTracker = (onSample: (sample: Sample) => void) => Promise<Tracker>;
