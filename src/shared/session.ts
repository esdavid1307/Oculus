import { offScreen, type GazeEvent, type GazeRegion } from './gaze';
import { contains, type Rect, type Screen } from './geometry';
import { GROUPS, layoutKeyboard, type KeyId } from './keyboard';
import { createGazeSnap } from './snap';

export type KeyDwell = { key: KeyId; progress: number };

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; dwell: KeyDwell | null; snapped: KeyId | null };

export type SessionInput = GazeEvent | { type: 'tick'; t: number } | { type: 'open-keyboard'; t: number };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction = { type: 'type-text'; text: string };

// The Gaze Snap release distance is in px, but lives here with the timings so the same file configures it.
const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, keyDwellMs: 1000, snapReleasePx: 120, snapReleaseMs: 300 };

type Timings = typeof DEFAULT_TIMINGS;

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown): Timings {
  const timing = (key: keyof Timings) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return Object.fromEntries(Object.keys(DEFAULT_TIMINGS).map((key) => [key, timing(key as keyof Timings)])) as Timings;
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
  const { wakeHoldMs, lookAwayMs, keyDwellMs, snapReleasePx, snapReleaseMs } = parseTimings(timings);
  const newSnap = () => createGazeSnap(screen, { releasePx: snapReleasePx, releaseMs: snapReleaseMs });
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  let text = '';
  let group: string | null = null;
  // The dwell follows a key's place on screen, so a key that appears under the gaze after a press waits for a Move Off.
  let dwell: { rect: Rect; key: KeyId | null; start: number; pressed: boolean; progress: number } | null = null;
  // Gaze Snap only runs on the Gaze Keyboard, the only overlay elements so far, so it is off while idle.
  let snap = newSnap();
  let snapped: KeyId | null = null;

  // While snapped, the snapped key takes the dwell. Keys too large to snap still dwell under the gaze.
  function keyAt(region: GazeRegion | null, t: number) {
    const { keys } = layoutKeyboard(screen, group);
    const rect = snap(t, region, keys.map((key) => key.rect));
    const key = keys.find((key) => (rect ? key.rect === rect : region !== null && contains(key.rect, region.x, region.y)));
    snapped = rect && key ? key.id : null;
    return key;
  }

  function openKeyboard() {
    phase = 'typing';
    holdStart = null;
    wakeProgress = 0;
    text = '';
    group = null;
    dwell = null;
    snap = newSnap();
    snapped = null;
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

  // A key presses once per look. Typing the same letter twice takes a Move Off and back.
  function dwellOn(region: GazeRegion | null, t: number) {
    const key = keyAt(region, t);
    if (key === undefined) {
      dwell = null;
      return;
    }
    if (dwell?.rect.x !== key.rect.x || dwell.rect.y !== key.rect.y) {
      dwell = { rect: key.rect, key: key.id, start: t, pressed: false, progress: 0 };
    }
    if (dwell.pressed) return;
    dwell.progress = Math.min((t - dwell.start) / keyDwellMs, 1);
    if (dwell.progress === 1) {
      dwell.pressed = true;
      const before = group;
      press(key.id);
      // The key under the gaze changed, so nothing on screen is filling.
      if (group !== before) dwell.key = null;
    }
  }

  function state(): OverlayState {
    if (phase !== 'typing') return { phase, wakeProgress };
    const shown = dwell?.key ? { key: dwell.key, progress: dwell.progress } : null;
    return { phase, wakeProgress, text, group, dwell: shown, snapped };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard();
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') awaySince = offScreen(input.region, screen) ? (awaySince ?? input.t) : null;
      // The Stop Gesture closes the Gaze Keyboard without typing the text.
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        phase = 'idle';
        awaySince = null;
      } else if (phase === 'typing' && input.type === 'gaze') dwellOn(input.region, input.t);
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
