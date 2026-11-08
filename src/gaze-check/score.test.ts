import { describe, expect, it } from 'vitest';
import { scoreGazeCheck, smoother, type Sample, type Trial } from './score';

const screen = { width: 1600, height: 1000 };
// Centre Box half-size: 25 vmin = 250 px on this screen.
const centre = { kind: 'centre', x: 800, y: 500 } as const;

// One sample every 100 ms, the first at t = 0.
const samples = (estimates: (Sample['estimate'])[]): Sample[] => estimates.map((estimate, i) => ({ t: i * 100, estimate }));
const repeat = (estimate: Sample['estimate'], count: number) => Array<Sample['estimate']>(count).fill(estimate);

describe('Centre Box', () => {
  it('counts a trial as a hit when gaze holds the Centre Box for 3 seconds, as the Start Gesture needs', () => {
    const trial: Trial = { target: centre, samples: samples(repeat({ x: 800, y: 500 }, 31)) };
    expect(scoreGazeCheck([trial], screen).centre).toMatchObject({ hits: 1, trials: 1 });
  });

  it('counts a miss when the hold is shorter than the Start Gesture', () => {
    const trial: Trial = { target: centre, samples: samples(repeat({ x: 800, y: 500 }, 26)) };
    expect(scoreGazeCheck([trial], screen).centre.hits).toBe(0);
  });

  it('counts gaze on the Centre Box edge as inside, as the app does', () => {
    const trial: Trial = { target: centre, samples: samples(repeat({ x: 1050, y: 250 }, 31)) };
    expect(scoreGazeCheck([trial], screen).centre.hits).toBe(1);
  });

  it('counts a miss when gaze holds just outside the Centre Box', () => {
    const trial: Trial = { target: centre, samples: samples(repeat({ x: 1051, y: 500 }, 31)) };
    expect(scoreGazeCheck([trial], screen).centre.hits).toBe(0);
  });

  it('counts a miss when tracking is lost mid-hold', () => {
    const on = { x: 800, y: 500 };
    const trial: Trial = { target: centre, samples: samples([...repeat(on, 15), null, ...repeat(on, 15)]) };
    expect(scoreGazeCheck([trial], screen).centre.hits).toBe(0);
  });

  it('smooths gaze so one stray sample does not restart the hold', () => {
    const on = { x: 800, y: 500 };
    const trial: Trial = { target: centre, samples: samples([...repeat(on, 15), { x: 800, y: 900 }, ...repeat(on, 15)]) };
    expect(scoreGazeCheck([trial], screen).centre.hits).toBe(1);
  });

  it('sizes a target so 95% of gaze falls inside it', () => {
    // 1000 ms between samples so smoothing does not blend them.
    const near = Array.from({ length: 9 }, (_, i): Sample => ({ t: i * 1000, estimate: { x: 820, y: 540 } }));
    const trial: Trial = { target: centre, samples: [...near, { t: 9000, estimate: { x: 940, y: 540 } }] };
    // 9 at Chebyshev distance 40, 1 at 140. 95th percentile is 140, targetSize = 280.
    expect(scoreGazeCheck([trial], screen).centre.targetSize).toBe(280);
  });
});

describe('Gaze Keyboard keys', () => {
  const key = { kind: 'key', x: 800, y: 500 } as const;

  it('sizes a key so 95% of the gaze lands inside it', () => {
    const trial: Trial = { target: key, samples: samples(repeat({ x: 860, y: 480 }, 20)) };
    expect(scoreGazeCheck([trial], screen).keys.keySize).toBe(120);
  });

  it('counts how many keys of that size fit on screen', () => {
    // 200 px keys: an 8 x 5 grid = 40 keys.
    const trial: Trial = { target: key, samples: samples(repeat({ x: 900, y: 500 }, 20)) };
    expect(scoreGazeCheck([trial], screen).keys.keysThatFit).toBe(40);
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

  it('keeps targets apart by kind and position, and ignores lost samples', () => {
    const other = { kind: 'centre', x: 800, y: 500 } as const;
    const keyAt = { kind: 'key', x: 400, y: 300 } as const;
    const trials: Trial[] = [
      { target: keyAt, samples: samples([{ x: 410, y: 300 }, null]) },
      { target: other, samples: samples(repeat({ x: 800, y: 520 }, 3)) },
    ];
    expect(scoreGazeCheck(trials, screen).targets).toEqual([
      { ...keyAt, offset: { x: 10, y: 0 } },
      { ...other, offset: { x: 0, y: 20 } },
    ]);
  });

  it('has no offset for a target that was never tracked', () => {
    const trial: Trial = { target, samples: samples(repeat(null, 3)) };
    expect(scoreGazeCheck([trial], screen).targets).toEqual([{ ...target, offset: null }]);
  });
});

describe('suggested verdict', () => {
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
    expect(scoreGazeCheck([keyTrial(100)], screen).verdict).toBe('steady enough for a full keyboard');
  });

  it('passes a steady offset, which calibration can fix', () => {
    const report = scoreGazeCheck([keyTrial(150)], screen);
    expect(report.keys.keysThatFit).toBe(15);
    expect(report.verdict).toBe('steady enough for a full keyboard');
  });

  it('fails when jitter alone stops a full keyboard fitting', () => {
    const report = scoreGazeCheck([shakyTrial], screen);
    expect(report.keys.steadyKeySize).toBeGreaterThan(200);
    expect(report.verdict).toBe('too jittery or slow for a full keyboard');
  });

  it('fails when tracking is slower than the gaze event format allows', () => {
    const slow = (trial: Trial): Trial => ({ ...trial, samples: trial.samples.map((s) => ({ ...s, t: s.t * 2 })) });
    expect(scoreGazeCheck([keyTrial(100)].map(slow), screen).verdict).toBe('too jittery or slow for a full keyboard');
  });

  it('draws no conclusion when no key was ever tracked', () => {
    const lost: Trial = { target: key, samples: samples(repeat(null, 20)) };
    expect(scoreGazeCheck([lost], screen).verdict).toBe('no gaze data');
  });

  it('draws no conclusion when a trial received no samples at all', () => {
    expect(scoreGazeCheck([{ target: key, samples: [] }], screen).verdict).toBe('no gaze data');
  });
});

describe('smoother', () => {
  it('averages the last 300 ms of gaze', () => {
    const smooth = smoother();
    smooth({ t: 0, estimate: { x: 0, y: 0 } });
    expect(smooth({ t: 100, estimate: { x: 100, y: 40 } }).estimate).toEqual({ x: 50, y: 20 });
  });

  it('forgets gaze older than 300 ms', () => {
    const smooth = smoother();
    smooth({ t: 0, estimate: { x: 0, y: 0 } });
    expect(smooth({ t: 301, estimate: { x: 100, y: 40 } }).estimate).toEqual({ x: 100, y: 40 });
  });

  it('starts again after tracking is lost', () => {
    const smooth = smoother();
    smooth({ t: 0, estimate: { x: 0, y: 0 } });
    expect(smooth({ t: 50, estimate: null }).estimate).toBeNull();
    expect(smooth({ t: 100, estimate: { x: 100, y: 40 } }).estimate).toEqual({ x: 100, y: 40 });
  });
});
