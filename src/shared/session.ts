import type { GazeEvent, GazeRegion } from './gaze';
import { contains, cornerTargets, overlaps, type Screen } from './geometry';
import { layoutKeyboard, type KeyId } from './keyboard';

export { CORNER_TARGET_SIZE } from './geometry';

export type KeyDwell = { key: KeyId; progress: number };

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; dwell: KeyDwell | null };

export type SessionInput = GazeEvent | { type: 'tick'; t: number } | { type: 'open-keyboard'; t: number };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction = { type: 'type-text'; text: string };

const DEFAULT_TIMINGS = { wakeHoldMs: 2000, targetTimeoutMs: 5000, keyDwellMs: 1000 };

type Timings = typeof DEFAULT_TIMINGS;

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown): Timings {
  const timing = (key: keyof Timings) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return { wakeHoldMs: timing('wakeHoldMs'), targetTimeoutMs: timing('targetTimeoutMs'), keyDwellMs: timing('keyDwellMs') };
}

export function createSession({
  screen,
  timings,
  act = () => {},
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
}) {
  const { wakeHoldMs, targetTimeoutMs, keyDwellMs } = parseTimings(timings);
  const corners = cornerTargets(screen);
  const { keys } = layoutKeyboard(screen);

  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let wokenAt = 0;
  let text = '';
  let dwell: (KeyDwell & { start: number; pressed: boolean }) | null = null;

  // Gaze on a corner target belongs to that target, so it never presses a key.
  function keyAt(region: GazeRegion | null) {
    if (region === null || overlaps(region, corners.wake) || overlaps(region, corners.stop)) return null;
    return keys.find(({ rect }) => contains(rect, region.x, region.y))?.id ?? null;
  }

  function openKeyboard() {
    phase = 'typing';
    holdStart = null;
    wakeProgress = 0;
    text = '';
    dwell = null;
  }

  function press(key: KeyId) {
    if (key === 'delete') text = text.slice(0, -1);
    else if (key === 'space') text += ' ';
    else if (key === 'done') {
      if (text !== '') act({ type: 'type-text', text });
      phase = 'idle';
    } else text += key;
  }

  // A key presses once per look. Typing the same letter twice takes a look away and back.
  function dwellOn(key: KeyId | null, t: number) {
    if (key === null) {
      dwell = null;
      return;
    }
    if (dwell?.key !== key) dwell = { key, start: t, pressed: false, progress: 0 };
    if (dwell.pressed) return;
    dwell.progress = Math.min((t - dwell.start) / keyDwellMs, 1);
    if (dwell.progress === 1) {
      dwell.pressed = true;
      press(key);
    }
  }

  function state(): OverlayState {
    if (phase !== 'typing') return { phase, wakeProgress };
    return { phase, wakeProgress, text, dwell: dwell && { key: dwell.key, progress: dwell.progress } };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard();
    } else if (phase === 'typing') {
      if (input.type === 'gaze') dwellOn(keyAt(input.region), input.t);
    } else if (phase === 'waiting-for-target') {
      if (input.t - wokenAt >= targetTimeoutMs) phase = 'idle';
    } else if (input.type === 'gaze') {
      if (overlaps(input.region, corners.wake)) {
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
    return state();
  };
}
