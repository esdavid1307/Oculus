// Simulated users for the Neural Layer: each learner is measured against doing nothing, with fixed seeds so the numbers
// in docs/neural-layer.md can be reproduced with
// `npx vitest run src/shared/neural/eval.test.ts`. Results go to out/neural-eval.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { seededRandom } from '../predict';
import { createGazeCorrection } from './gaze-correction';
import { createIconOrder } from './icon-order';
import { createScanPace } from './scan-pace';

const screen = { width: 1470, height: 956 };
const results: Record<string, unknown> = {};

afterAll(() => {
  mkdirSync('out', { recursive: true });
  writeFileSync('out/neural-eval.json', JSON.stringify(results, null, 2));
});

function rng(seed: number) {
  const random = seededRandom(seed);
  const uniform = () => random() + 0.5;
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform());
  return { uniform, normal };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;

describe('Gaze Correction', () => {
  // A calibration that's off: shifted, a little too narrow, and noisy from hold to hold.
  const tracker = (seed: number) => {
    const { uniform, normal } = rng(seed);
    const read = ({ x, y }: { x: number; y: number }) => ({
      x: screen.width / 2 + (x - screen.width / 2) * 0.9 - 80 + normal() * 25,
      y: screen.height / 2 + (y - screen.height / 2) * 1.08 + 55 + normal() * 25,
    });
    const target = () => ({ x: 60 + uniform() * (screen.width - 120), y: 60 + uniform() * (screen.height - 120) });
    return { read, target };
  };

  const run = (seed: number, confirmed: number) => {
    const { read, target } = tracker(seed);
    const correction = createGazeCorrection(screen, seed);
    for (let i = 0; i < confirmed; i++) {
      const at = target();
      correction.learn({ gaze: read(at), target: at, weight: 1 });
    }
    const errors = Array.from({ length: 300 }, () => {
      const at = target();
      const raw = read(at);
      const fixed = correction.correct({ ...raw, radius: 120 });
      return { before: Math.hypot(raw.x - at.x, raw.y - at.y), after: Math.hypot(fixed.x - at.x, fixed.y - at.y) };
    });
    return {
      before: median(errors.map((e) => e.before)),
      after: median(errors.map((e) => e.after)),
      // A Suggested Intent target or text box about 240 px across, hit when the corrected centre lands inside.
      hitsBefore: errors.filter((e) => e.before <= 120).length / errors.length,
      hitsAfter: errors.filter((e) => e.after <= 120).length / errors.length,
      active: correction.stats().active,
    };
  };

  it('cuts the tracking error with a few confirmed selections, and more with more', () => {
    const table = [6, 10, 20, 40].map((confirmed) => {
      const runs = [1, 2, 3, 4, 5].map((seed) => run(seed, confirmed));
      return {
        confirmed,
        medianErrorBeforePx: Math.round(mean(runs.map((r) => r.before))),
        medianErrorAfterPx: Math.round(mean(runs.map((r) => r.after))),
        hitRateBefore: +mean(runs.map((r) => r.hitsBefore)).toFixed(2),
        hitRateAfter: +mean(runs.map((r) => r.hitsAfter)).toFixed(2),
        activeRuns: runs.filter((r) => r.active).length,
      };
    });
    results.gazeCorrection = table;
    const at20 = table.find((row) => row.confirmed === 20)!;
    expect(at20.medianErrorAfterPx, JSON.stringify(table)).toBeLessThan(at20.medianErrorBeforePx * 0.5);
    expect(table.at(-1)!.medianErrorAfterPx).toBeLessThanOrEqual(at20.medianErrorAfterPx + 5);
  }, 120_000);

  it('stays off when there is no steady error to learn, so it never makes good tracking worse', () => {
    const { uniform, normal } = rng(9);
    const correction = createGazeCorrection(screen, 9);
    const target = () => ({ x: 60 + uniform() * (screen.width - 120), y: 60 + uniform() * (screen.height - 120) });
    const read = ({ x, y }: { x: number; y: number }) => ({ x: x + normal() * 25, y: y + normal() * 25 });
    for (let i = 0; i < 30; i++) {
      const at = target();
      correction.learn({ gaze: read(at), target: at, weight: 1 });
    }
    const errors = Array.from({ length: 300 }, () => {
      const at = target();
      const raw = read(at);
      const fixed = correction.correct({ ...raw, radius: 120 });
      return { before: Math.hypot(raw.x - at.x, raw.y - at.y), after: Math.hypot(fixed.x - at.x, fixed.y - at.y) };
    });
    const before = median(errors.map((e) => e.before));
    const after = median(errors.map((e) => e.after));
    results.gazeCorrectionNoError = { medianErrorBeforePx: Math.round(before), medianErrorAfterPx: Math.round(after), active: correction.stats().active };
    expect(after).toBeLessThan(before * 1.1);
  }, 60_000);
});

describe('Icon Order', () => {
  // 20 Dock icons used the way people use apps: a few a lot, most rarely, in no relation to where they sit.
  // changeAt is when the user's favourites change, to see how fast the order follows.
  const run = (seed: number, opens: number, changeAt = Infinity) => {
    const { uniform } = rng(seed);
    const names = Array.from({ length: 20 }, (_, i) => `App ${i + 1}`);
    const shuffle = () => [...names].sort(() => uniform() - 0.5);
    let favourite = shuffle();
    const weights = favourite.map((_, rank) => 1 / (rank + 1) ** 1.1);
    const total = weights.reduce((sum, w) => sum + w, 0);
    const pick = () => {
      let r = uniform() * total;
      for (let i = 0; i < favourite.length; i++) if ((r -= weights[i]) <= 0) return favourite[i];
      return favourite.at(-1)!;
    };
    const order = createIconOrder();
    const counts: Record<string, number> = {};
    const steps: { screen: number; learned: number; ideal: number; counts: number }[] = [];
    let t = 0;
    for (let i = 0; i < opens; i++) {
      if (i === changeAt) favourite = shuffle();
      t += 3_600_000;
      const chosen = pick();
      const byCount = [...names].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || names.indexOf(a) - names.indexOf(b));
      steps.push({
        screen: names.indexOf(chosen),
        learned: order.order('dock', names, t).indexOf(chosen),
        ideal: favourite.indexOf(chosen),
        counts: byCount.indexOf(chosen),
      });
      order.learn('dock', names, chosen, t);
      counts[chosen] = (counts[chosen] ?? 0) + 1;
    }
    return steps;
  };
  const summary = (steps: ReturnType<typeof run>) => ({
    stepsScreenOrder: +mean(steps.map((s) => s.screen)).toFixed(1),
    stepsLearned: +mean(steps.map((s) => s.learned)).toFixed(1),
    stepsPlainCounts: +mean(steps.map((s) => s.counts)).toFixed(1),
    stepsIdeal: +mean(steps.map((s) => s.ideal)).toFixed(1),
    firstTryShare: +(steps.filter((s) => s.learned === 0).length / steps.length).toFixed(2),
  });
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('brings the icons this user opens to the front of the scan', () => {
    const table = [10, 30, 100].map((opens) => ({ afterOpens: opens, ...summary(seeds.flatMap((seed) => run(seed, opens + 50).slice(opens))) }));
    results.iconOrder = table;
    const late = table.at(-1)!;
    expect(late.stepsLearned, JSON.stringify(table)).toBeLessThan(late.stepsScreenOrder * 0.55);
  });

  it('follows a change in habits faster than plain counts', () => {
    const changed = summary(seeds.flatMap((seed) => run(seed, 160, 100).slice(110, 160)));
    results.iconOrderAfterHabitChange = changed;
    expect(changed.stepsLearned, JSON.stringify(changed)).toBeLessThan(changed.stepsPlainCounts);
  });

  it('keeps screen order before anything is learned', () => {
    const names = ['Finder', 'Safari', 'Notes'];
    expect(createIconOrder().order('dock', names)).toEqual(names);
  });
});

describe('Scan Pace', () => {
  // Pressing once the wanted key lights up takes a while, and now and then a lot longer.
  const user = (seed: number, medianMs: number) => {
    const { uniform, normal } = rng(seed);
    return { reaction: () => medianMs * Math.exp(0.3 * normal()), key: () => Math.floor(uniform() * 9) };
  };

  // One scan of 10 keys. A press slower than the step lands on the next key, which costs a Back and a second go.
  const select = (stepMs: number, reaction: () => number, key: () => number) => {
    const k = key();
    let time = 0;
    let presses = 0;
    let missed = false;
    for (;;) {
      const r = reaction();
      presses += 1;
      time += k * stepMs + r;
      if (r < stepMs) return { time, presses, missed, offset: r, k };
      // Late: the next key was pressed. Back is the last key, then the scan starts over for the wanted one.
      missed = true;
      time += 9 * stepMs + reaction();
      presses += 1;
    }
  };

  const run = (seed: number, medianMs: number, adaptive: boolean) => {
    const { reaction, key } = user(seed, medianMs);
    const pace = createScanPace(2000);
    const outcomes = Array.from({ length: 300 }, () => {
      const stepMs = adaptive ? pace.stepMs() : 2000;
      const outcome = select(stepMs, reaction, key);
      if (outcome.missed) {
        pace.select(stepMs - 1, stepMs, false);
        pace.select(500, stepMs, true);
      }
      pace.select(outcome.offset, stepMs, false);
      return { ...outcome, stepMs };
    });
    const late = outcomes.slice(100);
    return {
      secondsPerSelection: mean(late.map((o) => o.time)) / 1000,
      missRate: late.filter((o) => o.missed).length / late.length,
      stepMs: late.at(-1)!.stepMs,
    };
  };

  it('speeds the scan up to suit the user, without many more late presses', () => {
    const table = [450, 600, 900].map((medianMs) => {
      const fixed = [1, 2, 3].map((seed) => run(seed, medianMs, false));
      const learned = [1, 2, 3].map((seed) => run(seed, medianMs, true));
      return {
        medianReactionMs: medianMs,
        fixedStepMs: 2000,
        learnedStepMs: Math.round(mean(learned.map((r) => r.stepMs))),
        secondsPerSelectionFixed: +mean(fixed.map((r) => r.secondsPerSelection)).toFixed(2),
        secondsPerSelectionLearned: +mean(learned.map((r) => r.secondsPerSelection)).toFixed(2),
        missRateFixed: +mean(fixed.map((r) => r.missRate)).toFixed(3),
        missRateLearned: +mean(learned.map((r) => r.missRate)).toFixed(3),
      };
    });
    results.scanPace = table;
    for (const row of table) {
      // A slow presser gains little, and must lose nothing.
      expect(row.secondsPerSelectionLearned, JSON.stringify(table)).toBeLessThan(row.secondsPerSelectionFixed * 1.03);
      expect(row.missRateLearned).toBeLessThan(0.03);
    }
    expect(table[1].secondsPerSelectionLearned).toBeLessThan(table[1].secondsPerSelectionFixed * 0.8);
  });
});
