import { describe, expect, it } from 'vitest';
import { scoreGazeCheck, type Sample, type Trial } from './score';

const screen = { width: 1600, height: 1000 };
const wake = { kind: 'wake', x: 1480, y: 120 } as const;

// One sample every 100 ms, the first at t = 0.
const samples = (points: (Sample['point'])[]): Sample[] => points.map((point, i) => ({ t: i * 100, point }));
const repeat = (point: Sample['point'], count: number) => Array<Sample['point']>(count).fill(point);

describe('corner targets', () => {
  it('counts a trial as a hit when the gaze holds the target for 2 seconds', () => {
    const trial: Trial = { target: wake, samples: samples(repeat({ x: 1480, y: 120 }, 21)) };
    expect(scoreGazeCheck([trial], screen).corners.wake).toMatchObject({ hits: 1, trials: 1 });
  });

  it('restarts the hold when tracking is lost', () => {
    const on = { x: 1480, y: 120 };
    const trial: Trial = { target: wake, samples: samples([...repeat(on, 15), null, ...repeat(on, 15)]) };
    expect(scoreGazeCheck([trial], screen).corners.wake.hits).toBe(0);
  });

  it('smooths the gaze, as a real gaze source must, so one stray sample does not restart the hold', () => {
    const on = { x: 1480, y: 120 };
    const trial: Trial = { target: wake, samples: samples([...repeat(on, 15), { x: 1480, y: 500 }, ...repeat(on, 15)]) };
    expect(scoreGazeCheck([trial], screen).corners.wake.hits).toBe(1);
  });

  it('reports the smallest target that holds 95% of the gaze, measured from the corner', () => {
    const near = repeat({ x: 1400, y: 150 }, 19);
    const trial: Trial = { target: wake, samples: samples([...near, { x: 1300, y: 150 }]) };
    expect(scoreGazeCheck([trial], screen).corners.wake.targetSize).toBe(200);
  });

  it('scores the stop target from the bottom-left corner', () => {
    const stop = { kind: 'stop', x: 120, y: 880 } as const;
    const trial: Trial = { target: stop, samples: samples(repeat({ x: 100, y: 850 }, 21)) };
    expect(scoreGazeCheck([trial], screen).corners.stop).toMatchObject({ hits: 1, targetSize: 150 });
  });
});

describe('Gaze Keyboard keys', () => {
  const key = { kind: 'key', x: 800, y: 500 } as const;

  it('sizes a key so 95% of the gaze lands inside it', () => {
    const trial: Trial = { target: key, samples: samples(repeat({ x: 860, y: 480 }, 20)) };
    expect(scoreGazeCheck([trial], screen).keys.keySize).toBe(120);
  });

  it('counts how many keys of that size fit around both corner targets', () => {
    // 200 px keys: an 8 x 5 grid, with 2 x 2 cells taken by each corner target.
    const trial: Trial = { target: key, samples: samples(repeat({ x: 900, y: 500 }, 20)) };
    expect(scoreGazeCheck([trial], screen).keys.keysThatFit).toBe(32);
  });

  it('separates a steady offset from jitter', () => {
    const steady: Trial = { target: key, samples: samples(repeat({ x: 900, y: 500 }, 20)) };
    expect(scoreGazeCheck([steady], screen).keys).toMatchObject({ medianError: 100, jitter: 0 });
  });

  it('reports jitter as the typical distance from the mean gaze of each trial', () => {
    const shaky = Array.from({ length: 40 }, (_, i) => ({ t: i * 1000, point: { x: i % 2 ? 790 : 810, y: 500 } }));
    expect(scoreGazeCheck([{ target: key, samples: shaky }], screen).keys.jitter).toBe(10);
  });
});

describe('tracking quality', () => {
  it('reports samples per second and the share of samples lost', () => {
    const point = { x: 800, y: 500 };
    const trial: Trial = { target: { kind: 'key', ...point }, samples: samples([...repeat(point, 10), null]) };
    expect(scoreGazeCheck([trial], screen)).toMatchObject({ samplesPerSecond: 11, lostShare: 1 / 11 });
  });
});

describe('suggested verdict', () => {
  const hold = (kind: 'wake' | 'stop', x: number, y: number): Trial => ({
    target: { kind, x, y },
    samples: samples(repeat({ x, y }, 21)),
  });
  const corners = [hold('wake', 1480, 120), hold('stop', 120, 880)];
  const keyTrial = (offset: number): Trial => ({
    target: { kind: 'key', x: 800, y: 500 },
    samples: samples(repeat({ x: 800 + offset, y: 500 }, 20)),
  });

  it('stays on WebGazer when both corners hold and a full keyboard fits', () => {
    expect(scoreGazeCheck([...corners, keyTrial(100)], screen).verdict).toBe('stay on WebGazer');
  });

  it('suggests MediaPipe when a full keyboard no longer fits', () => {
    expect(scoreGazeCheck([...corners, keyTrial(150)], screen).verdict).toBe('try MediaPipe');
  });

  it('suggests MediaPipe when a corner hold fails', () => {
    expect(scoreGazeCheck([corners[0], keyTrial(100)], screen).verdict).toBe('try MediaPipe');
  });

  it('suggests MediaPipe when tracking is slower than the gaze event format allows', () => {
    const slow = (trial: Trial): Trial => ({ ...trial, samples: trial.samples.map((s) => ({ ...s, t: s.t * 2 })) });
    expect(scoreGazeCheck([...corners, keyTrial(100)].map(slow), screen).verdict).toBe('try MediaPipe');
  });

  it('suggests MediaPipe when no key was ever tracked', () => {
    const lost: Trial = { target: { kind: 'key', x: 800, y: 500 }, samples: samples(repeat(null, 20)) };
    expect(scoreGazeCheck([...corners, lost], screen).verdict).toBe('try MediaPipe');
  });

  it('suggests MediaPipe when a trial received no samples at all', () => {
    const empty: Trial = { target: { kind: 'key', x: 800, y: 500 }, samples: [] };
    expect(scoreGazeCheck([...corners, empty], screen).verdict).toBe('try MediaPipe');
  });
});
