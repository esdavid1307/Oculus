// Gaze Correction: learns this user's tracking error from confirmed selections and shifts the Gaze Region to cancel it.
// Positions only, kept in memory. It starts again from nothing after every calibration.
import type { GazeRegion } from '../gaze';
import type { Position, Screen } from '../geometry';
import { createNet, forward, trainRegression, type Net } from './net';

// One confirmed selection: where the uncorrected gaze was, the centre of what the user chose, and how sure that is.
export type GazeExample = { gaze: Position; target: Position; weight: number };

export const MIN_EXAMPLES = 6;
// The newest selections are the ones most like now, and this keeps retraining under about 80 ms.
const MAX_EXAMPLES = 120;
// No learned shift moves the gaze further than this.
export const MAX_SHIFT_PX = 200;
const HIDDEN = 12;
const TRAINING = { epochs: 300, learningRate: 0.03, weightDecay: 0.01 };
// The newest examples are held out to check the net helps before it's used.
const HOLDOUT_SHARE = 0.25;
// It must cut the held-out error by at least this much, or the gaze is left alone.
const MIN_GAIN = 0.9;

export function createGazeCorrection(screen: Screen, seed = 11) {
  let examples: GazeExample[] = [];
  let net: Net | null = null;
  let validated = { before: 0, after: 0 };

  const toInput = ({ x, y }: Position) => [(x / screen.width) * 2 - 1, (y / screen.height) * 2 - 1];
  const shiftOf = (model: Net, at: Position) => {
    const [dx, dy] = forward(model, toInput(at)).output.map((n) => n * MAX_SHIFT_PX);
    const length = Math.hypot(dx, dy);
    const scale = length > MAX_SHIFT_PX ? MAX_SHIFT_PX / length : 1;
    return { x: dx * scale, y: dy * scale };
  };
  const fit = (batch: GazeExample[], from?: Net) => {
    // Warm-starting from the last fit halves the epochs needed: the weights are already near the data, so training
    // converges on the tail of the loss curve instead of from scratch each time.
    const model = from ? { w1: from.w1.map((row) => [...row]), b1: [...from.b1], w2: from.w2.map((row) => [...row]), b2: [...from.b2] } : createNet(2, HIDDEN, 2, seed);
    // Each example's gradient in trainRegression is divided by the batch total, so adding more examples silently
    // shrinks the per-example step. Scale the learning rate by sqrt(N / MIN_EXAMPLES) so the full ring trains with
    // enough step size to keep tracking a slowly drifting calibration, without overshooting on tiny batches.
    const learningRate = TRAINING.learningRate * Math.sqrt(batch.length / MIN_EXAMPLES);
    const epochs = from ? Math.round(TRAINING.epochs / 2) : TRAINING.epochs;
    trainRegression(
      model,
      batch.map(({ gaze }) => toInput(gaze)),
      batch.map(({ gaze, target }) => [(target.x - gaze.x) / MAX_SHIFT_PX, (target.y - gaze.y) / MAX_SHIFT_PX]),
      batch.map(({ weight }) => weight),
      { ...TRAINING, learningRate, epochs },
    );
    return model;
  };
  const meanError = (batch: GazeExample[], model: Net | null) =>
    batch.reduce((sum, { gaze, target }) => {
      const shift = model ? shiftOf(model, gaze) : { x: 0, y: 0 };
      return sum + Math.hypot(gaze.x + shift.x - target.x, gaze.y + shift.y - target.y);
    }, 0) / batch.length;

  function retrain() {
    const previous = net;
    net = null;
    if (examples.length < MIN_EXAMPLES) return;
    // Validated on the newest selections, the ones most like what comes next.
    const held = Math.max(2, Math.round(examples.length * HOLDOUT_SHARE));
    const training = examples.slice(0, -held);
    const holdout = examples.slice(-held);
    const before = meanError(holdout, null);
    // Warm-start from the previous fit so retraining after each new example converges in fewer epochs.
    const after = meanError(holdout, fit(training, previous ?? undefined));
    validated = { before, after };
    if (after < before * MIN_GAIN) net = fit(examples, previous ?? undefined);
  }

  return {
    correct(region: GazeRegion): GazeRegion {
      if (!net) return region;
      const shift = shiftOf(net, region);
      return { ...region, x: region.x + shift.x, y: region.y + shift.y };
    },
    learn(example: GazeExample) {
      examples = [...examples, example].slice(-MAX_EXAMPLES);
      retrain();
    },
    reset() {
      examples = [];
      net = null;
      validated = { before: 0, after: 0 };
    },
    stats: () => ({ examples: examples.length, active: net !== null, heldOutErrorPx: validated }),
  };
}

export type GazeCorrection = ReturnType<typeof createGazeCorrection>;
