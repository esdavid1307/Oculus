import type { Screen } from './geometry';

// The agreed gaze event format. See docs/gaze-events.md.

export type GazeRegion = { x: number; y: number; radius: number };

export type GazeEvent = { type: 'gaze'; t: number; region: GazeRegion | null };

export function offScreen(region: GazeRegion | null, { width, height }: Screen) {
  return region === null || region.x < 0 || region.x > width || region.y < 0 || region.y > height;
}
