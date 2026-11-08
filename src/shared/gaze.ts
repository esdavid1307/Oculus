import type { Screen } from './geometry';

// The agreed gaze event format. See docs/gaze-events.md.

export type GazeRegion = { x: number; y: number; radius: number };

export type GazeEvent = { type: 'gaze'; t: number; region: GazeRegion | null };

export function offScreen(region: GazeRegion | null, { width, height }: Screen) {
  return region === null || region.x < 0 || region.x > width || region.y < 0 || region.y > height;
}

// The dev mouse input. A cursor outside the display is no gaze at all, as when the camera loses the user's face, so
// Look Away can be tested with a second display. lookingAway is the dev shortcut that stands in for that on one display.
export function mouseRegion(cursor: { x: number; y: number }, { x, y, width, height }: Screen & { x: number; y: number }, radius: number, lookingAway = false): GazeRegion | null {
  const inside = cursor.x >= x && cursor.x < x + width && cursor.y >= y && cursor.y < y + height;
  return lookingAway || !inside ? null : { x: cursor.x - x, y: cursor.y - y, radius };
}
