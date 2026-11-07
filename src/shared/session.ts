import type { GazeEvent, GazeRegion } from './gaze';

export type OverlayState = { phase: 'idle' | 'waiting-for-target'; wakeProgress: number };

export type SessionInput = GazeEvent | { type: 'tick'; t: number };

type Screen = { width: number; height: number };

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000 };

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown) {
  const timing = (key: keyof typeof DEFAULT_TIMINGS) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return { wakeHoldMs: timing('wakeHoldMs'), lookAwayMs: timing('lookAwayMs') };
}

// The box is 50vmin, as drawn in overlay.css. The centre must be inside, so a large radius can't start a hold.
function onStartBox(region: GazeRegion | null, { width, height }: Screen) {
  if (region === null) return false;
  const half = Math.min(width, height) / 4;
  return Math.abs(region.x - width / 2) <= half && Math.abs(region.y - height / 2) <= half;
}

function offScreen(region: GazeRegion | null, { width, height }: Screen) {
  return region === null || region.x < 0 || region.x > width || region.y < 0 || region.y > height;
}

export function createSession({ screen, timings }: { screen: Screen; timings?: unknown }) {
  const { wakeHoldMs, lookAwayMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;

  return (input: SessionInput): OverlayState => {
    if (phase === 'waiting-for-target') {
      if (input.type === 'gaze') awaySince = offScreen(input.region, screen) ? (awaySince ?? input.t) : null;
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        phase = 'idle';
        awaySince = null;
      }
    } else if (input.type === 'gaze') {
      if (onStartBox(input.region, screen)) {
        holdStart ??= input.t;
        wakeProgress = Math.min((input.t - holdStart) / wakeHoldMs, 1);
      } else {
        holdStart = null;
        wakeProgress = 0;
      }
      if (wakeProgress === 1) {
        phase = 'waiting-for-target';
        holdStart = null;
        wakeProgress = 0;
      }
    }
    return { phase, wakeProgress };
  };
}
