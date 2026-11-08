import { describe, expect, it } from 'vitest';
import type { Rect } from './geometry';
import { magnify, MIN_TARGET, planDock, readLargeView, readSavedDock } from './large-view';

const screen = { width: 1600, height: 1000 };

describe('readLargeView', () => {
  it('is on with defaults when nothing is set', () => {
    for (const settings of [undefined, null, {}, 'junk', 7])
      expect(readLargeView(settings)).toEqual({ enabled: true, uiScale: 1.25, dockIconSize: 96 });
  });

  it('turns off only for largeView: false', () => {
    expect(readLargeView({ largeView: false }).enabled).toBe(false);
    expect(readLargeView({ largeView: 'no' }).enabled).toBe(true);
    expect(readLargeView({ largeView: true }).enabled).toBe(true);
  });

  it('clamps the UI scale to 1 to 2', () => {
    expect(readLargeView({ uiScale: 1.5 }).uiScale).toBe(1.5);
    expect(readLargeView({ uiScale: 0.2 }).uiScale).toBe(1);
    expect(readLargeView({ uiScale: 9 }).uiScale).toBe(2);
  });

  it('clamps the Dock icon size to 48 to 128', () => {
    expect(readLargeView({ dockIconSize: 80 }).dockIconSize).toBe(80);
    expect(readLargeView({ dockIconSize: 10 }).dockIconSize).toBe(48);
    expect(readLargeView({ dockIconSize: 500 }).dockIconSize).toBe(128);
    expect(readLargeView({ dockIconSize: 80.6 }).dockIconSize).toBe(81);
  });

  it('falls back to the default for values that are not usable numbers', () => {
    for (const bad of ['big', null, NaN, Infinity, {}, [], true])
      expect(readLargeView({ uiScale: bad, dockIconSize: bad })).toEqual({ enabled: true, uiScale: 1.25, dockIconSize: 96 });
  });
});

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.width <= screen.width && r.y + r.height <= screen.height;

// One small icon on each edge and in each corner, plus the middle.
const icons: Record<string, Rect> = {
  'bottom Dock': { x: 700, y: 920, width: 60, height: 80 },
  'bottom left corner': { x: 0, y: 940, width: 60, height: 60 },
  'bottom right corner': { x: 1540, y: 940, width: 60, height: 60 },
  'left Dock': { x: 0, y: 480, width: 80, height: 60 },
  'right Desktop icon': { x: 1500, y: 300, width: 90, height: 90 },
  'menu bar item': { x: 800, y: 0, width: 40, height: 22 },
  'top left corner': { x: 0, y: 0, width: 30, height: 22 },
  'top right corner': { x: 1570, y: 0, width: 30, height: 22 },
  'menu command': { x: 100, y: 22, width: 220, height: 22 },
  'middle of the screen': { x: 780, y: 480, width: 40, height: 40 },
};

describe('magnify', () => {
  for (const scale of [1, 1.25, 2])
    for (const [name, icon] of Object.entries(icons))
      describe(`${name} at scale ${scale}`, () => {
        const { frame, panel } = magnify(icon, screen, scale);

        it('grows the frame to at least the minimum, around the icon', () => {
          expect(frame.width).toBeGreaterThanOrEqual(Math.min(MIN_TARGET * scale, icon.width) );
          expect(frame.width).toBeGreaterThanOrEqual(MIN_TARGET * scale);
          expect(frame.height).toBeGreaterThanOrEqual(MIN_TARGET * scale);
          expect(frame.width).toBeGreaterThanOrEqual(icon.width);
          expect(frame.height).toBeGreaterThanOrEqual(icon.height);
        });

        it('keeps the frame and panel on the screen', () => {
          expect(inside(frame)).toBe(true);
          expect(inside(panel)).toBe(true);
        });

        it('covers the whole icon and never overlaps it with the panel', () => {
          expect(frame.x).toBeLessThanOrEqual(icon.x);
          expect(frame.y).toBeLessThanOrEqual(icon.y);
          expect(frame.x + frame.width).toBeGreaterThanOrEqual(icon.x + icon.width);
          expect(frame.y + frame.height).toBeGreaterThanOrEqual(icon.y + icon.height);
          expect(overlaps(panel, icon)).toBe(false);
          expect(overlaps(panel, frame)).toBe(false);
        });
      });

  it('centres the frame on an icon away from the edges', () => {
    const { frame } = magnify(icons['middle of the screen'], screen, 1);
    expect(frame.x + frame.width / 2).toBe(800);
    expect(frame.y + frame.height / 2).toBe(500);
  });

  it('keeps an icon that is bigger than the minimum at its own size', () => {
    const wide = { x: 100, y: 22, width: 400, height: 22 };
    expect(magnify(wide, screen, 1).frame.width).toBe(400);
  });

  it('puts the panel on the other side of the screen from the icon', () => {
    expect(magnify(icons['bottom Dock'], screen, 1.25).panel.y).toBeLessThan(500);
    expect(magnify(icons['menu bar item'], screen, 1.25).panel.y).toBeGreaterThan(500);
  });

  it('copes with a screen smaller than the minimum', () => {
    const { frame } = magnify({ x: 10, y: 10, width: 10, height: 10 }, { width: 80, height: 60 }, 2);
    expect(frame).toEqual({ x: 0, y: 0, width: 60, height: 60 });
  });
});

describe('planDock', () => {
  it('grows the Dock and saves the original when nothing is saved', () => {
    expect(planDock(true, undefined)).toEqual({ type: 'grow', saveOriginal: true });
  });

  it('keeps the saved original after a crash', () => {
    expect(planDock(true, { tilesize: 48 })).toEqual({ type: 'grow', saveOriginal: false });
    expect(planDock(true, { tilesize: null })).toEqual({ type: 'grow', saveOriginal: false });
  });

  it('restores a saved size when Large View is off, including an unset one', () => {
    expect(planDock(false, { tilesize: 48 })).toEqual({ type: 'restore', tilesize: 48 });
    expect(planDock(false, { tilesize: null })).toEqual({ type: 'restore', tilesize: null });
  });

  it('leaves the Dock alone when Large View is off and nothing is saved', () => {
    expect(planDock(false, undefined)).toEqual({ type: 'leave' });
  });
});

describe('readSavedDock', () => {
  it('reads a size or null, and treats anything else as nothing saved', () => {
    expect(readSavedDock({ tilesize: 64 })).toEqual({ tilesize: 64 });
    expect(readSavedDock({ tilesize: null })).toEqual({ tilesize: null });
    for (const bad of [undefined, {}, { tilesize: 'x' }, { tilesize: -1 }, { tilesize: 0 }, [], 3])
      expect(readSavedDock(bad)).toBeUndefined();
  });
});
