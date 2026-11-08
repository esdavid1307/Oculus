// The agreed gaze event format. See docs/gaze-events.md.

export type GazeRegion = { x: number; y: number; radius: number };

export type GazeEvent = { type: 'gaze'; t: number; region: GazeRegion | null };

// Real tracking started a new calibration, so anything learned from the old one no longer applies.
export type RecalibratedEvent = { type: 'recalibrated'; t: number };

export type Position = { x: number; y: number };

// One confirmed selection for Gaze Correction: where the uncorrected gaze was, and the centre of what the user chose.
export type GazeExample = { gaze: Position; target: Position };
