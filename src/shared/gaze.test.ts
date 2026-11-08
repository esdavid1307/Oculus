import { describe, expect, it } from 'vitest';
import { mouseRegion } from './gaze';

describe('mouseRegion', () => {
  const display = { x: 100, y: 50, width: 1600, height: 1000 };

  it('puts the cursor in display coordinates', () => {
    expect(mouseRegion({ x: 300, y: 250 }, display, 60)).toEqual({ x: 200, y: 200, radius: 60 });
  });

  it('is null when the cursor is outside the display, on any side', () => {
    for (const cursor of [{ x: 99, y: 500 }, { x: 1700, y: 500 }, { x: 800, y: 49 }, { x: 800, y: 1050 }, { x: -500, y: -500 }])
      expect(mouseRegion(cursor, display, 60)).toBeNull();
  });

  it('counts the top-left pixel as inside and the far edge as outside', () => {
    expect(mouseRegion({ x: 100, y: 50 }, display, 60)).toEqual({ x: 0, y: 0, radius: 60 });
    expect(mouseRegion({ x: 1700, y: 1049 }, display, 60)).toBeNull();
  });

  it('is null while the Look Away shortcut is on', () => {
    expect(mouseRegion({ x: 300, y: 250 }, display, 60, true)).toBeNull();
  });
});
