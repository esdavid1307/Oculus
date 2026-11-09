// The Neural Layer's networks: small dense nets in plain TypeScript, so they train on the device in milliseconds, run
// the same in tests, and need no native code. Deterministic for a given seed.
import { seededRandom } from '../predict';

// inputs -> tanh hidden layer -> linear outputs.
export type Net = { w1: number[][]; b1: number[]; w2: number[][]; b2: number[] };

export function createNet(inputs: number, hidden: number, outputs: number, seed: number): Net {
  const random = seededRandom(seed);
  const scale = Math.sqrt(6 / (inputs + hidden));
  return {
    w1: Array.from({ length: hidden }, () => Array.from({ length: inputs }, () => random() * 2 * scale)),
    b1: Array(hidden).fill(0),
    // Zero, so an untrained net outputs nothing and changes nothing.
    w2: Array.from({ length: outputs }, () => Array(hidden).fill(0)),
    b2: Array(outputs).fill(0),
  };
}

export function forward(net: Net, input: number[]) {
  const hidden = net.w1.map((row, j) => Math.tanh(row.reduce((sum, w, k) => sum + w * input[k], net.b1[j])));
  const output = net.w2.map((row, o) => row.reduce((sum, w, j) => sum + w * hidden[j], net.b2[o]));
  return { hidden, output };
}

export type TrainOptions = { epochs: number; learningRate: number; weightDecay: number };

// Full-batch Adam on weighted squared error. Weight decay keeps a net trained on a handful of examples smooth, so it
// generalises to the rest of the screen instead of memorising the points it saw.
export function trainRegression(net: Net, inputs: number[][], targets: number[][], weights: number[], options: TrainOptions) {
  const { epochs, learningRate, weightDecay } = options;
  const params = [net.w1, [net.b1], net.w2, [net.b2]].flat();
  const m = params.map((row) => row.map(() => 0));
  const v = params.map((row) => row.map(() => 0));
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  const hiddenCount = net.b1.length;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const gw1 = net.w1.map((row) => row.map(() => 0));
    const gb1 = net.b1.map(() => 0);
    const gw2 = net.w2.map((row) => row.map(() => 0));
    const gb2 = net.b2.map(() => 0);
    inputs.forEach((input, n) => {
      const { hidden, output } = forward(net, input);
      const weight = weights[n] / total;
      const back = Array(hiddenCount).fill(0);
      output.forEach((y, o) => {
        const error = 2 * weight * (y - targets[n][o]);
        gb2[o] += error;
        for (let j = 0; j < hiddenCount; j++) {
          gw2[o][j] += error * hidden[j];
          back[j] += error * net.w2[o][j];
        }
      });
      for (let j = 0; j < hiddenCount; j++) {
        const g = back[j] * (1 - hidden[j] ** 2);
        gb1[j] += g;
        for (let k = 0; k < input.length; k++) gw1[j][k] += g * input[k];
      }
    });
    // Biases aren't decayed: a steady shift is exactly what a calibration error often is.
    gw1.forEach((row, j) => row.forEach((_, k) => (row[k] += weightDecay * net.w1[j][k])));
    gw2.forEach((row, o) => row.forEach((_, j) => (row[j] += weightDecay * net.w2[o][j])));
    const grads = [gw1, [gb1], gw2, [gb2]].flat();
    params.forEach((row, p) =>
      row.forEach((_, i) => {
        m[p][i] = 0.9 * m[p][i] + 0.1 * grads[p][i];
        v[p][i] = 0.999 * v[p][i] + 0.001 * grads[p][i] ** 2;
        const mHat = m[p][i] / (1 - 0.9 ** epoch);
        const vHat = v[p][i] / (1 - 0.999 ** epoch);
        row[i] -= (learningRate * mHat) / (Math.sqrt(vHat) + 1e-8);
      }),
    );
  }
}

// Scores items from their features: a linear part that starts at a hand-set prior, plus a tanh hidden layer that
// starts silent and learns what the prior misses. Trained listwise, so each choice raises the chosen item's share.
export type Ranker = { linear: number[]; hidden: number[][]; hiddenBias: number[]; out: number[] };

export function createRanker(prior: number[], hidden: number, seed: number): Ranker {
  const random = seededRandom(seed);
  return {
    linear: [...prior],
    hidden: Array.from({ length: hidden }, () => prior.map(() => random() * 0.6)),
    hiddenBias: Array(hidden).fill(0),
    out: Array(hidden).fill(0),
  };
}

export function rankScore(ranker: Ranker, input: number[]) {
  const activations = ranker.hidden.map((row, j) => Math.tanh(row.reduce((sum, w, k) => sum + w * input[k], ranker.hiddenBias[j])));
  return {
    activations,
    value:
      ranker.linear.reduce((sum, w, k) => sum + w * input[k], 0) + ranker.out.reduce((sum, w, j) => sum + w * activations[j], 0),
  };
}

export type RankerTraining = { learningRate: number; steps: number; priorPull: number; prior: number[] };

export function trainRanker(ranker: Ranker, inputs: number[][], chosen: number, { learningRate, steps, priorPull, prior }: RankerTraining) {
  if (inputs.length < 2) return;
  for (let step = 0; step < steps; step++) {
    const scored = inputs.map((input) => rankScore(ranker, input));
    const top = Math.max(...scored.map(({ value }) => value));
    const exps = scored.map(({ value }) => Math.exp(value - top));
    const total = exps.reduce((sum, n) => sum + n, 0);
    inputs.forEach((input, i) => {
      const gradient = exps[i] / total - (i === chosen ? 1 : 0);
      const { activations } = scored[i];
      ranker.out.forEach((weight, j) => {
        const back = gradient * weight * (1 - activations[j] ** 2);
        ranker.out[j] -= learningRate * gradient * activations[j];
        ranker.hiddenBias[j] -= learningRate * back;
        input.forEach((value, k) => (ranker.hidden[j][k] -= learningRate * back * value));
      });
      input.forEach((value, k) => (ranker.linear[k] -= learningRate * gradient * value));
    });
    // Pulled gently back to the prior, so a few odd choices can't wreck the order.
    ranker.linear.forEach((weight, k) => (ranker.linear[k] -= priorPull * (weight - prior[k])));
  }
}

const finiteList = (list: unknown, length: number) =>
  Array.isArray(list) && list.length === length && list.every((n) => typeof n === 'number' && Number.isFinite(n));

// Saved weights come from disk, so anything malformed is replaced instead of breaking a feature.
export function readRanker(raw: unknown, fallback: Ranker): Ranker {
  const ranker = raw as Ranker | undefined;
  const ok =
    finiteList(ranker?.linear, fallback.linear.length) &&
    finiteList(ranker?.hiddenBias, fallback.hiddenBias.length) &&
    finiteList(ranker?.out, fallback.out.length) &&
    Array.isArray(ranker?.hidden) &&
    ranker!.hidden.length === fallback.hidden.length &&
    ranker!.hidden.every((row) => finiteList(row, fallback.linear.length));
  return ok ? ranker! : fallback;
}
