// Issues #67 and #68: the Chrome Commands Fixed Intent. A Cmd tile shows after the other Fixed Intents only when Chrome
// is in front; choosing it starts a second scan over Search, Next Tab, New Tab and Close Tab, which run as key presses in
// main with no Claude call. Search and New Tab then open the Gaze Keyboard, whose Done always submits.
import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { CLOSE_KEY, layoutIntents } from './keyboard';
import { createSession as createBareSession, type AgentAction } from './session';

// Quit only shows with an app in front to quit, so these tests put one there to keep it in its place in the scan.
const createSession = (options: Parameters<typeof createBareSession>[0]) => createBareSession({ frontApp: () => 'TextEdit', ...options });

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

const COMMANDS = ['search', 'next-tab', 'new-tab', 'close-tab', CLOSE_KEY];
const ids = (state: ReturnType<ReturnType<typeof createSession>>) => (state.phase === 'choosing' ? layoutIntents(screen, state).map(({ id }) => id) : []);
const runsOrAsks = (actions: AgentAction[]) => actions.filter(({ type }) => type === 'suggest-intents' || type === 'run-intent');
const gazeLabels = (actions: AgentAction[]) => actions.filter((action) => action.type === 'learn' && action.signal.kind === 'gaze');

describe('the Cmd Fixed Intent', () => {
  it('is not offered when Chrome is not in front', () => {
    const { session } = thinking(false);
    const state = session(claude(5000, ['Pause', 'Mute']));
    expect(state).toMatchObject({ phase: 'choosing', fixed: [CLOSE_KEY, 'quit', 'minimize', 'type', 'dock'] });
    expect(ids(state)).not.toContain('cmd');
  });

  it('is offered in Chrome, after the other Fixed Intents and before Claude’s', () => {
    const { session } = thinking(true);
    const opened = session(pastIntents(4500, ['Pause', 'Mute']));
    expect(opened).toMatchObject({ phase: 'choosing', fixed: [CLOSE_KEY, 'quit', 'minimize', 'type', 'dock', 'cmd'], recent: 2 });
    const state = session(claude(5000, ['Like', 'Share', 'Save']));
    expect(ids(state)).toEqual(['intent-0', 'intent-1', CLOSE_KEY, 'quit', 'minimize', 'type', 'dock', 'cmd', 'intent-2', 'intent-3', 'intent-4', 'something-else']);
  });

  it('starts a scan over the Chrome Commands, without asking Claude or running anything', () => {
    const { session, fromPicker } = thinking(true);
    // No past Intents, so Cmd is the sixth tile, lit from 15 s.
    session(claude(5000, ['Pause']));
    expect(session(tick(15_000))).toMatchObject({ highlight: 'cmd' });
    const state = session(select(15_100));
    expect(state).toMatchObject({ phase: 'choosing', intents: [], fixed: COMMANDS, highlight: 'search', suggesting: false });
    expect(ids(state)).toEqual([...COMMANDS, 'something-else']);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });
});

describe('the Chrome Commands scan', () => {
  // In the Chrome Commands scan from 15.1 s: Search lit first, Next Tab from 17.1 s, New Tab from 19.1 s, Close Tab
  // from 21.1 s, Close from 23.1 s and Something else from 25.1 s.
  const inCommands = () => {
    const started = thinking(true);
    started.session(claude(5000, ['Pause']));
    started.session(select(15_100));
    return started;
  };

  for (const [name, at] of [['next-tab', 17_200], ['close-tab', 21_200]] as const)
    it(`runs ${name} as a Fixed Intent, with no Claude request and no run, and goes back to sleep`, () => {
      const { session, fromPicker } = inCommands();
      expect(session(tick(at))).toMatchObject({ highlight: name });
      expect(session(select(at + 100))).toEqual({ phase: 'idle', wakeProgress: 0 });
      expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([{ type: 'fixed-intent', name }]);
      expect(runsOrAsks(fromPicker())).toEqual([]);
    });

  it('never teaches Gaze Correction, but still counts each Select Blink for Scan Pace', () => {
    const { session, fromPicker } = inCommands();
    session(select(17_200));
    expect(gazeLabels(fromPicker())).toEqual([]);
    // One for choosing Cmd, one for Next Tab.
    expect(fromPicker().filter((action) => action.type === 'learn' && action.signal.kind === 'select')).toHaveLength(2);
  });

  it('ends on the Stop Gesture without choosing anything', () => {
    const { session, fromPicker } = inCommands();
    session(gaze(15_200, offScreen));
    expect(session(gaze(20_199, offScreen)).phase).toBe('choosing');
    expect(session(gaze(20_200, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([]);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });

  it('ends on Close or Something else without choosing anything', () => {
    for (const [key, at] of [[CLOSE_KEY, 23_200], ['something-else', 25_200]] as const) {
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
    // Cmd is the eighth tile, lit from 18.5 s.
    expect(session(tick(18_600))).toMatchObject({ highlight: 'cmd' });
    session(select(18_700));
    const state = session(claude(19_000, ['Like', 'Share', 'Save']));
    expect(state).toMatchObject({ intents: [], fixed: COMMANDS });
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });

  it('shows Cmd again, not the Chrome Commands, on the next picker', () => {
    const { session } = inCommands();
    session(select(17_200));
    session(gaze(18_000, inBox));
    session(gaze(21_000, inBox));
    session(gaze(21_100, target));
    session(gaze(22_100, target));
    expect(session({ type: 'intents', t: 23_000, request: 2, intents: ['Pause'] })).toMatchObject({ fixed: [CLOSE_KEY, 'quit', 'minimize', 'type', 'dock', 'cmd'] });
  });
});

describe('Search and New Tab', () => {
  const typed = (actions: AgentAction[]) => actions.filter(({ type }) => type === 'type-text');
  // Chooses the command from the Chrome Commands scan (Search lit at 15.1 s, New Tab at 19.1 s), which opens the Gaze
  // Keyboard, then presses keys by waiting for the scan to reach each one.
  const chooseCommand = (name: 'search' | 'new-tab') => {
    const started = thinking(true);
    const { session } = started;
    session(claude(5000, ['Pause']));
    session(select(15_100));
    let t = name === 'search' ? 15_200 : 19_200;
    expect(session(tick(t))).toMatchObject({ highlight: name });
    let state = session(select((t += 100)));
    const press = (id: string) => {
      while (state.phase === 'typing' && state.highlight !== id) state = session(tick((t += 100)));
      return (state = session(select(t)));
    };
    return { ...started, state, press, at: () => t };
  };

  for (const name of ['search', 'new-tab'] as const) {
    it(`${name} runs as a Fixed Intent and opens the Gaze Keyboard, asking Claude for nothing`, () => {
      const { state, fromPicker } = chooseCommand(name);
      expect(state).toMatchObject({ phase: 'typing', text: '', highlight: 'abcde' });
      expect(fromPicker().filter(({ type }) => type === 'fixed-intent')).toEqual([{ type: 'fixed-intent', name }]);
      expect(runsOrAsks(fromPicker())).toEqual([]);
    });

    it(`${name} submits the text on Done, whatever the field`, () => {
      const { press, fromPicker } = chooseCommand(name);
      press('abcde');
      press('a');
      expect(press('done')).toEqual({ phase: 'idle', wakeProgress: 0 });
      expect(typed(fromPicker())).toEqual([{ type: 'type-text', text: 'a', submit: true }]);
      expect(gazeLabels(fromPicker())).toEqual([]);
    });

    it(`${name} closes the keyboard on the Stop Gesture without typing`, () => {
      const { session, press, at, fromPicker } = chooseCommand(name);
      press('abcde');
      press('a');
      session(gaze(at() + 100, offScreen));
      expect(session(gaze(at() + 10_000, offScreen)).phase).toBe('idle');
      expect(typed(fromPicker())).toEqual([]);
    });
  }

  it('leaves Done after Type to the field, so the submit is only for Search and New Tab', () => {
    const { session, actions } = thinking(true);
    session(claude(5000, ['Pause']));
    // Type is the fourth tile, lit from 11 s.
    expect(session(tick(11_000))).toMatchObject({ highlight: 'type' });
    let state = session(select(11_100));
    let t = 11_100;
    const press = (id: string) => {
      while (state.phase === 'typing' && state.highlight !== id) state = session(tick((t += 100)));
      return (state = session(select(t)));
    };
    press('abcde');
    press('a');
    press('done');
    expect(typed(actions)).toEqual([{ type: 'type-text', text: 'a' }]);
  });
});
