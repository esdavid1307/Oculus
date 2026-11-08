import { offScreen, type GazeEvent, type GazeRegion } from './gaze';
import type { Screen } from './geometry';
import { GROUPS, layoutIntents, layoutKeyboard, MAX_SUGGESTIONS, SUGGESTION_KEY, type KeyId } from './keyboard';

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target' | 'thinking'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; highlight: KeyId; suggestions: string[] }
  | { phase: 'choosing'; wakeProgress: number; intents: string[]; highlight: KeyId }
  | { phase: 'running'; wakeProgress: number; intent: string };

// A select comes from a Select Blink, which real tracking detects outside the GazeEvent format.
export type SessionInput =
  | GazeEvent
  | { type: 'tick' | 'open-keyboard' | 'select'; t: number }
  // The model's answer to the suggest-intents request with the same number.
  | { type: 'intents'; t: number; request: number; intents: string[] };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction =
  | { type: 'type-text'; text: string }
  // turnedDown holds the Suggested Intents passed over with Something else, so the model offers different ones.
  | { type: 'suggest-intents'; region: GazeRegion; request: number; turnedDown: string[] }
  | { type: 'run-intent'; intent: string };

// Word prediction: the typed text in, the best words to finish it or follow it out. See src/shared/predict.ts.
export type Suggest = (text: string) => string[];

const MAX_INTENTS = 3;

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, scanStepMs: 2000, targetHoldMs: 1000 };

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
    targetHoldMs: timing('targetHoldMs'),
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
  suggest = () => [],
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
  suggest?: Suggest;
}) {
  const { wakeHoldMs, lookAwayMs, scanStepMs, targetHoldMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  // The Gaze Region where the user started holding on a target after waking.
  let target: { region: GazeRegion; start: number } | null = null;
  // The wake hold ends on the Centre Box, so a target hold only starts after a Move Off from it.
  let movedOffCentreBox = false;
  let text = '';
  let group: string | null = null;
  // The Gaze Keyboard scans: the highlight steps through the keys in order, from the first key after every press.
  let scanStart = 0;
  let highlight: KeyId = '';
  let suggestions: string[] = [];
  let intents: string[] = [];
  // The target the model was asked about and what was turned down there, so Something else can ask again.
  let asked: GazeRegion | null = null;
  let turnedDown: string[] = [];
  // Numbers each request, so a late answer to an earlier one is dropped.
  let request = 0;
  let intent = '';

  // Suggested Intents scan the same way as the Gaze Keyboard.
  function scan(t: number) {
    const keys = phase === 'choosing' ? layoutIntents(screen, intents) : layoutKeyboard(screen, group, suggestions).keys;
    highlight = keys[Math.floor(Math.max(t - scanStart, 0) / scanStepMs) % keys.length].id;
  }

  function openKeyboard(t: number) {
    phase = 'typing';
    holdStart = null;
    wakeProgress = 0;
    text = '';
    group = null;
    suggestions = suggest(text).slice(0, MAX_SUGGESTIONS);
    scanStart = t;
    scan(t);
  }

  function press(key: KeyId) {
    if (phase === 'choosing') choose(key);
    else if (key.startsWith(SUGGESTION_KEY)) {
      // The word replaces the letters typed so far, and the space after it is free.
      text = text.replace(/[a-z]*$/, '') + key.slice(SUGGESTION_KEY.length) + ' ';
      group = null;
    } else if (GROUPS.includes(key)) group = key;
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

  function suggestIntents(region: GazeRegion, passedOver: string[]) {
    asked = region;
    turnedDown = passedOver;
    act({ type: 'suggest-intents', region, request: ++request, turnedDown });
    phase = 'thinking';
  }

  function choose(key: KeyId) {
    if (key === 'something-else') return suggestIntents(asked!, [...turnedDown, ...intents]);
    intent = intents[Number(key.replace('intent-', ''))];
    act({ type: 'run-intent', intent });
    phase = 'running';
  }

  function holdTarget(region: GazeRegion | null, t: number) {
    if (region === null || offScreen(region, screen)) {
      target = null;
      return;
    }
    if (!onCentreBox(region, screen)) movedOffCentreBox = true;
    if (!movedOffCentreBox) return;
    // Jitter inside the first Gaze Region still counts as the same target.
    const moved = target && Math.hypot(region.x - target.region.x, region.y - target.region.y) > target.region.radius;
    if (target === null || moved) target = { region, start: t };
    if (t - target.start >= targetHoldMs) {
      suggestIntents(target.region, []);
      target = null;
    }
  }

  function state(): OverlayState {
    if (phase === 'typing') return { phase, wakeProgress, text, group, highlight, suggestions };
    if (phase === 'choosing') return { phase, wakeProgress, intents, highlight };
    if (phase === 'running') return { phase, wakeProgress, intent };
    return { phase, wakeProgress };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard(input.t);
    } else if (input.type === 'intents') {
      if (phase === 'thinking' && input.request === request) {
        phase = 'choosing';
        intents = input.intents.slice(0, MAX_INTENTS);
        scanStart = input.t;
        scan(input.t);
      }
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') awaySince = offScreen(input.region, screen) ? (awaySince ?? input.t) : null;
      // The Stop Gesture closes the Gaze Keyboard without typing the text.
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        phase = 'idle';
        awaySince = null;
      } else if (phase === 'waiting-for-target' && input.type === 'gaze') {
        holdTarget(input.region, input.t);
      } else if (phase === 'typing' || phase === 'choosing') {
        scan(input.t);
        if (input.type === 'select') {
          press(highlight);
          if (phase === 'typing') suggestions = suggest(text).slice(0, MAX_SUGGESTIONS);
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
        // A target hold cut short last time, for example by the Gaze Keyboard, must not carry over.
        target = null;
        movedOffCentreBox = false;
      }
    }
    return state();
  };
}
