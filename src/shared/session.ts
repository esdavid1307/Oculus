import { offScreen, type GazeEvent, type GazeRegion } from './gaze';
import type { Rect, Screen } from './geometry';
import { GROUPS, layoutKeyboard, type KeyId } from './keyboard';

export type OverlayState =
  | { phase: 'idle' | 'waiting-for-target'; wakeProgress: number }
  | { phase: 'typing'; wakeProgress: number; text: string; group: string | null; highlight: KeyId }
  | { phase: 'icons'; wakeProgress: number; source: IconSource; highlight: Icon };

// Something on screen the user can open: a Dock or Desktop icon, a menu bar item, or a command in an open menu.
// The name is what the outside world needs to find it again, in overlay coordinates.
export type Icon = { name: string; rect: Rect };

// 'menu' is the menu a menu bar item just opened.
export type IconSource = 'dock' | 'desktop' | 'menubar' | 'menu';

// A select comes from a Select Blink, which real tracking detects outside the GazeEvent format.
// menu-opened reports the commands of the menu a menu bar item opened.
export type SessionInput =
  | GazeEvent
  | { type: 'tick' | 'open-keyboard' | 'select'; t: number }
  | { type: 'menu-opened'; t: number; icons: Icon[] };

// Requests for the outside world. The session core never acts on the OS itself.
export type AgentAction = { type: 'type-text'; text: string } | { type: 'open-icon'; source: IconSource; name: string } | { type: 'show-dock' } | { type: 'release-dock' } | { type: 'close-menu' };

const DEFAULT_TIMINGS = { wakeHoldMs: 3000, lookAwayMs: 5000, scanStepMs: 2000, iconHoldMs: 3000 };

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
    iconHoldMs: timing('iconHoldMs'),
  };
}

// The box is 50vmin, as drawn in overlay.css. The centre must be inside, so a large radius can't start a hold.
function onCentreBox(region: GazeRegion | null, { width, height }: Screen) {
  if (region === null) return false;
  const half = Math.min(width, height) / 4;
  return Math.abs(region.x - width / 2) <= half && Math.abs(region.y - height / 2) <= half;
}

// How far the centre of the Gaze Region is from the nearest icon. The Dock, the menu bar and the Desktop icons sit on
// screen edges, and looking at them puts the camera's estimate hundreds of pixels past the edge, so the centre is
// pulled back onto the screen first.
function iconDistance(region: GazeRegion | null, icons: Icon[], { width, height }: Screen) {
  if (region === null) return Infinity;
  const x = Math.min(Math.max(region.x, 0), width);
  const y = Math.min(Math.max(region.y, 0), height);
  return Math.min(
    ...icons.map(({ rect }) => {
      const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
      const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
      return Math.hypot(dx, dy);
    }),
  );
}

// Near means the Gaze Region touches one of the icons.
function nearIcon(region: GazeRegion | null, icons: Icon[], screen: Screen) {
  return region !== null && iconDistance(region, icons, screen) <= region.radius;
}

// The whole width of the menu bar counts, since its menus and status items leave a wide gap between them.
function menuBarDistance(region: GazeRegion | null, items: Icon[], screen: Screen) {
  if (items.length === 0) return Infinity;
  const height = Math.max(...items.map(({ rect }) => rect.y + rect.height));
  return iconDistance(region, [{ name: '', rect: { x: 0, y: 0, width: screen.width, height } }], screen);
}

function nearMenuBar(region: GazeRegion | null, items: Icon[], screen: Screen) {
  return region !== null && menuBarDistance(region, items, screen) <= region.radius;
}

export function createSession({
  screen,
  timings,
  act = () => {},
  dock = () => [],
  desktop = () => [],
  menubar = () => [],
}: {
  screen: Screen;
  timings?: unknown;
  act?: (action: AgentAction) => void;
  dock?: () => Icon[];
  // Only the Desktop icons no window covers.
  desktop?: () => Icon[];
  // The menus of the app in front, then the status items.
  menubar?: () => Icon[];
}) {
  const { wakeHoldMs, lookAwayMs, scanStepMs, iconHoldMs } = parseTimings(timings);
  const iconsOf = { dock, desktop, menubar };
  const distance = (region: GazeRegion | null, from: 'dock' | 'desktop' | 'menubar') =>
    from === 'menubar' ? menuBarDistance(region, menubar(), screen) : iconDistance(region, iconsOf[from](), screen);
  const near = (region: GazeRegion | null, from: 'dock' | 'desktop' | 'menubar') =>
    region !== null && distance(region, from) <= region.radius;
  let phase: OverlayState['phase'] = 'idle';
  let holdStart: number | null = null;
  let wakeProgress = 0;
  let awaySince: number | null = null;
  let text = '';
  let group: string | null = null;
  // The Gaze Keyboard scans: the highlight steps through the keys in order, from the first key after every press.
  let scanStart = 0;
  let highlight: KeyId = '';
  let iconHold: { source: 'dock' | 'desktop' | 'menubar'; start: number } | null = null;
  // A Dock that was asked to show stays up until it's released, or an icon is opened from it.
  let dockShown = false;
  // Copied when the icon scan starts, so the icons can't shift under the highlight.
  let source: IconSource = 'dock';
  let icons: Icon[] = [];
  let iconHighlight: Icon | undefined;

  function scan(t: number) {
    const step = (length: number) => Math.floor(Math.max(t - scanStart, 0) / scanStepMs) % length;
    if (phase === 'icons') iconHighlight = icons[step(icons.length)];
    else {
      const { keys } = layoutKeyboard(screen, group);
      highlight = keys[step(keys.length)].id;
    }
  }

  // Steps through the icons column by column from the left, top to bottom.
  function scanIcons(from: IconSource, all: Icon[], t: number) {
    phase = 'icons';
    source = from;
    iconHold = null;
    icons = [...all].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
    scanStart = t;
    scan(t);
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
    if (phase === 'icons') return { phase, wakeProgress, source, highlight: iconHighlight! };
    return { phase, wakeProgress };
  }

  return (input: SessionInput): OverlayState => {
    if (input.type === 'open-keyboard') {
      if (phase !== 'typing') openKeyboard(input.t);
    } else if (phase !== 'idle') {
      if (input.type === 'gaze') {
        // Looking at an icon on a screen edge is often read as off the screen, and it mustn't count as Look Away.
        const onEdgeIcon =
          phase === 'icons'
            ? source === 'menubar'
              ? nearMenuBar(input.region, icons, screen)
              : nearIcon(input.region, icons, screen)
            : (['dock', 'desktop', 'menubar'] as const).some((from) => near(input.region, from));
        const away = offScreen(input.region, screen) && !onEdgeIcon;
        awaySince = away ? (awaySince ?? input.t) : null;
      }
      // The Stop Gesture closes the Gaze Keyboard without typing the text, and the icon scan without opening anything.
      if (awaySince !== null && input.t - awaySince >= lookAwayMs) {
        if (phase === 'icons' && source === 'menu') act({ type: 'close-menu' });
        phase = 'idle';
        awaySince = null;
      } else if (phase === 'typing') {
        scan(input.t);
        if (input.type === 'select') {
          press(highlight);
          scanStart = input.t;
          scan(input.t);
        }
      } else if (phase === 'icons') {
        scan(input.t);
        if (input.type === 'select') {
          act({ type: 'open-icon', source, name: iconHighlight!.name });
          // The opened app takes the focus, which drops the Dock by itself.
          dockShown = false;
          // Stays awake, so the user can pick the next icon without the Start Gesture again. A menu bar item that
          // opens a menu reports its commands with menu-opened, which scans them next.
          phase = 'waiting-for-target';
        }
      } else if (input.type === 'menu-opened') {
        if (input.icons.length > 0) scanIcons('menu', input.icons, input.t);
      } else if (input.type === 'gaze') {
        // Looking near the Dock, the menu bar or a Desktop icon for 3 seconds sticks to it, and the scan steps through
        // all of its icons. Where two are near, as with a Desktop icon just under the menu bar, the closer one wins.
        const target = (['dock', 'menubar', 'desktop'] as const)
          .filter((from) => near(input.region, from))
          .sort((a, b) => distance(input.region, a) - distance(input.region, b))[0];
        // Other apps can hide the Dock just past the bottom edge, so looking down starts a hold on it. Asks for it to
        // show, as the mouse would. Whether it's hidden right now is checked on the spot, outside the session.
        if (target === undefined) iconHold = null;
        else if (iconHold?.source !== target) {
          if (target === 'dock' && !dockShown) {
            act({ type: 'show-dock' });
            dockShown = true;
          }
          iconHold = { source: target, start: input.t };
        }
        if (iconHold !== null && input.t - iconHold.start >= iconHoldMs) scanIcons(iconHold.source, iconsOf[iconHold.source](), input.t);
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
        iconHold = null;
        holdStart = null;
        wakeProgress = 0;
      }
    }
    // Leaving the Dock without opening anything gives it back to the app that hid it.
    const onDock = iconHold?.source === 'dock' || (phase === 'icons' && source === 'dock');
    if (dockShown && !onDock) {
      act({ type: 'release-dock' });
      dockShown = false;
    }
    return state();
  };
}
