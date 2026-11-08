import { offScreen, type GazeEvent, type GazeRegion } from './gaze';
import type { Rect, Screen } from './geometry';
import { GROUPS, layoutKeyboard, type KeyId } from './keyboard';

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; highlight: KeyId }
  | { phase: 'dock'; wakeProgress: number; highlight: DockItem };

// An icon on the macOS Dock, in overlay coordinates.
export type DockItem = { name: string; rect: Rect };

// A select comes from a Select Blink, which real tracking detects outside the GazeEvent format.
export type SessionInput = GazeEvent | { type: 'tick' | 'open-keyboard' | 'select'; t: number };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction = { type: 'type-text'; text: string } | { type: 'open-dock-item'; name: string };

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, scanStepMs: 2000, dockHoldMs: 3000 };

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
    dockHoldMs: timing('dockHoldMs'),
  };
}

// The box is 50vmin, as drawn in overlay.css. The centre must be inside, so a large radius can't start a hold.
function onCentreBox(region: GazeRegion | null, { width, height }: Screen) {
  if (region === null) return false;
  const half = Math.min(width, height) / 4;
  return Math.abs(region.x - width / 2) <= half && Math.abs(region.y - height / 2) <= half;
}

// Near means the Gaze Region touches the box around the Dock icons. The Dock sits on a screen edge, and looking at it
// puts the camera's estimate hundreds of pixels past that edge, so the region is pulled back onto the screen first.
function nearDock(region: GazeRegion | null, items: DockItem[], { width, height }: Screen) {
  if (region === null || items.length === 0) return false;
  const x = Math.min(Math.max(region.x, 0), width);
  const y = Math.min(Math.max(region.y, 0), height);
  const left = Math.min(...items.map(({ rect }) => rect.x));
  const top = Math.min(...items.map(({ rect }) => rect.y));
  const right = Math.max(...items.map(({ rect }) => rect.x + rect.width));
  const bottom = Math.max(...items.map(({ rect }) => rect.y + rect.height));
  const dx = Math.max(left - x, 0, x - right);
  const dy = Math.max(top - y, 0, y - bottom);
  return Math.hypot(dx, dy) <= region.radius;
}

export function createSession({
  screen,
  timings,
  act = () => {},
  dock = () => [],
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
  dock?: () => DockItem[];
}) {
  const { wakeHoldMs, lookAwayMs, scanStepMs, dockHoldMs } = parseTimings(timings);
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  let text = '';
  let group: string | null = null;
  // The Gaze Keyboard scans: the highlight steps through the keys in order, from the first key after every press.
  let scanStart = 0;
  let highlight: KeyId = '';
  let dockHoldStart: number | null = null;
  // Copied when the Dock scan starts, so the icons can't shift under the highlight.
  let dockItems: DockItem[] = [];
  let dockHighlight: DockItem | undefined;

  function scan(t: number) {
    const step = (length: number) => Math.floor(Math.max(t - scanStart, 0) / scanStepMs) % length;
    if (phase === 'dock') dockHighlight = dockItems[step(dockItems.length)];
    else {
      const { keys } = layoutKeyboard(screen, group);
      highlight = keys[step(keys.length)].id;
    }
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
    if (phase === 'typing') return { phase, wakeProgress, text, group, highlight };
    if (phase === 'dock') return { phase, wakeProgress, highlight: dockHighlight! };
    return { phase, wakeProgress };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard(input.t);
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') {
        // Looking at the Dock is often read as off the screen, and it mustn't count as Look Away.
        const away = offScreen(input.region, screen) && !nearDock(input.region, phase === 'dock' ? dockItems : dock(), screen);
        awaySince = away ? (awaySince ?? input.t) : null;
      }
      // The Stop Gesture closes the Gaze Keyboard without typing the text, and the Dock scan without opening anything.
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
      } else if (phase === 'dock') {
        scan(input.t);
        if (input.type === 'select') {
          act({ type: 'open-dock-item', name: dockHighlight!.name });
          phase = 'idle';
        }
      } else if (input.type === 'gaze') {
        // Looking near the Dock for 3 seconds sticks to it, and the scan steps through its icons from the left.
        dockHoldStart = nearDock(input.region, dock(), screen) ? (dockHoldStart ?? input.t) : null;
        if (dockHoldStart !== null && input.t - dockHoldStart >= dockHoldMs) {
          phase = 'dock';
          dockHoldStart = null;
          dockItems = dock();
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
        dockHoldStart = null;
        holdStart = null;
        wakeProgress = 0;
      }
    }
    return state();
  };
}
