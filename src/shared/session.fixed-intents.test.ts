// Issue #67: the Chrome Commands Fixed Intent. A Cmd tile shows after the other Fixed Intents only when Chrome is in
// front; choosing it starts a second scan over Next Tab and Close Tab, which run as key presses in main with no Claude call.
import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { CLOSE_KEY, layoutIntents } from './keyboard';
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

const ids = (state: ReturnType<ReturnType<typeof createSession>>) => (state.phase === 'choosing' ? layoutIntents(screen, state).map(({ id }) => id) : []);
const runsOrAsks = (actions: AgentAction[]) => actions.filter(({ type }) => type === 'suggest-intents' || type === 'run-intent');
const gazeLabels = (actions: AgentAction[]) => actions.filter((action) => action.type === 'learn' && action.signal.kind === 'gaze');

describe('the Cmd Fixed Intent', () => {
  it('is not offered when Chrome is not in front', () => {
    const { session } = thinking(false);
    const state = session(claude(5000, ['Pause', 'Mute']));
    expect(state).toMatchObject({ phase: 'choosing', fixed: [CLOSE_KEY, 'home', 'minimize', 'type'] });
    expect(ids(state)).not.toContain('cmd');
  });

  it('is offered in Chrome, after the other Fixed Intents and before Claude’s', () => {
    const { session } = thinking(true);
    const opened = session(pastIntents(4500, ['Pause', 'Mute']));
    expect(opened).toMatchObject({ phase: 'choosing', fixed: [CLOSE_KEY, 'home', 'minimize', 'type', 'cmd'], recent: 2 });
    const state = session(claude(5000, ['Like', 'Share', 'Save']));
    expect(ids(state)).toEqual(['intent-0', 'intent-1', CLOSE_KEY, 'home', 'minimize', 'type', 'cmd', 'intent-2', 'intent-3', 'intent-4', 'something-else']);
  });

  it('starts a scan over the Chrome Commands, without asking Claude or running anything', () => {
    const { session, fromPicker } = thinking(true);
    // No past Intents, so Cmd is the fifth tile, lit from 13 s.
    session(claude(5000, ['Pause']));
    expect(session(tick(13_000))).toMatchObject({ highlight: 'cmd' });
    const state = session(select(13_100));
    expect(state).toMatchObject({ phase: 'choosing', intents: [], fixed: ['next-tab', 'close-tab', CLOSE_KEY], highlight: 'next-tab', suggesting: false });
    expect(ids(state)).toEqual(['next-tab', 'close-tab', CLOSE_KEY, 'something-else']);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });
});

describe('the Chrome Commands scan', () => {
  // In the Chrome Commands scan from 13.1 s: Next Tab lit first, Close Tab from 15.1 s, Close from 17.1 s and
  // Something else from 19.1 s.
  const inCommands = () => {
    const started = thinking(true);
    started.session(claude(5000, ['Pause']));
    started.session(select(13_100));
    return started;
  };

  for (const [name, at] of [['next-tab', 13_200], ['close-tab', 15_200]] as const)
    it(`runs ${name} as a Fixed Intent, with no Claude request and no run, and goes back to sleep`, () => {
      const { session, fromPicker } = inCommands();
      expect(session(tick(at))).toMatchObject({ highlight: name });
      expect(session(select(at + 100))).toEqual({ phase: 'idle', wakeProgress: 0 });
      expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([{ type: 'fixed-intent', name }]);
      expect(runsOrAsks(fromPicker())).toEqual([]);
    });

  it('never teaches Gaze Correction, but still counts each Select Blink for Scan Pace', () => {
    const { session, fromPicker } = inCommands();
    session(select(13_200));
    expect(gazeLabels(fromPicker())).toEqual([]);
    // One for choosing Cmd, one for Next Tab.
    expect(fromPicker().filter((action) => action.type === 'learn' && action.signal.kind === 'select')).toHaveLength(2);
  });

  it('ends on the Stop Gesture without choosing anything', () => {
    const { session, fromPicker } = inCommands();
    session(gaze(13_200, offScreen));
    expect(session(gaze(18_199, offScreen)).phase).toBe('choosing');
    expect(session(gaze(18_200, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([]);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });

  it('ends on Close or Something else without choosing anything', () => {
    for (const [key, at] of [[CLOSE_KEY, 17_200], ['something-else', 19_200]] as const) {
      const { session, fromPicker } = inCommands();
      expect(session(tick(at))).toMatchObject({ highlight: key });
      expect(session(select(at + 100))).toEqual({ phase: 'idle', wakeProgress: 0 });
      expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([]);
      expect(runsOrAsks(fromPicker())).toEqual([]);
    }
  });

  it("keeps Claude's late answer out of it, when Cmd was chosen before Claude answered", () => {
    const { session, fromPicker } = thinking(true);
    session(pastIntents(4500, ['Pause', 'Mute']));
    // Cmd is the seventh tile, lit from 16.5 s.
    expect(session(tick(16_600))).toMatchObject({ highlight: 'cmd' });
    session(select(16_700));
    const state = session(claude(17_000, ['Like', 'Share', 'Save']));
    expect(state).toMatchObject({ intents: [], fixed: ['next-tab', 'close-tab', CLOSE_KEY] });
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });

  it('shows Cmd again, not the Chrome Commands, on the next picker', () => {
    const { session } = inCommands();
    session(select(13_200));
    session(gaze(14_000, inBox));
    session(gaze(17_000, inBox));
    session(gaze(17_100, target));
    session(gaze(18_100, target));
    expect(session({ type: 'intents', t: 19_000, request: 2, intents: ['Pause'] })).toMatchObject({ fixed: [CLOSE_KEY, 'home', 'minimize', 'type', 'cmd'] });
  });
});
