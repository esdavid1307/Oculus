import { offScreen, type GazeEvent, type GazeRegion } from './gaze';
import type { Screen } from './geometry';
import { GROUPS, layoutKeyboard, type KeyId } from './keyboard';

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; highlight: KeyId };

// A select comes from a Select Blink, which real tracking detects outside the GazeEvent format.
export type SessionInput = GazeEvent | { type: 'tick' | 'open-keyboard' | 'select'; t: number };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction = { type: 'type-text'; text: string };

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, scanStepMs: 2000 };

type Timings = typeof DEFAULT_TIMINGS;

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown): Timings {
  const timing = (key: keyof Timings) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return {
    wakeHoldMs: timing('wakeHoldMs'),
    lookAwayMs: timing('lookAwayMs'),
    scanStepMs: timing('scanStepMs'),
  };
}

// The box is 50vmin, as drawn in overlay.css. The centre must be inside, so a large radius can't start a hold.
function onCentreBox(region: GazeRegion | null, { width, height }: Screen) {
  if (region === null) return false;
  const half = Math.min(width, height) / 4;
  return Math.abs(region.x - width / 2) <= half && Math.abs(region.y - height / 2) <= half;
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
  const { wakeHoldMs, lookAwayMs, scanStepMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  let text = '';
  let group: string | null = null;
  // The Gaze Keyboard scans: the highlight steps through the keys in order, from the first key after every press.
  let scanStart = 0;
  let highlight: KeyId = '';

  function scan(t: number) {
    const { keys } = layoutKeyboard(screen, group);
    highlight = keys[Math.floor(Math.max(t - scanStart, 0) / scanStepMs) % keys.length].id;
  }

  function openKeyboard(t: number) {
    phase = 'typing';
    holdStart = null;
    wakeProgress = 0;
    text = '';
    group = null;
    scanStart = t;
    scan(t);
  }

  function press(key: KeyId) {
    if (GROUPS.includes(key)) group = key;
    else if (key === 'back') group = null;
    else if (key === 'delete') text = text.slice(0, -1);
    else if (key === 'space') text += ' ';
    else if (key === 'done') {
      if (text !== '') act({ type: 'type-text', text });
      phase = 'idle';
    } else {
      text += key;
      group = null;
    }
  }

  function state(): OverlayState {
    if (phase !== 'typing') return { phase, wakeProgress };
    return { phase, wakeProgress, text, group, highlight };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard(input.t);
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') awaySince = offScreen(input.region, screen) ? (awaySince ?? input.t) : null;
      // The Stop Gesture closes the Gaze Keyboard without typing the text.
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        phase = 'idle';
        awaySince = null;
      } else if (phase === 'typing') {
        scan(input.t);
        if (input.type === 'select') {
          press(highlight);
          scanStart = input.t;
          scan(input.t);
        }
      }
    } else if (input.type === 'gaze') {
      if (onCentreBox(input.region, screen)) {
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
    return state();
  };
}
