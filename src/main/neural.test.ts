import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMainNeuralLayer } from './neural';

const screen = { width: 1600, height: 1000 };
let dir: string;
const layer = (enabled = true) => {
  dir = mkdtempSync(join(tmpdir(), 'oculus-neural-'));
  return createMainNeuralLayer({ file: join(dir, 'neural-layer.json'), screen, scanStepMs: 2000, enabled, log: () => {} });
};
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The tracker reads every look 80 px left and 40 px down, and runs click where the user really looked.
const teach = (neural: ReturnType<typeof layer>, intent = 'Open this video') => {
  const spots = [0.15, 0.5, 0.85].flatMap((fx) => [0.2, 0.5, 0.8].map((fy) => ({ x: fx * screen.width, y: fy * screen.height })));
  spots.forEach((spot, i) => {
    const t = i * 10_000;
    neural.seen(t, { x: spot.x - 80, y: spot.y + 40, radius: 120 });
    neural.runSucceeded(intent, { x: spot.x - 80, y: spot.y + 40, radius: 120 }, { from: t, to: t }, spot, { x: 0, y: 0 });
  });
};

describe('Neural Layer in the main process', () => {
  it('learns Gaze Correction from runs that went well, matched to the uncorrected gaze', () => {
    const neural = layer();
    teach(neural);
    const corrected = neural.correct({ x: 620, y: 340, radius: 120 })!;
    expect(Math.abs(corrected.x - 700)).toBeLessThan(25);
    expect(Math.abs(corrected.y - 300)).toBeLessThan(25);
  });

  it('learns nothing from skipping an ad, whose click is wherever the Skip button is', () => {
    const neural = layer();
    teach(neural, 'Skip the ad');
    expect(neural.correct({ x: 620, y: 340, radius: 120 })).toEqual({ x: 620, y: 340, radius: 120 });
  });

  it('learns nothing from a click far from where the user looked', () => {
    const neural = layer();
    neural.seen(0, { x: 200, y: 200, radius: 120 });
    for (let i = 0; i < 10; i++) neural.runSucceeded('Open this', { x: 200, y: 200, radius: 120 }, { from: 0, to: 0 }, { x: 1400, y: 900 }, { x: 0, y: 0 });
    expect(neural.correct({ x: 200, y: 200, radius: 120 })).toEqual({ x: 200, y: 200, radius: 120 });
  });

  it('forgets Gaze Correction on recalibrating', () => {
    const neural = layer();
    teach(neural);
    neural.recalibrated();
    expect(neural.correct({ x: 620, y: 340, radius: 120 })).toEqual({ x: 620, y: 340, radius: 120 });
  });

  it('saves Icon Order and Scan Pace to its file', () => {
    const neural = layer();
    neural.learn({ kind: 'icon-opened', source: 'dock', scanned: ['A', 'B'], chosenIndex: 1 });
    // Saves are debounced during normal use; flush forces the write immediately for the test.
    neural.flush();
    const saved = JSON.parse(readFileSync(join(dir, 'neural-layer.json'), 'utf8'));
    expect(saved.icons.uses.dock.B.count).toBe(1);
  });

  it('coalesces repeated save requests into a single write', () => {
    const neural = layer();
    const file = join(dir, 'neural-layer.json');
    for (let i = 0; i < 5; i++) neural.learn({ kind: 'icon-opened', source: 'dock', scanned: ['A', 'B'], chosenIndex: 1 });
    // The debounced save has not fired yet, so no file is on disk.
    expect(() => readFileSync(file, 'utf8')).toThrow();
    neural.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).icons.uses.dock.B.count).toBe(5);
  });

  it('changes nothing when switched off', () => {
    const neural = layer(false);
    teach(neural);
    neural.learn({ kind: 'icon-opened', source: 'dock', scanned: ['A', 'B'], chosenIndex: 1 });
    for (let i = 0; i < 30; i++) neural.learn({ kind: 'select', offsetMs: 200, stepMs: 2000, undoes: false });
    expect(neural.correct({ x: 620, y: 340, radius: 120 })).toEqual({ x: 620, y: 340, radius: 120 });
    expect(neural.orderIcons('dock', ['A', 'B'])).toEqual([0, 1]);
    expect(neural.scanPace()).toBe(2000);
  });
});
