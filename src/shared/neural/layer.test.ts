import { describe, expect, it } from 'vitest';
import { createGazeCorrection, MAX_SHIFT_PX, MIN_EXAMPLES } from './gaze-correction';
import { createIconOrder, readIconOrder } from './icon-order';
import { createNeuralLayer, emptyNeuralLayer, readNeuralLayer } from './layer';
import { createScanPace, MIN_SAMPLES, MIN_STEP_MS, readScanPace } from './scan-pace';

const screen = { width: 1600, height: 1000 };
const grid = [0.15, 0.5, 0.85].flatMap((fx) => [0.2, 0.5, 0.8].map((fy) => ({ x: fx * screen.width, y: fy * screen.height })));
const shifted = (dx: number, dy: number) => grid.map((target) => ({ gaze: { x: target.x + dx, y: target.y + dy }, target, weight: 1 }));

describe('Gaze Correction', () => {
  it('leaves the gaze alone until it has enough confirmed selections', () => {
    const correction = createGazeCorrection(screen);
    shifted(-80, 40).slice(0, MIN_EXAMPLES - 1).forEach((example) => correction.learn(example));
    expect(correction.correct({ x: 500, y: 500, radius: 120 })).toEqual({ x: 500, y: 500, radius: 120 });
  });

  it('learns a steady error and keeps the radius', () => {
    const correction = createGazeCorrection(screen);
    shifted(-80, 40).forEach((example) => correction.learn(example));
    const { x, y, radius } = correction.correct({ x: 620, y: 340, radius: 120 });
    expect(Math.abs(x - 700)).toBeLessThan(25);
    expect(Math.abs(y - 300)).toBeLessThan(25);
    expect(radius).toBe(120);
  });

  it('never shifts further than the cap', () => {
    const correction = createGazeCorrection(screen);
    shifted(-900, 0).forEach((example) => correction.learn(example));
    const { x } = correction.correct({ x: 500, y: 500, radius: 120 });
    expect(x - 500).toBeLessThanOrEqual(MAX_SHIFT_PX + 0.001);
  });

  it('forgets everything on reset', () => {
    const correction = createGazeCorrection(screen);
    shifted(-80, 40).forEach((example) => correction.learn(example));
    correction.reset();
    expect(correction.stats()).toMatchObject({ examples: 0, active: false });
    expect(correction.correct({ x: 620, y: 340, radius: 120 })).toEqual({ x: 620, y: 340, radius: 120 });
  });
});

describe('Icon Order', () => {
  const names = ['Finder', 'Safari', 'Notes', 'Mail'];

  it('puts the icon this user keeps opening first, and keeps screen order for the rest', () => {
    const order = createIconOrder();
    for (let i = 0; i < 4; i++) order.learn('dock', names, 'Mail', i * 1000);
    expect(order.order('dock', names, 5000)).toEqual(['Mail', 'Finder', 'Safari', 'Notes']);
  });

  it('keeps each Icon Scan source apart', () => {
    const order = createIconOrder();
    order.learn('desktop', names, 'Mail', 0);
    expect(order.order('dock', names, 1000)).toEqual(names);
  });

  it('survives a round trip through JSON, and starts fresh from anything malformed', () => {
    const order = createIconOrder();
    order.learn('dock', names, 'Notes', 0);
    const restored = createIconOrder(readIconOrder(JSON.parse(JSON.stringify(order.model()))));
    expect(restored.order('dock', names, 1000)).toEqual(order.order('dock', names, 1000));
    for (const raw of [null, 'x', { version: 2 }]) expect(readIconOrder(raw).uses).toEqual({});
  });

  it('drops malformed uses and keeps the rest', () => {
    const notes = { count: 2, last: 0, heat: 1.5 };
    const uses = { dock: { Notes: notes, Safari: { count: 'x' }, Mail: null }, desktop: 'junk' };
    expect(readIconOrder({ version: 1, uses }).uses).toEqual({ dock: { Notes: notes } });
  });
});

describe('Scan Pace', () => {
  it('keeps the set step until it has enough presses', () => {
    const pace = createScanPace(2000);
    for (let i = 0; i < MIN_SAMPLES - 1; i++) pace.select(300, 2000, false);
    expect(pace.stepMs()).toBe(2000);
  });

  it('eases towards a step that covers this user, never below the floor', () => {
    const pace = createScanPace(2000);
    for (let i = 0; i < 80; i++) pace.select(200, pace.stepMs(), false);
    expect(pace.stepMs()).toBeGreaterThanOrEqual(MIN_STEP_MS);
    expect(pace.stepMs()).toBeLessThan(MIN_STEP_MS + 50);
  });

  it('counts a press that gets undone as needing a whole step more, which slows the scan again', () => {
    const quick = createScanPace(2000);
    const missing = createScanPace(2000);
    for (let i = 0; i < 40; i++) {
      quick.select(500, quick.stepMs(), false);
      missing.select(500, missing.stepMs(), false);
      if (i % 4 === 3) missing.select(400, missing.stepMs(), true);
    }
    expect(missing.stepMs()).toBeGreaterThan(quick.stepMs());
  });

  it('never goes slower than half again the set step', () => {
    const pace = createScanPace(1000);
    for (let i = 0; i < 60; i++) pace.select(5000, 1000, false);
    expect(pace.stepMs()).toBeLessThanOrEqual(1500);
  });

  it('starts fresh from anything malformed', () => {
    for (const raw of [null, { version: 1, reactions: ['x'], stepMs: null }, { version: 1, reactions: [], stepMs: 'fast' }]) {
      expect(readScanPace(raw)).toEqual({ version: 1, reactions: [], stepMs: null });
    }
  });
});

describe('Neural Layer', () => {
  const layer = () => createNeuralLayer({ screen, scanStepMs: 2000 });

  it('routes each confirmed choice to its learner', () => {
    const neural = layer();
    neural.learn({ kind: 'icon-opened', source: 'dock', scanned: ['A', 'B', 'C'], chosen: 'C' }, undefined, 0);
    neural.learn({ kind: 'icon-opened', source: 'dock', scanned: ['A', 'B', 'C'], chosen: 'C' }, undefined, 10);
    expect(neural.orderIcons('dock', ['A', 'B', 'C'], 20)[0]).toBe('C');
    for (let i = 0; i < 30; i++) neural.learn({ kind: 'select', offsetMs: 300, stepMs: neural.scanStepMs(), undoes: false });
    expect(neural.scanStepMs()).toBeLessThan(2000);
  });

  it('learns gaze from the uncorrected gaze the outside world fills in, and skips a time nothing was tracked', () => {
    const neural = layer();
    grid.forEach((target, i) => neural.learn({ kind: 'gaze', from: i, to: i + 1, target, weight: 1 }, () => ({ x: target.x - 80, y: target.y + 40 })));
    neural.learn({ kind: 'gaze', from: 99, to: 100, target: { x: 0, y: 0 }, weight: 1 }, () => null);
    expect(neural.stats().gaze).toMatchObject({ examples: grid.length, active: true });
    neural.recalibrated();
    expect(neural.stats().gaze).toMatchObject({ examples: 0, active: false });
  });

  it('keeps Icon Order and Scan Pace through a recalibration and a save', () => {
    const neural = layer();
    neural.learn({ kind: 'icon-opened', source: 'dock', scanned: ['A', 'B'], chosen: 'B' }, undefined, 0);
    neural.recalibrated();
    const restored = createNeuralLayer({ screen, scanStepMs: 2000, model: readNeuralLayer(JSON.parse(JSON.stringify(neural.model()))) });
    expect(restored.orderIcons('dock', ['A', 'B'], 10)).toEqual(['B', 'A']);
    expect(readNeuralLayer({ version: 9 })).toEqual(emptyNeuralLayer());
  });
});
