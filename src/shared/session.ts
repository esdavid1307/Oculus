import type { GazeEvent, GazeExample, GazeRegion, RecalibratedEvent } from './gaze';
import { contains, type Rect, type Screen } from './geometry';
import { GROUPS, layoutKeyboard, type KeyId } from './keyboard';

export type KeyDwell = { key: KeyId; progress: number };

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; dwell: KeyDwell | null };

export type SessionInput = GazeEvent | RecalibratedEvent | { type: 'tick'; t: number } | { type: 'open-keyboard'; t: number };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction =
  | { type: 'type-text'; text: string }
  | { type: 'learn-gaze'; examples: GazeExample[] }
  | { type: 'reset-gaze-correction' };

// Gaze Correction, applied to every Gaze Region before it's hit-tested.
export type CorrectGaze = (region: GazeRegion) => GazeRegion;

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, keyDwellMs: 1000 };
// Resetting throws away everything learned, so it takes a longer look than a key.
const RESET_DWELL_FACTOR = 2;

type Timings = typeof DEFAULT_TIMINGS;

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown): Timings {
  const timing = (key: keyof Timings) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return { wakeHoldMs: timing('wakeHoldMs'), lookAwayMs: timing('lookAwayMs'), keyDwellMs: timing('keyDwellMs') };
}

// The box is 50vmin, as drawn in overlay.css. The centre must be inside, so a large radius can't start a hold.
function onCentreBox(region: GazeRegion | null, { width, height }: Screen) {
  if (region === null) return false;
  const half = Math.min(width, height) / 4;
  return Math.abs(region.x - width / 2) <= half && Math.abs(region.y - height / 2) <= half;
}

function offScreen(region: GazeRegion | null, { width, height }: Screen) {
  return region === null || region.x < 0 || region.x > width || region.y < 0 || region.y > height;
}

const centreOf = ({ x, y, width, height }: Rect) => ({ x: x + width / 2, y: y + height / 2 });

export function createSession({
  screen,
  timings,
  act = () => {},
  correct = (region) => region,
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
  correct?: CorrectGaze;
}) {
  const { wakeHoldMs, lookAwayMs, keyDwellMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  let text = '';
  let group: string | null = null;
  // The dwell follows a key's place on screen, so a key that appears under the gaze after a press waits for a Move Off.
  // It also sums the uncorrected gaze, which becomes a Gaze Correction example if the press is confirmed.
  let dwell: { rect: Rect; key: KeyId | null; start: number; pressed: boolean; progress: number; sumX: number; sumY: number; samples: number } | null =
    null;
  // Selections only teach Gaze Correction once Done confirms them. One entry per typed character, so Delete
  // drops the presses of the character it removes, and Back drops the group it backs out of.
  let perCharacter: GazeExample[][] = [];
  let groupPress: GazeExample | null = null;
  let otherPresses: GazeExample[] = [];

  function keyAt(region: GazeRegion | null) {
    if (region === null) return undefined;
    return layoutKeyboard(screen, group).keys.find(({ rect }) => contains(rect, region.x, region.y));
  }

  function openKeyboard() {
    phase = 'typing';
    holdStart = null;
    wakeProgress = 0;
    text = '';
    group = null;
    dwell = null;
    perCharacter = [];
    groupPress = null;
    otherPresses = [];
  }

  function stop() {
    phase = 'idle';
    holdStart = null;
    wakeProgress = 0;
    awaySince = null;
    dwell = null;
  }

  function press(key: KeyId, example: GazeExample) {
    if (GROUPS.includes(key)) {
      group = key;
      groupPress = example;
    } else if (key === 'back') {
      group = null;
      groupPress = null;
      otherPresses.push(example);
    } else if (key === 'delete') {
      if (text !== '') perCharacter.pop();
      text = text.slice(0, -1);
      otherPresses.push(example);
    } else if (key === 'space') {
      text += ' ';
      perCharacter.push([example]);
    } else if (key === 'reset') {
      // Selections made before the reset were judged with the correction being thrown away.
      perCharacter = perCharacter.map(() => []);
      groupPress = null;
      otherPresses = [];
      act({ type: 'reset-gaze-correction' });
    } else if (key === 'done') {
      if (text !== '') act({ type: 'type-text', text });
      const examples = [...perCharacter.flat(), ...otherPresses, example];
      act({ type: 'learn-gaze', examples });
      stop();
    } else {
      text += key;
      perCharacter.push(groupPress ? [groupPress, example] : [example]);
      groupPress = null;
      group = null;
    }
  }

  // A key presses once per look. Typing the same letter twice takes a Move Off and back.
  function dwellOn(region: GazeRegion | null, raw: GazeRegion | null, t: number) {
    const key = keyAt(region);
    if (key === undefined || raw === null) {
      dwell = null;
      return;
    }
    if (dwell?.rect.x !== key.rect.x || dwell.rect.y !== key.rect.y) {
      dwell = { rect: key.rect, key: key.id, start: t, pressed: false, progress: 0, sumX: 0, sumY: 0, samples: 0 };
    }
    if (dwell.pressed) return;
    dwell.sumX += raw.x;
    dwell.sumY += raw.y;
    dwell.samples += 1;
    const needed = key.id === 'reset' ? keyDwellMs * RESET_DWELL_FACTOR : keyDwellMs;
    dwell.progress = Math.min((t - dwell.start) / needed, 1);
    if (dwell.progress === 1) {
      dwell.pressed = true;
      const before = group;
      const example = { gaze: { x: dwell.sumX / dwell.samples, y: dwell.sumY / dwell.samples }, target: centreOf(key.rect) };
      press(key.id, example);
      // The key under the gaze changed, so nothing on screen is filling.
      if (group !== before && dwell) dwell.key = null;
    }
  }

  function state(): OverlayState {
    if (phase !== 'typing') return { phase, wakeProgress };
    const shown = dwell?.key ? { key: dwell.key, progress: dwell.progress } : null;
    return { phase, wakeProgress, text, group, dwell: shown };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'recalibrated') {
      // Recalibrating counts as a Stop: typed text is discarded, and so is everything learned.
      stop();
      act({ type: 'reset-gaze-correction' });
      return state();
    }
    const raw = input.type === 'gaze' ? input.region : null;
    const region = raw && correct(raw);
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard();
    } else if (phase !== 'idle') {
      // Look Away uses the uncorrected gaze, so a learned shift can never push it on or off the screen.
      if (input.type === 'gaze') awaySince = offScreen(raw, screen) ? (awaySince ?? input.t) : null;
      // The Stop Gesture closes the Gaze Keyboard without typing the text.
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) stop();
      else if (phase === 'typing' && input.type === 'gaze') dwellOn(region, raw, input.t);
    } else if (input.type === 'gaze') {
      if (onCentreBox(region, screen)) {
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
