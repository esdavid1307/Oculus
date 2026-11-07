import type { GazeEvent, GazeRegion } from './gaze';

export const CORNER_TARGET_SIZE = 240;

export type OverlayState = { phase: 'idle' | 'waiting-for-target'; wakeProgress: number };

export type SessionInput = GazeEvent | { type: 'tick'; t: number };

type Screen = { width: number; height: number };

const DEFAULT_TIMINGS = { wakeHoldMs: 2000, targetTimeoutMs: 5000 };

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown) {
  const timing = (key: keyof typeof DEFAULT_TIMINGS) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return { wakeHoldMs: timing('wakeHoldMs'), targetTimeoutMs: timing('targetTimeoutMs') };
}

function overlapsWakeTarget(region: GazeRegion | null, screen: Screen) {
  if (region === null) return false;
  const left = Math.max(screen.width - CORNER_TARGET_SIZE - region.x, 0);
  const below = Math.max(region.y - CORNER_TARGET_SIZE, 0);
  return Math.hypot(left, below) <= region.radius;
}

export function createSession({ screen, timings }: { screen: Screen; timings?: unknown }) {
  const { wakeHoldMs, targetTimeoutMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let wokenAt = 0;

  return (input: SessionInput): OverlayState => {
    if (phase === 'waiting-for-target') {
      if (input.t - wokenAt >= targetTimeoutMs) phase = 'idle';
    } else if (input.type === 'gaze') {
      if (overlapsWakeTarget(input.region, screen)) {
        holdStart ??= input.t;
        wakeProgress = Math.min((input.t - holdStart) / wakeHoldMs, 1);
      } else {
        holdStart = null;
        wakeProgress = 0;
      }
      if (wakeProgress === 1) {
        phase = 'waiting-for-target';
        wokenAt = input.t;
        holdStart = null;
        wakeProgress = 0;
      }
    }
    return { phase, wakeProgress };
  };
}
