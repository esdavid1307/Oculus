import type { GazeRegion } from './gaze';

export const CORNER_TARGET_SIZE = 240;

export type Screen = { width: number; height: number };

export type Rect = { x: number; y: number; width: number; height: number };

export function cornerTargets({ width, height }: Screen) {
  const size = CORNER_TARGET_SIZE;
  return {
    wake: { x: width - size, y: 0, width: size, height: size },
    stop: { x: 0, y: height - size, width: size, height: size },
  };
}

// A Gaze Region is on a rect when any part of it overlaps the rect.
export function overlaps(region: GazeRegion | null, rect: Rect) {
  if (region === null) return false;
  const dx = Math.max(rect.x - region.x, 0, region.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - region.y, 0, region.y - (rect.y + rect.height));
  return Math.hypot(dx, dy) <= region.radius;
}

export function contains(rect: Rect, x: number, y: number) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
