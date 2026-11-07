import { describe, expect, it } from 'vitest';
import { createGazeSnap } from './snap';

const screen = { width: 1600, height: 1000 };
const options = { releasePx: 120, releaseMs: 300 };
const key = { x: 100, y: 100, width: 300, height: 200 };
const at = (x: number, y: number) => ({ x, y, radius: 120 });

describe('Gaze Snap', () => {
  it('snaps to the element under the Gaze Region centre', () => {
    const snap = createGazeSnap(screen, options);
    expect(snap(0, at(1000, 800), [key])).toBeUndefined();
    expect(snap(100, at(200, 150), [key])).toBe(key);
  });

  it('stays snapped through jitter past the edge', () => {
    const snap = createGazeSnap(screen, options);
    snap(0, at(200, 150), [key]);
    expect(snap(100, at(510, 150), [key])).toBe(key);
    expect(snap(5000, at(420, 310), [key])).toBe(key);
  });

  it('stays snapped through a glance shorter than 300 ms', () => {
    const snap = createGazeSnap(screen, options);
    const other = { x: 800, y: 100, width: 300, height: 200 };
    snap(0, at(200, 150), [key, other]);
    snap(100, at(900, 150), [key, other]);
    expect(snap(399, at(900, 150), [key, other])).toBe(key);
    expect(snap(450, at(200, 150), [key, other])).toBe(key);
    expect(snap(800, at(900, 150), [key, other])).toBe(key);
  });

  it('lets go after 300 ms more than 120 px past the edge, and snaps to what is there', () => {
    const snap = createGazeSnap(screen, options);
    const other = { x: 800, y: 100, width: 300, height: 200 };
    snap(0, at(200, 150), [key, other]);
    snap(100, at(900, 150), [key, other]);
    expect(snap(400, at(900, 150), [key, other])).toBe(other);
  });

  it('measures past the corner as a straight line', () => {
    const snap = createGazeSnap(screen, options);
    snap(0, at(200, 150), [key]);
    // 90 px right and 90 px below the corner is 127 px away.
    snap(100, at(490, 390), [key]);
    expect(snap(400, at(490, 390), [key])).toBeUndefined();
  });

  it('uses configured release distance and time', () => {
    const snap = createGazeSnap(screen, { releasePx: 50, releaseMs: 100 });
    snap(0, at(200, 150), [key]);
    snap(100, at(460, 150), [key]);
    expect(snap(200, at(460, 150), [key])).toBeUndefined();
  });

  it.each([[null], [at(200, -1)], [at(1601, 150)]])('breaks at once on %j', (region) => {
    const snap = createGazeSnap(screen, options);
    snap(0, at(200, 150), [key]);
    expect(snap(1, region, [key])).toBeUndefined();
    expect(snap(2, at(450, 150), [key])).toBeUndefined();
  });

  it('lets go when the element is gone, and keeps an identical one', () => {
    const snap = createGazeSnap(screen, options);
    snap(0, at(200, 150), [key]);
    expect(snap(1, at(200, 150), [{ ...key }])).toEqual(key);
    expect(snap(2, at(450, 150), [])).toBeUndefined();
  });

  it('never snaps to an element larger than a quarter of the screen', () => {
    const snap = createGazeSnap(screen, options);
    const panel = { x: 0, y: 0, width: 801, height: 500 };
    expect(snap(0, at(400, 250), [panel])).toBeUndefined();
    expect(snap(0, at(400, 250), [{ ...panel, width: 800 }])).toEqual({ ...panel, width: 800 });
  });
});
