// Issue #22 test pass (2026-11-09), Large View with Chrome: does quitting put the user's Dock size back exactly?
// The fake Dock below stores "dock size" the way the real one did on macOS 27.0.1 (measured with the old
// formula: 59 -> 58, 60 -> 59, 64, 48 and 36 unchanged), as a float32 truncated to whole points.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dock = vi.hoisted(() => ({ tilesize: 59 as number | null }));

vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[]) => {
    if (command === 'defaults' && args[0] === 'read') {
      if (dock.tilesize === null) throw new Error('does not exist');
      return Buffer.from(`${dock.tilesize}\n`);
    }
    if (command === 'defaults' && args[0] === 'delete') {
      dock.tilesize = null;
      return Buffer.from('');
    }
    const size = Number(/dock size of dock preferences to ([\d.e-]+)/.exec(args.join(' '))?.[1]);
    dock.tilesize = Math.floor(16 + Math.fround(size) * 112);
    return Buffer.from('');
  },
}));

const { applyDockSize, restoreDock } = await import('./dock-size');

describe('Large View Dock size round trip', () => {
  beforeEach(() => {
    dock.tilesize = 59;
  });

  // Measured before the fix: 59 was stored as 58 and 60 as 59. A quarter tile up lands every size on itself.
  it('the fake Dock stores every Large View size exactly', () => {
    for (const [set, stored] of [[59, 59], [60, 60], [64, 64], [48, 48], [36, 36], [96, 96]]) {
      dock.tilesize = 0;
      const userData = mkdtempSync(join(tmpdir(), 'oculus-dock-'));
      applyDockSize(userData, true, set);
      expect(dock.tilesize).toBe(stored);
    }
  });

  it('saves the original size before making the Dock bigger', () => {
    const userData = mkdtempSync(join(tmpdir(), 'oculus-dock-'));
    expect(applyDockSize(userData, true, 96)).toBe(true);
    expect(dock.tilesize).toBe(96);
    expect(JSON.parse(readFileSync(join(userData, 'dock-size.json'), 'utf8'))).toEqual({ tilesize: 59 });
  });

  it('quitting puts a Dock of 59 back at 59', () => {
    const userData = mkdtempSync(join(tmpdir(), 'oculus-dock-'));
    applyDockSize(userData, true, 96);
    restoreDock(userData);
    expect(dock.tilesize).toBe(59);
  });

  it('ten runs of the app leave a Dock of 60 at 60, not drifting down', () => {
    dock.tilesize = 60;
    for (let run = 0; run < 10; run++) {
      const userData = mkdtempSync(join(tmpdir(), 'oculus-dock-'));
      applyDockSize(userData, true, 96);
      restoreDock(userData);
    }
    expect(dock.tilesize).toBe(60);
  });

  it('a size the user never set is unset again', () => {
    dock.tilesize = null;
    const userData = mkdtempSync(join(tmpdir(), 'oculus-dock-'));
    applyDockSize(userData, true, 96);
    restoreDock(userData);
    expect(dock.tilesize).toBeNull();
  });
});
