// Issue #67: the Chrome Commands Fixed Intent. A Cmd tile shows among the Fixed Intents only when Chrome is in front;
// choosing it starts a second scan over Next Tab and Close Tab, which run as key presses in main with no Claude call.
import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { CLOSE_KEY, FIXED_KEY, layoutIntents } from './keyboard';
import { createSession, type AgentAction } from './session';

const screen = { width: 1600, height: 1000 };
const inBox = { x: 800, y: 500, radius: 120 };
const target = { x: 300, y: 300, radius: 120 };
const offScreen = { x: 800, y: -400, radius: 120 };
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });
const tick = (t: number) => ({ type: 'tick', t }) as const;
const select = (t: number) => ({ type: 'select', t }) as const;
const claude = (t: number, intents: string[]) => ({ type: 'intents', t, request: 1, intents }) as const;
const pastIntents = (t: number, intents: string[]) => ({ type: 'past-intents', t, request: 1, intents }) as const;

// Woken at 3 s, the target held from 3.1 s to 4.1 s, so the session is thinking with suggest-intents request 1 out.
function thinking(inChrome: boolean) {
  const actions: AgentAction[] = [];
  const session = createSession({ screen, act: (action) => actions.push(action), inChrome: () => inChrome });
  session(gaze(0, inBox));
  session(gaze(3000, inBox));
  session(gaze(3100, target));
  session(gaze(4100, target));
  // Only what happens from the picker on: the wake hold teaches Gaze Correction on its own.
  const fromPicker = () => actions.slice(mark);
  const mark = actions.length;
  return { session, actions, fromPicker };
}

const ids = (state: ReturnType<ReturnType<typeof createSession>>) =>
  state.phase === 'choosing' ? layoutIntents(screen, state.intents, state.cells, state.side, state.fixedIntents, state.recent).map(({ id }) => id) : [];
const runsOrAsks = (actions: AgentAction[]) => actions.filter(({ type }) => type === 'suggest-intents' || type === 'run-intent');
const gazeLabels = (actions: AgentAction[]) => actions.filter((action) => action.type === 'learn' && action.signal.kind === 'gaze');

describe('the Cmd Fixed Intent', () => {
  it('is not offered when Chrome is not in front', () => {
    const { session } = thinking(false);
    const state = session(claude(5000, ['Pause', 'Mute']));
    expect(state).toMatchObject({ phase: 'choosing', fixedIntents: [] });
    expect(ids(state)).not.toContain(`${FIXED_KEY}cmd`);
  });

  it('is offered in Chrome, after the past Intents and before Claude’s', () => {
    const { session } = thinking(true);
    const opened = session(pastIntents(4500, ['Pause', 'Mute']));
    expect(opened).toMatchObject({ phase: 'choosing', fixedIntents: ['cmd'], recent: 2 });
    const state = session(claude(5000, ['Like', 'Share', 'Save']));
    expect(ids(state)).toEqual(['intent-0', 'intent-1', `${FIXED_KEY}cmd`, 'intent-2', 'intent-3', 'intent-4', 'something-else', CLOSE_KEY]);
  });

  it('keeps every tile where it was, and the highlight on it, when Claude’s Intents join', () => {
    const { session } = thinking(true);
    session(pastIntents(4500, ['Pause', 'Mute']));
    // Mute is lit from 6.5 s; Claude answers while it is.
    expect(session(tick(6600))).toMatchObject({ highlight: 'intent-1' });
    const before = layoutIntents(screen, ['Pause', 'Mute'], 6, 'right', ['cmd'], 2);
    const state = session(claude(6700, ['Like', 'Share', 'Save']));
    expect(state).toMatchObject({ highlight: 'intent-1' });
    const after = layoutIntents(screen, ['Pause', 'Mute', 'Like', 'Share', 'Save'], 6, 'right', ['cmd'], 2);
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    // Cmd is next, then Claude's in the order they came.
    expect(session(tick(8500))).toMatchObject({ highlight: `${FIXED_KEY}cmd` });
    expect(session(tick(10_500))).toMatchObject({ highlight: 'intent-2' });
  });

  it('starts a scan over the Chrome Commands, without asking Claude or running anything', () => {
    const { session, fromPicker } = thinking(true);
    // No past Intents, so Cmd is the first tile and lit at once.
    expect(session(claude(5000, ['Pause']))).toMatchObject({ highlight: `${FIXED_KEY}cmd` });
    const state = session(select(5100));
    expect(state).toMatchObject({ phase: 'choosing', intents: [], fixedIntents: ['next-tab', 'close-tab'], highlight: `${FIXED_KEY}next-tab` });
    expect(ids(state)).toEqual([`${FIXED_KEY}next-tab`, `${FIXED_KEY}close-tab`, 'something-else', CLOSE_KEY]);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });
});

describe('the Chrome Commands scan', () => {
  // In the Chrome Commands scan from 5.1 s, Next Tab lit first and Close Tab from 7.1 s.
  const inCommands = () => {
    const started = thinking(true);
    started.session(claude(5000, ['Pause']));
    started.session(select(5100));
    return started;
  };

  for (const [name, at] of [['next-tab', 5200], ['close-tab', 7200]] as const)
    it(`runs ${name} as a Fixed Intent, with no Claude request and no run, and goes back to sleep`, () => {
      const { session, fromPicker } = inCommands();
      expect(session(tick(at))).toMatchObject({ highlight: `${FIXED_KEY}${name}` });
      expect(session(select(at + 100))).toEqual({ phase: 'idle', wakeProgress: 0 });
      expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([{ type: 'fixed-intent', name }]);
      expect(runsOrAsks(fromPicker())).toEqual([]);
    });

  it('never teaches Gaze Correction, but still counts each Select Blink for Scan Pace', () => {
    const { session, fromPicker } = inCommands();
    session(select(5200));
    expect(gazeLabels(fromPicker())).toEqual([]);
    // One for choosing Cmd, one for Next Tab.
    expect(fromPicker().filter((action) => action.type === 'learn' && action.signal.kind === 'select')).toHaveLength(2);
  });

  it('ends on the Stop Gesture without choosing anything', () => {
    const { session, fromPicker } = inCommands();
    session(gaze(5200, offScreen));
    expect(session(gaze(10_199, offScreen)).phase).toBe('choosing');
    expect(session(gaze(10_200, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([]);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });

  it('ends on Close or Something else without choosing anything', () => {
    for (const [key, at] of [['something-else', 9200], [CLOSE_KEY, 11_200]] as const) {
      const { session, fromPicker } = inCommands();
      expect(session(tick(at))).toMatchObject({ highlight: key });
      expect(session(select(at + 100))).toEqual({ phase: 'idle', wakeProgress: 0 });
      expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([]);
      expect(runsOrAsks(fromPicker())).toEqual([]);
    }
  });

  it('shows Cmd again, not the Chrome Commands, on the next picker', () => {
    const { session } = inCommands();
    session(select(5200));
    session(gaze(6000, inBox));
    session(gaze(9000, inBox));
    session(gaze(9100, target));
    session(gaze(10_100, target));
    expect(session({ type: 'intents', t: 11_000, request: 2, intents: ['Pause'] })).toMatchObject({ fixedIntents: ['cmd'] });
  });
});

describe('layoutIntents with Fixed Intents', () => {
  it('puts the Fixed tiles between the past Intents and Claude’s, then Something else and Close, none overlapping', () => {
    const keys = layoutIntents(screen, ['Pause', 'Mute', 'Like'], 6, 'right', ['cmd'], 2);
    expect(keys.map(({ id, label }) => [id, label])).toEqual([
      ['intent-0', 'Pause'],
      ['intent-1', 'Mute'],
      [`${FIXED_KEY}cmd`, 'Cmd'],
      ['intent-2', 'Like'],
      ['something-else', 'Something else'],
      [CLOSE_KEY, 'Close'],
    ]);
    const overlap = (a: (typeof keys)[number]['rect'], b: (typeof keys)[number]['rect']) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const a of keys) for (const b of keys) if (a !== b) expect(overlap(a.rect, b.rect), `${a.id} / ${b.id}`).toBe(false);
  });

  it("keeps all of Claude's Intents after the past ones and the Fixed ones", () => {
    const keys = layoutIntents(screen, ['Pause', 'Mute', 'Like', 'Share', 'Save'], 6, 'right', ['cmd'], 2);
    expect(keys.filter(({ id }) => id.startsWith('intent-')).map(({ label }) => label)).toEqual(['Pause', 'Mute', 'Like', 'Share', 'Save']);
  });

  it('lays out the Chrome Commands scan with no empty tiles', () => {
    expect(layoutIntents(screen, [], 1, 'right', ['next-tab', 'close-tab'], 0).map(({ id }) => id)).toEqual([
      `${FIXED_KEY}next-tab`,
      `${FIXED_KEY}close-tab`,
      'something-else',
      CLOSE_KEY,
    ]);
  });
});
