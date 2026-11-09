import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainNeuralLayer } from './neural';

const screen = { width: 1600, height: 1000 };

describe('createMainNeuralLayer', () => {
  let dir: string;
  let file: string;
  const create = () => createMainNeuralLayer({ file, screen, scanStepMs: 2000, enabled: true, log: () => {} });

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'neural-'));
    file = join(dir, 'neural-layer.json');
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('still has the raw gaze of a hold when the run it led to ends minutes later', async () => {
    const layer = create();
    for (let t = 0; t <= 1000; t += 33) layer.seen(t, { x: 400, y: 300, radius: 60 });
    // Typing or a run takes a while, and gaze keeps coming the whole time.
    for (let t = 1000; t <= 120_000; t += 1000) layer.seen(t, { x: 900, y: 600, radius: 60 });
    layer.learn({ kind: 'gaze', from: 0, to: 1000, target: { x: 420, y: 310 }, weight: 1 });
    await vi.runAllTimersAsync();
    expect(layer.stats().gaze.examples).toBe(1);
  });

  it('learns gaze after the input that sent it, not during it', async () => {
    const layer = create();
    layer.seen(0, { x: 400, y: 300, radius: 60 });
    layer.learn({ kind: 'gaze', from: 0, to: 0, target: { x: 420, y: 310 }, weight: 1 });
    expect(layer.stats().gaze.examples).toBe(0);
    await vi.runAllTimersAsync();
    expect(layer.stats().gaze.examples).toBe(1);
  });

  it('writes presses close together once, a moment later, and flush writes at once', () => {
    const layer = create();
    layer.learn({ kind: 'select', offsetMs: 800, stepMs: 2000, undoes: false });
    layer.learn({ kind: 'select', offsetMs: 900, stepMs: 2000, undoes: false });
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(existsSync(file)).toBe(true);

    rmSync(file);
    layer.learn({ kind: 'select', offsetMs: 700, stepMs: 2000, undoes: false });
    layer.flush();
    expect(existsSync(file)).toBe(true);
  });
});
