import { describe, expect, it } from 'vitest';
import type { GazeExample } from '../shared/gaze';
import { createGazeCorrection, MAX_SHIFT_PX, MIN_EXAMPLES } from './gaze-correction';

const screen = { width: 1600, height: 1000 };
const region = (x: number, y: number) => ({ x, y, radius: 120 });

// Targets across the screen, as key presses would give them. The tracker reads every one 80 px left and 40 px low.
const targets = [0.15, 0.5, 0.85].flatMap((fx) => [0.2, 0.5, 0.8].map((fy) => ({ x: fx * screen.width, y: fy * screen.height })));
const shifted = (dx: number, dy: number): GazeExample[] => targets.map((target) => ({ gaze: { x: target.x + dx, y: target.y + dy }, target }));

describe('Gaze Correction', () => {
  it('leaves the gaze alone until it has enough confirmed selections', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(shifted(-80, 40).slice(0, MIN_EXAMPLES - 1));
    expect(correction.active).toBe(false);
    expect(correction.correct(region(500, 500))).toEqual(region(500, 500));
  });

  it("learns a steady tracking error and moves the Gaze Region back onto what the user looks at", async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(shifted(-80, 40));
    expect(correction.active).toBe(true);
    // A position it never saw: the user looks at 700, 300, and the tracker says 620, 340.
    const { x, y, radius } = correction.correct(region(620, 340));
    expect(Math.abs(x - 700)).toBeLessThan(20);
    expect(Math.abs(y - 300)).toBeLessThan(20);
    expect(radius).toBe(120);
  });

  it('learns an error that changes across the screen', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    // Further right reads further right, as when the calibration is too narrow.
    const examples = targets.map((target) => ({ gaze: { x: target.x + (target.x - 800) * 0.1, y: target.y }, target }));
    await correction.learn(examples);
    expect(Math.abs(correction.correct(region(1400 + 60, 500)).x - 1400)).toBeLessThan(25);
    expect(Math.abs(correction.correct(region(200 - 60, 500)).x - 200)).toBeLessThan(25);
  });

  it('never shifts the gaze further than the cap, whatever it was taught', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(shifted(-600, 0));
    const corrected = correction.correct(region(500, 500));
    expect(corrected.x - 500).toBeLessThanOrEqual(MAX_SHIFT_PX);
  });

  it('forgets everything on reset', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    await correction.learn(shifted(-80, 40));
    correction.reset();
    expect(correction.active).toBe(false);
    expect(correction.exampleCount).toBe(0);
    expect(correction.correct(region(620, 340))).toEqual(region(620, 340));
  });

  it('drops training that finishes after a reset', async () => {
    const correction = createGazeCorrection({ screen, enabled: true, seed: 1 });
    const training = correction.learn(shifted(-80, 40));
    correction.reset();
    await training;
    expect(correction.active).toBe(false);
  });

  it('does nothing when switched off', async () => {
    const correction = createGazeCorrection({ screen, enabled: false, seed: 1 });
    await correction.learn(shifted(-80, 40));
    expect(correction.active).toBe(false);
    expect(correction.exampleCount).toBe(0);
    expect(correction.correct(region(620, 340))).toEqual(region(620, 340));
  });
});
