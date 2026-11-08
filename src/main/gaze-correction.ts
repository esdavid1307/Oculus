import * as tf from '@tensorflow/tfjs';
import type { GazeExample, GazeRegion } from '../shared/gaze';
import type { Screen } from '../shared/geometry';

// Below this, a few slips would decide the whole correction.
export const MIN_EXAMPLES = 8;
// Old selections drop out, so the correction follows the user as they shift in their seat.
const MAX_EXAMPLES = 400;
// The output is tanh, so no learned shift can move the gaze further than this on either axis.
export const MAX_SHIFT_PX = 150;
const HIDDEN_UNITS = 16;
const EPOCHS = 200;
const LEARNING_RATE = 0.02;

export type GazeCorrection = {
  correct(region: GazeRegion): GazeRegion;
  // Resolves once the network has been retrained on every example so far.
  learn(examples: GazeExample[]): Promise<void>;
  reset(): void;
  readonly exampleCount: number;
  readonly active: boolean;
};

// Learns this user's tracking error: screen position in, the shift that lands the gaze on what they chose out.
// Positions only, kept in memory. No video, and nothing leaves the machine.
export function createGazeCorrection({ screen, enabled, seed }: { screen: Screen; enabled: boolean; seed?: number }): GazeCorrection {
  let examples: GazeExample[] = [];
  let model: tf.Sequential | null = null;
  // A reset bumps this, so training that finishes after it is thrown away.
  let generation = 0;
  let training = Promise.resolve();

  const toInput = ({ x, y }: { x: number; y: number }) => [(x / screen.width) * 2 - 1, (y / screen.height) * 2 - 1];

  function build() {
    const next = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [2], units: HIDDEN_UNITS, activation: 'tanh', kernelInitializer: tf.initializers.glorotUniform({ seed }) }),
        // Zero weights start the correction at no shift.
        tf.layers.dense({ units: 2, activation: 'tanh', kernelInitializer: 'zeros' }),
      ],
    });
    next.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'meanSquaredError' });
    return next;
  }

  // Retrains from scratch on every example, which takes milliseconds at this size and can't drift.
  async function train(batch: GazeExample[], forGeneration: number) {
    const next = build();
    const inputs = tf.tensor2d(batch.map(({ gaze }) => toInput(gaze)));
    const shifts = tf.tensor2d(batch.map(({ gaze, target }) => [(target.x - gaze.x) / MAX_SHIFT_PX, (target.y - gaze.y) / MAX_SHIFT_PX]));
    try {
      await next.fit(inputs, shifts, { epochs: EPOCHS, batchSize: batch.length, shuffle: false, verbose: 0 });
    } finally {
      inputs.dispose();
      shifts.dispose();
    }
    if (forGeneration !== generation) {
      next.dispose();
      return;
    }
    model?.dispose();
    model = next;
  }

  return {
    correct(region) {
      if (!enabled || !model) return region;
      const current = model;
      const [dx, dy] = tf.tidy(() => (current.predict(tf.tensor2d([toInput(region)])) as tf.Tensor).dataSync());
      return { ...region, x: region.x + dx * MAX_SHIFT_PX, y: region.y + dy * MAX_SHIFT_PX };
    },
    learn(added) {
      if (!enabled || added.length === 0) return training;
      examples = [...examples, ...added].slice(-MAX_EXAMPLES);
      if (examples.length < MIN_EXAMPLES) return training;
      const batch = examples;
      const forGeneration = generation;
      // A failed fit keeps the last good model, and the next one still runs.
      training = training.then(() => train(batch, forGeneration)).catch((error) => console.error('Gaze Correction could not train:', error));
      return training;
    },
    reset() {
      generation += 1;
      examples = [];
      model?.dispose();
      model = null;
    },
    get exampleCount() {
      return examples.length;
    },
    get active() {
      return enabled && model !== null;
    },
  };
}
