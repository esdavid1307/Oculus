// Issue #65: the Dock Fixed Intent. Choosing it shows the Dock and starts the same Icon Scan a Dock hold starts.
import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { CLOSE_KEY, layoutIntents } from './keyboard';
import { createSession, type AgentAction, type Icon } from './session';

const screen = { width: 1600, height: 1000 };
const inBox = { x: 800, y: 500, radius: 120 };
const target = { x: 300, y: 300, radius: 120 };
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });
const claude = (t: number, intents: string[]) => ({ type: 'intents', t, request: 1, intents }) as const;
const tick = (t: number) => ({ type: 'tick', t }) as const;
const select = (t: number) => ({ type: 'select', t }) as const;

// A Dock along the bottom, read left to right. Icon Order puts Notes, the one this user opens most, first.
const dockIcons: Icon[] = ['Finder', 'Safari', 'Notes', 'Mail'].map((name, i) => ({ name, rect: { x: 600 + i * 100, y: 920, width: 80, height: 80 } }));
const iconOrder = (_source: string, names: string[]) => [names.indexOf('Notes'), ...names.map((_, i) => i).filter((i) => names[i] !== 'Notes')];
const withDock = { dock: () => dockIcons, orderIcons: iconOrder };
const nearDock = { x: 800, y: 990, radius: 120 };
const offScreen = { x: 800, y: -400, radius: 120 };

// The names the scan lights, one step at a time, from t on.
const scanFrom = (session: ReturnType<typeof createSession>, t: number) =>
  [0, 1, 2, 3].map((step) => {
    const state = session(tick(t + step * 2000 + 100));
    return state.phase === 'icons' ? state.highlight.name : state.phase;
  });

const dockShown = (t: number, icons = dockIcons) => ({ type: 'dock-shown', t, icons }) as const;

// Claude answered at 5 s with no past Intents, so Dock, the fourth tile, is lit from 11 s. Chosen at 11.1 s.
function chooseDock(options: Partial<Parameters<typeof createSession>[0]> = {}) {
  const started = thinking({ ...withDock, ...options });
  started.session(claude(5000, ['Pause']));
  expect(started.session(tick(11_050))).toMatchObject({ highlight: 'dock' });
  started.session(select(11_100));
  return started;
}

// The same, and main has shown the Dock and read it again by 11.6 s, so its scan runs from there.
function scanningDock(options: Partial<Parameters<typeof createSession>[0]> = {}) {
  const started = chooseDock(options);
  started.session(dockShown(11_600));
  return started;
}

// Woken at 3 s, the target held from 3.1 s to 4.1 s, so the session is thinking with suggest-intents request 1 out.
function thinking(options: Partial<Parameters<typeof createSession>[0]> = {}) {
  const actions: AgentAction[] = [];
  const session = createSession({ screen, act: (action) => actions.push(action), ...options });
  session(gaze(0, inBox));
  session(gaze(3000, inBox));
  session(gaze(3100, target));
  session(gaze(4100, target));
  const mark = actions.length;
  return { session, actions, fromPicker: () => actions.slice(mark) };
}

const ids = (state: ReturnType<ReturnType<typeof createSession>>) => (state.phase === 'choosing' ? layoutIntents(screen, state).map(({ id }) => id) : []);

describe('the Dock Fixed Intent', () => {
  it('comes after Minimize in every app, and before Cmd in Chrome', () => {
    const outside = thinking().session(claude(5000, ['Pause']));
    expect(outside).toMatchObject({ fixed: [CLOSE_KEY, 'home', 'minimize', 'dock'] });
    expect(ids(outside)).toEqual([CLOSE_KEY, 'home', 'minimize', 'dock', 'intent-0', 'something-else']);
    expect(thinking({ inChrome: () => true }).session(claude(5000, ['Pause']))).toMatchObject({ fixed: [CLOSE_KEY, 'home', 'minimize', 'dock', 'cmd'] });
  });
});

describe('choosing Dock', () => {
  it('shows the Dock and waits for main to read it, choosing nothing else in the meantime', () => {
    const { session, fromPicker } = chooseDock();
    expect(fromPicker().filter(({ type }) => type === 'show-dock')).toHaveLength(1);
    // The picker has gone, and a look at the target while the Dock comes up starts nothing.
    expect(session(gaze(11_200, target)).phase).toBe('waiting-for-target');
    expect(session(gaze(12_400, target)).phase).toBe('waiting-for-target');
    expect(fromPicker().filter(({ type }) => ['suggest-intents', 'run-intent', 'fixed-intent', 'release-dock'].includes(type))).toEqual([]);
  });

  it('starts the Icon Scan of the Dock where it shows, once main has read it again', () => {
    const { session } = chooseDock({ dock: () => dockIcons.map((icon) => ({ ...icon, rect: { ...icon.rect, y: 1010 } })) });
    // Read past the bottom edge before it showed, as with a hidden Dock; scanned where it is now.
    expect(session(dockShown(11_600))).toMatchObject({ phase: 'icons', source: 'dock', highlight: { name: 'Notes', rect: { y: 920 } } });
  });

  it('scans the Dock in the same order as a Dock hold, Icon Order first', () => {
    const fromDock = scanningDock().session;
    // The same Dock reached with a 3 second hold near it, from waiting-for-target.
    const held = createSession({ screen, act: () => {}, ...withDock });
    held(gaze(0, inBox));
    held(gaze(3000, inBox));
    held(gaze(3100, nearDock));
    held(gaze(6100, nearDock));
    expect(scanFrom(fromDock, 11_600)).toEqual(['Notes', 'Finder', 'Safari', 'Mail']);
    expect(scanFrom(held, 6100)).toEqual(['Notes', 'Finder', 'Safari', 'Mail']);
  });

  it('ends on the Stop Gesture while the Dock is still coming up, releasing it and scanning nothing', () => {
    const { session, fromPicker } = chooseDock();
    session(gaze(11_200, offScreen));
    expect(session(gaze(16_200, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(fromPicker().filter(({ type }) => type === 'release-dock')).toHaveLength(1);
    // Main's late answer starts nothing.
    expect(session(dockShown(16_300))).toEqual({ phase: 'idle', wakeProgress: 0 });
  });

  it('scans the Dock as last read if main never answers within 2 seconds', () => {
    const { session } = chooseDock();
    expect(session(tick(13_000)).phase).toBe('waiting-for-target');
    expect(session(tick(13_100))).toMatchObject({ phase: 'icons', source: 'dock', highlight: { name: 'Notes' } });
  });

  it('goes back to sleep and releases the Dock when there is nothing in it to scan', () => {
    const { session, fromPicker } = chooseDock({ dock: () => [] });
    expect(session(dockShown(11_600, []))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(fromPicker().filter(({ type }) => type === 'release-dock')).toHaveLength(1);
  });
});

describe('the Dock scan from the Dock Fixed Intent', () => {
  it('opens the highlighted app on a Select Blink, teaching Icon Order and never Gaze Correction', () => {
    const { session, fromPicker } = scanningDock();
    session(select(11_700));
    expect(fromPicker().filter(({ type }) => type === 'open-icon')).toEqual([{ type: 'open-icon', source: 'dock', name: 'Notes' }]);
    const learned = fromPicker().flatMap((action) => (action.type === 'learn' ? [action.signal.kind] : []));
    expect(learned).toContain('icon-opened');
    expect(learned).not.toContain('gaze');
  });

  it('ends on the Stop Gesture and releases the Dock, opening nothing', () => {
    const { session, fromPicker } = scanningDock();
    session(gaze(11_700, offScreen));
    expect(session(gaze(16_699, offScreen)).phase).toBe('icons');
    expect(session(gaze(16_700, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(fromPicker().filter(({ type }) => type === 'release-dock')).toHaveLength(1);
    expect(fromPicker().filter(({ type }) => type === 'open-icon')).toEqual([]);
  });

  it('ignores a read of the Dock that no Dock Fixed Intent is waiting for', () => {
    const { session } = scanningDock();
    session(select(11_700));
    expect(session(dockShown(12_000)).phase).toBe('waiting-for-target');
  });
});
