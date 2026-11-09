import * as tf from '@tensorflow/tfjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GazeExample } from '../shared/gaze';
import { createGazeCorrection, MAX_SHIFT_PX, MIN_EXAMPLES } from './gaze-correction';

// Extra checks from the review of #29. Each test names the claim in docs/gaze-correction.md it checks.

const screen = { width: 1600, height: 1000 };
const region = (x: number, y: number, radius = 120) => ({ x, y, radius });

// Spread over the screen the way presses on a 3 x 3 keyboard would be.
const grid = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: ((i * 97) % 1400) + 100, y: ((i * 61) % 800) + 100 }));
const withError = (targets: { x: number; y: number }[], dx: number, dy: number): GazeExample[] =>
  targets.map((target) => ({ gaze: { x: target.x + dx, y: target.y + dy }, target }));

afterEach(() => vi.restoreAllMocks());

describe('Gaze Correction: when it starts', () => {
  it(`starts at exactly ${MIN_EXAMPLES} examples, counting across several learn calls`, async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    const examples = withError(grid(MIN_EXAMPLES), -80, 40);
    await correction.learn(examples.slice(0, 3));
    await correction.learn(examples.slice(3, MIN_EXAMPLES - 1));
    expect(correction.exampleCount).toBe(MIN_EXAMPLES - 1);
    expect(correction.active).toBe(false);
    await correction.learn(examples.slice(MIN_EXAMPLES - 1));
    expect(correction.exampleCount).toBe(MIN_EXAMPLES);
    expect(correction.active).toBe(true);
  });

  it('ignores an empty learn call', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn([]);
    expect(correction.exampleCount).toBe(0);
  });

  it('keeps only the last 400 examples', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(450), 0, 0));
    expect(correction.exampleCount).toBe(400);
  }, 30_000);
});

describe('Gaze Correction: what it learns', () => {
  it('learns close to no shift when the tracker is already right', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(40), 0, 0));
    const { x, y } = correction.correct(region(700, 300));
    expect(Math.abs(x - 700)).toBeLessThan(5);
    expect(Math.abs(y - 300)).toBeLessThan(5);
  });

  it('learns errors in every direction', async () => {
    for (const [dx, dy] of [
      [100, 0],
      [-100, 0],
      [0, 100],
      [0, -100],
      [70, -70],
    ]) {
      const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
      await correction.learn(withError(grid(60), dx, dy));
      const { x, y } = correction.correct(region(800 + dx, 500 + dy));
      expect(Math.abs(x - 800), `x for (${dx}, ${dy})`).toBeLessThan(15);
      expect(Math.abs(y - 500), `y for (${dx}, ${dy})`).toBeLessThan(15);
    }
  }, 30_000);

  it('caps the shift on both axes and in both directions', async () => {
    for (const [dx, dy] of [
      [600, 600],
      [-600, -600],
    ]) {
      const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
      await correction.learn(withError(grid(30), dx, dy));
      for (const [x, y] of [
        [800, 500],
        [0, 0],
        [1600, 1000],
        [-500, 2000],
      ]) {
        const corrected = correction.correct(region(x, y));
        expect(Math.abs(corrected.x - x)).toBeLessThanOrEqual(MAX_SHIFT_PX);
        expect(Math.abs(corrected.y - y)).toBeLessThanOrEqual(MAX_SHIFT_PX);
      }
    }
  }, 30_000);

  it('gives the same correction for the same examples and seed', async () => {
    const a = createGazeCorrection({ screen, enabled: true, seed: 7 });
    const b = createGazeCorrection({ screen, enabled: true, seed: 7 });
    await a.learn(withError(grid(20), -60, 30));
    await b.learn(withError(grid(20), -60, 30));
    expect(a.correct(region(400, 400))).toEqual(b.correct(region(400, 400)));
  });

  it('keeps the radius and does not change the region passed in', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(20), -80, 40));
    const input = region(620, 340, 77);
    const copy = { ...input };
    const corrected = correction.correct(input);
    expect(input).toEqual(copy);
    expect(corrected.radius).toBe(77);
    expect(corrected).not.toBe(input);
  });

  it('gives finite numbers for gaze far off the screen', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(20), -80, 40));
    for (const [x, y] of [
      [-10_000, -10_000],
      [1e6, 1e6],
      [0, 0],
    ]) {
      const corrected = correction.correct(region(x, y));
      expect(Number.isFinite(corrected.x) && Number.isFinite(corrected.y)).toBe(true);
    }
  });

  it('follows the user: the newest examples win once old ones drop out', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(400), 100, 0));
    await correction.learn(withError(grid(400), -100, 0));
    expect(correction.correct(region(700, 500)).x).toBeGreaterThan(780);
  }, 30_000);
});

describe('Gaze Correction: reset and training order', () => {
  it('learns again after a reset, from the new examples only', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(30), 100, 0));
    correction.reset();
    await correction.learn(withError(grid(30), -100, 0));
    expect(correction.exampleCount).toBe(30);
    expect(correction.correct(region(700, 500)).x).toBeGreaterThan(780);
  });

  it('a reset while training, then new examples: only the new training lands', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    const stale = correction.learn(withError(grid(30), 100, 0));
    correction.reset();
    const fresh = correction.learn(withError(grid(30), -100, 0));
    await Promise.all([stale, fresh]);
    expect(correction.correct(region(700, 500)).x).toBeGreaterThan(780);
  });

  it('two learn calls in a row: the second, trained on both, is the one kept', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    const first = correction.learn(withError(grid(10), 100, 0));
    const second = correction.learn(withError(grid(10), 100, 0));
    await first;
    await second;
    expect(correction.exampleCount).toBe(20);
    expect(correction.active).toBe(true);
  });

  it('a failed fit keeps the last good model, and the next training still runs', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(20), -80, 40));
    const before = correction.correct(region(700, 300));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fit = vi.spyOn(tf.LayersModel.prototype, 'fit').mockRejectedValueOnce(new Error('boom'));
    await correction.learn(withError(grid(1), -80, 40));
    expect(error).toHaveBeenCalledWith('Gaze Correction could not train:', expect.any(Error));
    expect(correction.correct(region(700, 300))).toEqual(before);
    fit.mockRestore();
    await correction.learn(withError(grid(20), 80, -40));
    expect(correction.correct(region(700, 300)).x).toBeLessThan(before.x);
  });

  it('reset before any training is safe and leaves it off', () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    correction.reset();
    correction.reset();
    expect(correction.active).toBe(false);
  });
});

describe('Gaze Correction: off switch', () => {
  it('stays off after many learn calls and resets', async () => {
    const correction = createGazeCorrection({ screen, enabled: false, seed: 1 });
    for (let i = 0; i < 5; i++) await correction.learn(withError(grid(20), -80, 40));
    correction.reset();
    expect(correction.active).toBe(false);
    expect(correction.correct(region(1, 2, 3))).toEqual(region(1, 2, 3));
  });

  it('creates no tensors when switched off', async () => {
    const before = tf.memory().numTensors;
    const correction = createGazeCorrection({ screen, enabled: false, seed: 1 });
    await correction.learn(withError(grid(20), -80, 40));
    correction.correct(region(500, 500));
    expect(tf.memory().numTensors).toBe(before);
  });
});

describe('Gaze Correction: memory and speed (non-functional)', () => {
  it('does not leak tensors when correcting', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(20), -80, 40));
    const before = tf.memory().numTensors;
    for (let i = 0; i < 2000; i++) correction.correct(region(i % 1600, i % 1000));
    expect(tf.memory().numTensors).toBe(before);
  });

  // Review finding 3: each retrain leaves its Adam optimizer's tensors behind, even after reset.
  it('does not leak tensors across retrains and reset', async () => {
    const start = tf.memory().numTensors;
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(10), -80, 40));
    const afterFirst = tf.memory().numTensors;
    for (let i = 0; i < 10; i++) await correction.learn(withError(grid(1), -80, 40));
    expect(tf.memory().numTensors).toBe(afterFirst);
    correction.reset();
    expect(tf.memory().numTensors).toBe(start);
  });

  it('corrects one Gaze Region in well under a frame (30 fps is 33 ms)', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(withError(grid(20), -80, 40));
    const start = performance.now();
    for (let i = 0; i < 1000; i++) correction.correct(region(500, 500));
    expect((performance.now() - start) / 1000).toBeLessThan(1);
  });

  it('trains on the full 400 examples in under a second', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    const start = performance.now();
    await correction.learn(withError(grid(400), -80, 40));
    expect(performance.now() - start).toBeLessThan(1000);
  }, 30_000);

  // Review finding 8: training runs on the main process, which also runs the session ticks and the mouse input.
  it('never blocks the main process for more than 100 ms while training on 400 examples', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    let last = performance.now();
    let worst = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
    }, 1);
    await correction.learn(withError(grid(400), -80, 40));
    clearInterval(timer);
    expect(worst).toBeLessThan(100);
  }, 30_000);
});
