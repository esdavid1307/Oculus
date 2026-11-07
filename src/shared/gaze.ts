// The agreed gaze event format. See docs/gaze-events.md.

export type GazeRegion = { x: number; y: number; radius: number };

export type GazeEvent = { type: 'gaze'; t: number; region: GazeRegion | null };
