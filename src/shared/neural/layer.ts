// The Neural Layer: one place every confirmed choice goes to teach Oculus about this user. Pure, so the session core
// and the evaluation can drive it without Electron. See docs/neural-layer.md.
//
// Suggested Words and Intent History learn in their own modules (src/shared/predict.ts, intent-history.ts) and are
// reported alongside; this layer adds Gaze Correction, Icon Order and Scan Pace.
import type { GazeRegion } from '../gaze';
import type { Position, Screen } from '../geometry';
import { createGazeCorrection, type GazeExample } from './gaze-correction';
import { createIconOrder, emptyIconOrder, readIconOrder, type IconOrderModel } from './icon-order';
import { createScanPace, emptyScanPace, readScanPace, type ScanPaceModel } from './scan-pace';

// What the session reports when the user confirms something.
export type LearningSignal =
  // A Select Blink during a scan. offsetMs is how long the chosen key had been highlighted, and undoes is true for a
  // press that takes the one before back, which then landed late.
  | { kind: 'select'; offsetMs: number; stepMs: number; undoes: boolean }
  // An icon opened from an Icon Scan. scanned is every icon of that scan, in screen order.
  | { kind: 'icon-opened'; source: string; scanned: string[]; chosen: string }
  // The user looked at target over this time and the choice was confirmed. The outside world fills in where the
  // uncorrected gaze was, since the session only sees corrected gaze.
  | { kind: 'gaze'; from: number; to: number; target: Position; weight: number };

export type NeuralLayerModel = { version: 1; icons: IconOrderModel; pace: ScanPaceModel };

export const emptyNeuralLayer = (): NeuralLayerModel => ({ version: 1, icons: emptyIconOrder(), pace: emptyScanPace() });

export function readNeuralLayer(raw: unknown): NeuralLayerModel {
  const model = raw as Partial<NeuralLayerModel> | null | undefined;
  if (model?.version !== 1) return emptyNeuralLayer();
  return { version: 1, icons: readIconOrder(model.icons), pace: readScanPace(model.pace) };
}

export function createNeuralLayer({ screen, scanStepMs, model = emptyNeuralLayer() }: { screen: Screen; scanStepMs: number; model?: NeuralLayerModel }) {
  const gaze = createGazeCorrection(screen);
  const icons = createIconOrder(model.icons);
  const pace = createScanPace(scanStepMs, model.pace);

  return {
    correct: (region: GazeRegion) => gaze.correct(region),
    orderIcons: (source: string, names: string[], now?: number) => icons.order(source, names, now),
    scanStepMs: () => pace.stepMs(),
    // rawGaze is where the uncorrected gaze was over a gaze signal's time, or null if it wasn't tracked then.
    learn(signal: LearningSignal, rawGaze: (from: number, to: number) => Position | null = () => null, now = Date.now()) {
      if (signal.kind === 'select') pace.select(signal.offsetMs, signal.stepMs, signal.undoes);
      else if (signal.kind === 'icon-opened') icons.learn(signal.source, signal.scanned, signal.chosen, now);
      else {
        const at = rawGaze(signal.from, signal.to);
        if (at) gaze.learn({ gaze: at, target: signal.target, weight: signal.weight } satisfies GazeExample);
      }
    },
    // A new calibration makes the old tracking error meaningless. Icon Order and Scan Pace are about the user, not
    // the calibration, so they stay.
    recalibrated: () => gaze.reset(),
    model: (): NeuralLayerModel => ({ version: 1, icons: icons.model(), pace: pace.model() }),
    stats: () => ({ gaze: gaze.stats(), scanStepMs: pace.stepMs(), paceSamples: pace.model().reactions.length }),
  };
}

export type NeuralLayer = ReturnType<typeof createNeuralLayer>;
