import { describe, expect, it } from 'vitest';
import { scoreGazeCheck, type Sample, type Trial } from './score';

const screen = { width: 1600, height: 1000 };
const wake = { kind: 'wake', x: 1480, y: 120 } as const;

// One sample every 100 ms, the first at t = 0.
const samples = (estimates: (Sample['estimate'])[]): Sample[] => estimates.map((estimate, i) => ({ t: i * 100, estimate }));
const repeat = (estimate: Sample['estimate'], count: number) => Array<Sample['estimate']>(count).fill(estimate);

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

  it('sizes a target centred on the gaze dot so 95% of the gaze lands inside it', () => {
    const near = repeat({ x: 1400, y: 150 }, 19);
    const trial: Trial = { target: wake, samples: samples([...near, { x: 1300, y: 150 }]) };
    expect(scoreGazeCheck([trial], screen).corners.wake.targetSize).toBe(160);
  });

  it('scores the stop target from the bottom-left corner', () => {
    const stop = { kind: 'stop', x: 120, y: 880 } as const;
    const trial: Trial = { target: stop, samples: samples(repeat({ x: 100, y: 850 }, 21)) };
    expect(scoreGazeCheck([trial], screen).corners.stop).toMatchObject({ hits: 1, targetSize: 60 });
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
    const shaky = Array.from({ length: 40 }, (_, i) => ({ t: i * 1000, estimate: { x: i % 2 ? 790 : 810, y: 500 } }));
    expect(scoreGazeCheck([{ target: key, samples: shaky }], screen).keys.jitter).toBe(10);
  });
});

describe('tracking quality', () => {
  it('reports samples per second and the share of samples lost', () => {
    const estimate = { x: 800, y: 500 };
    const trial: Trial = { target: { kind: 'key', ...estimate }, samples: samples([...repeat(estimate, 10), null]) };
    expect(scoreGazeCheck([trial], screen)).toMatchObject({ samplesPerSecond: 10, lostShare: 1 / 11 });
  });
});

describe('offset per target', () => {
  const target = { kind: 'key', x: 800, y: 500 } as const;

  it('averages the gaze offset across every trial of the same target', () => {
    const trials: Trial[] = [
      { target, samples: samples(repeat({ x: 830, y: 480 }, 5)) },
      { target, samples: samples(repeat({ x: 850, y: 460 }, 5)) },
    ];
    expect(scoreGazeCheck(trials, screen).targets).toEqual([{ ...target, offset: { x: 40, y: -30 } }]);
  });

  it('keeps targets apart and ignores lost samples', () => {
    const other = { kind: 'wake', x: 1480, y: 120 } as const;
    const trials: Trial[] = [
      { target, samples: samples([{ x: 810, y: 500 }, null]) },
      { target: other, samples: samples(repeat({ x: 1480, y: 140 }, 3)) },
    ];
    expect(scoreGazeCheck(trials, screen).targets).toEqual([
      { ...target, offset: { x: 10, y: 0 } },
      { ...other, offset: { x: 0, y: 20 } },
    ]);
  });

  it('has no offset for a target that was never tracked', () => {
    const trial: Trial = { target, samples: samples(repeat(null, 3)) };
    expect(scoreGazeCheck([trial], screen).targets).toEqual([{ ...target, offset: null }]);
  });
});

describe('suggested verdict', () => {
  const hold = (kind: 'wake' | 'stop', x: number, y: number): Trial => ({
    target: { kind, x, y },
    samples: samples(repeat({ x, y }, 21)),
  });
  const corners = [hold('wake', 1480, 120), hold('stop', 120, 880)];
  const key = { kind: 'key', x: 800, y: 500 } as const;
  const keyTrial = (offset: number): Trial => ({ target: key, samples: samples(repeat({ x: 800 + offset, y: 500 }, 20)) });
  // Each swing lasts longer than the smoothing window, so smoothing leaves most of it intact.
  const shakyTrial: Trial = {
    target: key,
    samples: Array.from({ length: 80 }, (_, i) => ({
      t: i * 100,
      estimate: { x: Math.floor(i / 20) % 2 ? 950 : 650, y: 500 },
    })),
  };

  it('passes when the gaze is steady', () => {
    expect(scoreGazeCheck([...corners, keyTrial(100)], screen).verdict).toBe('steady enough for a full keyboard');
  });

  it('passes a steady offset, which calibration can fix', () => {
    const report = scoreGazeCheck([...corners, keyTrial(150)], screen);
    expect(report.keys.keysThatFit).toBe(13);
    expect(report.verdict).toBe('steady enough for a full keyboard');
  });

  it('fails when jitter alone stops a full keyboard fitting', () => {
    const report = scoreGazeCheck([...corners, shakyTrial], screen);
    expect(report.keys.steadyKeySize).toBeGreaterThan(200);
    expect(report.verdict).toBe('too jittery or slow for a full keyboard');
  });

  it('fails when tracking is slower than the gaze event format allows', () => {
    const slow = (trial: Trial): Trial => ({ ...trial, samples: trial.samples.map((s) => ({ ...s, t: s.t * 2 })) });
    expect(scoreGazeCheck([...corners, keyTrial(100)].map(slow), screen).verdict).toBe('too jittery or slow for a full keyboard');
  });

  it('draws no conclusion when no key was ever tracked', () => {
    const lost: Trial = { target: key, samples: samples(repeat(null, 20)) };
    expect(scoreGazeCheck([...corners, lost], screen).verdict).toBe('no gaze data');
  });

  it('draws no conclusion when a trial received no samples at all', () => {
    expect(scoreGazeCheck([{ target: key, samples: [] }], screen).verdict).toBe('no gaze data');
  });
});
