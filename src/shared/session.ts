import type { GazeEvent, GazeRegion } from './gaze';
import { contains, type Rect, type Screen } from './geometry';
import { GROUPS, layoutIntents, layoutKeyboard, type KeyId } from './keyboard';

export type KeyDwell = { key: KeyId; progress: number };

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target' | 'thinking'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; dwell: KeyDwell | null }
  | { phase: 'choosing'; wakeProgress: number; intents: string[]; dwell: KeyDwell | null }
  | { phase: 'running'; wakeProgress: number; intent: string };

export type SessionInput =
  | GazeEvent
  | { type: 'tick'; t: number }
  | { type: 'open-keyboard'; t: number }
  // The model's answer to a suggest-intents request.
  | { type: 'intents'; t: number; intents: string[] };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction =
  | { type: 'type-text'; text: string }
  | { type: 'suggest-intents'; region: GazeRegion }
  | { type: 'run-intent'; intent: string };

const MAX_INTENTS = 3;

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, keyDwellMs: 1000, targetHoldMs: 1000 };

type Timings = typeof DEFAULT_TIMINGS;

// Timings come from a file the user edits, so anything unusable falls back to its default.
function parseTimings(raw: unknown): Timings {
  const timing = (key: keyof Timings) => {
    const value = (raw as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' && value > 0 ? value : DEFAULT_TIMINGS[key];
  };
  return { wakeHoldMs: timing('wakeHoldMs'), lookAwayMs: timing('lookAwayMs'), keyDwellMs: timing('keyDwellMs'), targetHoldMs: timing('targetHoldMs') };
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

export function createSession({
  screen,
  timings,
  act = () => {},
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
}) {
  const { wakeHoldMs, lookAwayMs, keyDwellMs, targetHoldMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  // The Gaze Region where the user started holding on a target after waking.
  let target: { region: GazeRegion; start: number } | null = null;
  let text = '';
  let group: string | null = null;
  let intents: string[] = [];
  // The target the model was asked about, so Something else can ask again.
  let asked: GazeRegion | null = null;
  let intent = '';
  // The dwell follows a key's place on screen, so a key that appears under the gaze after a press waits for a Move Off.
  let dwell: { rect: Rect; key: KeyId | null; start: number; pressed: boolean; progress: number } | null = null;

  function keyAt(region: GazeRegion | null) {
    if (region === null) return undefined;
    const keys = phase === 'choosing' ? layoutIntents(screen, intents) : layoutKeyboard(screen, group).keys;
    return keys.find(({ rect }) => contains(rect, region.x, region.y));
  }

  function openKeyboard() {
    phase = 'typing';
    holdStart = null;
    wakeProgress = 0;
    text = '';
    group = null;
    dwell = null;
  }

  function press(key: KeyId) {
    if (phase === 'choosing') choose(key);
    else if (GROUPS.includes(key)) group = key;
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

  function suggestIntents(region: GazeRegion) {
    asked = region;
    act({ type: 'suggest-intents', region });
    phase = 'thinking';
  }

  function choose(key: KeyId) {
    if (key === 'something-else') return suggestIntents(asked!);
    intent = intents[Number(key.replace('intent-', ''))];
    act({ type: 'run-intent', intent });
    phase = 'running';
  }

  // A key presses once per look. Typing the same letter twice takes a Move Off and back.
  function dwellOn(region: GazeRegion | null, t: number) {
    const key = keyAt(region);
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
      const before = { group, phase };
      press(key.id);
      // The key under the gaze changed, so nothing on screen is filling.
      if (group !== before.group || phase !== before.phase) dwell.key = null;
    }
  }

  function holdTarget(region: GazeRegion | null, t: number) {
    if (region === null || offScreen(region, screen)) {
      target = null;
      return;
    }
    // Jitter inside the first Gaze Region still counts as the same target.
    const moved = target && Math.hypot(region.x - target.region.x, region.y - target.region.y) > target.region.radius;
    if (target === null || moved) target = { region, start: t };
    if (t - target.start >= targetHoldMs) {
      suggestIntents(target.region);
      target = null;
    }
  }

  function state(): OverlayState {
    const shown = dwell?.key ? { key: dwell.key, progress: dwell.progress } : null;
    if (phase === 'typing') return { phase, wakeProgress, text, group, dwell: shown };
    if (phase === 'choosing') return { phase, wakeProgress, intents, dwell: shown };
    if (phase === 'running') return { phase, wakeProgress, intent };
    return { phase, wakeProgress };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard();
    } else if (input.type === 'intents') {
      if (phase === 'thinking') {
        phase = 'choosing';
        intents = input.intents.slice(0, MAX_INTENTS);
      }
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') awaySince = offScreen(input.region, screen) ? (awaySince ?? input.t) : null;
      // The Stop Gesture closes the Gaze Keyboard without typing the text.
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        phase = 'idle';
        awaySince = null;
      } else if ((phase === 'typing' || phase === 'choosing') && input.type === 'gaze') dwellOn(input.region, input.t);
      else if (phase === 'waiting-for-target' && input.type === 'gaze') holdTarget(input.region, input.t);
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
        // A target hold cut short last time, for example by the Gaze Keyboard, must not carry over.
        target = null;
      }
    }
    return state();
  };
}
