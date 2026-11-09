import { describe, expect, it } from 'vitest';
import type { Rect } from './geometry';
import { GROUPS, layoutKeyboard } from './keyboard';

// #29 shrank Space to one cell to fit Reset gaze. These check the layout still holds on real Mac screens.

const screens = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1512, height: 982 },
  { width: 1728, height: 1117 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe.each(screens)('Gaze Keyboard layout on $width x $height', (screen) => {
  for (const group of [null, ...GROUPS]) {
    it(`${group ?? 'groups'}: keys are inside the screen, below the text, and never overlap`, () => {
      const { text, keys } = layoutKeyboard(screen, group);
      expect(new Set(keys.map(({ id }) => id)).size).toBe(keys.length);
      for (const { rect } of keys) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(text.height);
        expect(rect.x + rect.width).toBeLessThanOrEqual(screen.width + 0.001);
        expect(rect.y + rect.height).toBeLessThanOrEqual(screen.height + 0.001);
        expect(rect.width).toBeGreaterThan(200);
        expect(rect.height).toBeGreaterThan(150);
      }
      for (const [i, a] of keys.entries()) for (const b of keys.slice(i + 1)) expect(overlaps(a.rect, b.rect)).toBe(false);
    });
  }

  it('groups screen: the bottom row is Space, Reset gaze, Done, each one cell wide', () => {
    const { keys } = layoutKeyboard(screen, null);
    const bottom = keys.filter(({ rect }) => rect.y === Math.max(...keys.map((key) => key.rect.y)));
    expect(bottom.map(({ id, label }) => [id, label])).toEqual([
      ['space', 'Space'],
      ['reset', 'Reset gaze'],
      ['done', 'Done'],
    ]);
    expect(new Set(bottom.map(({ rect }) => rect.width)).size).toBe(1);
  });
});
