import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMainNeuralLayer } from './neural';

const screen = { width: 1600, height: 1000 };
let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Fast presses that would teach Scan Pace a much shorter step.
function pressFast(scanStepSet: boolean) {
  dir = mkdtempSync(join(tmpdir(), 'neural-'));
  const neural = createMainNeuralLayer({ file: join(dir, 'neural-layer.json'), screen, scanStepMs: 2000, enabled: true, scanStepSet, log: () => {} });
  for (let i = 0; i < 40; i++) neural.learn({ kind: 'select', offsetMs: 300, stepMs: neural.scanPace(), undoes: false });
  return neural.scanPace();
}

describe('Scan Pace in the main process', () => {
  it('learns a faster step from the default one', () => {
    expect(pressFast(false)).toBeLessThan(2000);
  });

  it('leaves a scan step set in config.json alone', () => {
    expect(pressFast(true)).toBe(2000);
  });
});
