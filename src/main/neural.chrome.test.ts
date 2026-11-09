// Issue #22 test pass (2026-11-09): what a Chrome run teaches Gaze Correction through runSucceeded. The user really
// looks at each target, and the tracker reads 100 points left and 60 below (OCULUS_MOUSE_SHIFT="-100,60").
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMainNeuralLayer } from './neural';

const screen = { width: 1800, height: 1169 };
const origin = { x: 0, y: 0 };
const SHIFT = { x: -100, y: 60 };
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const targets = Array.from({ length: 16 }, (_, i) => ({ x: 250 + (i % 4) * 400, y: 300 + Math.floor(i / 4) * 220 }));

// One confirmed run per target: 1 s of raw gaze at the shifted spot, then a run whose first click is `click(target)`.
function teach(intent: string, click: (target: { x: number; y: number }, raw: { x: number; y: number }) => { x: number; y: number }) {
  dir = mkdtempSync(join(tmpdir(), 'neural-chrome-'));
  const lines: string[] = [];
  const neural = createMainNeuralLayer({ file: join(dir, 'n.json'), screen, scanStepMs: 2000, enabled: true, log: (line) => lines.push(line) });
  let t = 0;
  for (const target of targets) {
    const raw = { x: target.x + SHIFT.x, y: target.y + SHIFT.y };
    const from = t;
    for (; t <= from + 1000; t += 33) neural.seen(t, { ...raw, radius: 60 });
    neural.runSucceeded(intent, { ...raw, radius: 60 }, { from, to: t }, click(target, raw), origin);
    t += 5000;
  }
  const probe = neural.correct({ x: 900 + SHIFT.x, y: 600 + SHIFT.y, radius: 60 })!;
  return { neural, lines, moved: { x: probe.x - (900 + SHIFT.x), y: probe.y - (600 + SHIFT.y) } };
}

describe('Gaze Correction from Chrome runs', () => {
  it('learns the shift when the first click lands on the real target (within 2.5 radii)', () => {
    const { lines, moved } = teach('Open this video', (target) => target);
    expect(lines.some((line) => line.includes('gaze correction on'))).toBe(true);
    expect(Math.abs(moved.x - 100)).toBeLessThan(35);
    expect(Math.abs(moved.y + 60)).toBeLessThan(35);
  });

  it('never learns from Skip the ad, wherever it clicked', () => {
    const { lines, moved } = teach('Skip the ad', (target) => target);
    expect(lines).toEqual([]);
    expect(moved).toEqual({ x: 0, y: 0 });
  });

  it('learns nothing from a click further than 2.5 radii (150 points) from the gaze', () => {
    const { lines } = teach('Open this video', (target) => ({ x: target.x + 300, y: target.y }));
    expect(lines).toEqual([]);
  });

  // Seen live: the agent clicks the hinted point itself when it is inside a big thumbnail, so the label is the
  // miscalibrated gaze and teaches no shift. Gaze Correction then only learns from the Start Gesture's weak labels.
  it('a run that clicks exactly where the shifted gaze was teaches no correction', () => {
    const { lines } = teach('Open this video', (_target, raw) => raw);
    expect(lines.some((line) => line.includes('gaze correction on'))).toBe(false);
  });

  it('recalibrating drops what was learned', () => {
    const { neural } = teach('Open this video', (target) => target);
    neural.recalibrated();
    expect(neural.correct({ x: 800, y: 660, radius: 60 })).toEqual({ x: 800, y: 660, radius: 60 });
  });
});
