// Issues #67, #68 and #96: the Chrome-only Fixed Intents. With Chrome in front, Search shows after Type and a Chrome tile
// after Dock; choosing Chrome starts a second scan over Next Tab, New Tab and Close Tab, which run as key presses in main
// with no Claude call. Search and New Tab open the Gaze Keyboard, whose Done always submits.
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

const COMMANDS = ['next-tab', 'new-tab', 'close-tab', CLOSE_KEY];
const ids = (state: ReturnType<ReturnType<typeof createSession>>) => (state.phase === 'choosing' ? layoutIntents(screen, state).map(({ id }) => id) : []);
const runsOrAsks = (actions: AgentAction[]) => actions.filter(({ type }) => type === 'suggest-intents' || type === 'run-intent');
const gazeLabels = (actions: AgentAction[]) => actions.filter((action) => action.type === 'learn' && action.signal.kind === 'gaze');

const IN_CHROME = [CLOSE_KEY, 'quit', 'minimize', 'type', 'search', 'dock', 'chrome'];

describe('the Search and Chrome Fixed Intents', () => {
  it('are not offered when Chrome is not in front', () => {
    const { session } = thinking(false);
    const state = session(claude(5000, ['Pause', 'Mute']));
    expect(state).toMatchObject({ phase: 'choosing', fixed: [CLOSE_KEY, 'quit', 'minimize', 'type', 'dock'] });
    expect(ids(state)).not.toContain('search');
    expect(ids(state)).not.toContain('chrome');
  });

  it('are offered in Chrome, Search after Type and Chrome after Dock, before Claude’s', () => {
    const { session } = thinking(true);
    const opened = session(pastIntents(4500, ['Pause', 'Mute']));
    expect(opened).toMatchObject({ phase: 'choosing', fixed: IN_CHROME, recent: 2 });
    const state = session(claude(5000, ['Like', 'Share', 'Save']));
    // The picker holds 12 tiles at most, so Claude's third Intent has no room here.
    expect(ids(state)).toEqual(['intent-0', 'intent-1', ...IN_CHROME, 'intent-2', 'intent-3', 'something-else']);
  });

  it('Chrome starts a scan over the Chrome Commands, without asking Claude or running anything', () => {
    const { session, fromPicker } = thinking(true);
    // No past Intents, so Chrome is the seventh tile, lit from 17 s.
    session(claude(5000, ['Pause']));
    expect(session(tick(17_000))).toMatchObject({ highlight: 'chrome' });
    const state = session(select(17_100));
    expect(state).toMatchObject({ phase: 'choosing', intents: [], fixed: COMMANDS, highlight: 'next-tab', suggesting: false });
    expect(ids(state)).toEqual([...COMMANDS, 'something-else']);
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });
});

describe('the Chrome Commands scan', () => {
  // In the Chrome Commands scan from 17.1 s: Next Tab lit first, New Tab from 19.1 s, Close Tab from 21.1 s, Close from
  // 23.1 s and Something else from 25.1 s.
  const inCommands = () => {
    const started = thinking(true);
    started.session(claude(5000, ['Pause']));
    started.session(select(17_100));
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
    // One for choosing Chrome, one for Next Tab.
    expect(fromPicker().filter((action) => action.type === 'learn' && action.signal.kind === 'select')).toHaveLength(2);
  });

  it('ends on the Stop Gesture without choosing anything', () => {
    const { session, fromPicker } = inCommands();
    session(gaze(17_200, offScreen));
    expect(session(gaze(22_199, offScreen)).phase).toBe('choosing');
    expect(session(gaze(22_200, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
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

  it("keeps Claude's late answer out of it, when Chrome was chosen before Claude answered", () => {
    const { session, fromPicker } = thinking(true);
    session(pastIntents(4500, ['Pause', 'Mute']));
    // Chrome is the ninth tile, lit from 20.5 s.
    expect(session(tick(20_600))).toMatchObject({ highlight: 'chrome' });
    session(select(20_700));
    const state = session(claude(21_000, ['Like', 'Share', 'Save']));
    expect(state).toMatchObject({ intents: [], fixed: COMMANDS });
    expect(runsOrAsks(fromPicker())).toEqual([]);
  });

  it('shows the main picker again, not the Chrome Commands, on the next picker', () => {
    const { session } = inCommands();
    session(select(17_200));
    session(gaze(18_000, inBox));
    session(gaze(21_000, inBox));
    session(gaze(21_100, target));
    session(gaze(22_100, target));
    expect(session({ type: 'intents', t: 23_000, request: 2, intents: ['Pause'] })).toMatchObject({ fixed: IN_CHROME });
  });
});

describe('Search and New Tab', () => {
  const typed = (actions: AgentAction[]) => actions.filter(({ type }) => type === 'type-text');
  // Chooses Search from the main picker (lit from 13 s), or New Tab from the Chrome Commands scan (Chrome chosen at
  // 17.1 s, New Tab lit from 19.1 s), which opens the Gaze Keyboard, then presses keys by waiting for the scan to reach
  // each one.
  const chooseCommand = (name: 'search' | 'new-tab') => {
    const started = thinking(true);
    const { session } = started;
    session(claude(5000, ['Pause']));
    if (name === 'new-tab') session(select(17_100));
    let t = name === 'search' ? 13_000 : 19_200;
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
