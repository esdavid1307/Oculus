// Issue #93: the Quit Fixed Intent, after Close. Its tile names the app in front, read once as the picker opens, and
// choosing it asks main to quit that app, then goes back to waiting for the Start Gesture.
import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { CLOSE_KEY, layoutIntents } from './keyboard';
import { createSession, type AgentAction } from './session';

const screen = { width: 1600, height: 1000 };
const inBox = { x: 800, y: 500, radius: 120 };
const target = { x: 300, y: 300, radius: 120 };
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });
const tick = (t: number) => ({ type: 'tick', t }) as const;
const select = (t: number) => ({ type: 'select', t }) as const;
const claude = (t: number, intents: string[]) => ({ type: 'intents', t, request: 1, intents }) as const;

// Woken at 3 s, the target held from 3.1 s to 4.1 s, so the session is thinking with suggest-intents request 1 out.
function thinking(front: { app: string }, inChrome = false) {
  const actions: AgentAction[] = [];
  const session = createSession({ screen, act: (action) => actions.push(action), frontApp: () => front.app, inChrome: () => inChrome });
  session(gaze(0, inBox));
  session(gaze(3000, inBox));
  session(gaze(3100, target));
  session(gaze(4100, target));
  const mark = actions.length;
  return { session, fromPicker: () => actions.slice(mark) };
}

const keysOf = (state: ReturnType<ReturnType<typeof createSession>>) => (state.phase === 'choosing' ? layoutIntents(screen, state) : []);

describe('the Quit Fixed Intent', () => {
  it('shows after Close and before Minimize, Type and Dock, and Search and Chrome in Chrome', () => {
    expect(thinking({ app: 'TextEdit' }).session(claude(5000, ['Pause']))).toMatchObject({ fixed: [CLOSE_KEY, 'quit', 'minimize', 'type', 'dock'] });
    expect(thinking({ app: 'Google Chrome' }, true).session(claude(5000, ['Pause']))).toMatchObject({
      fixed: [CLOSE_KEY, 'quit', 'minimize', 'type', 'search', 'dock', 'chrome'],
    });
  });

  it('names the app in front on its tile', () => {
    const keys = keysOf(thinking({ app: 'Google Chrome' }, true).session(claude(5000, ['Pause'])));
    expect(keys.find(({ id }) => id === 'quit')?.label).toBe('Quit Google Chrome');
  });

  it.each([['Finder'], ['']])('is hidden when the app in front is %j', (app) => {
    expect(thinking({ app }).session(claude(5000, ['Pause']))).toMatchObject({ fixed: [CLOSE_KEY, 'minimize', 'type', 'dock'] });
  });

  it('keeps its tile when the app in front changes after the picker opens', () => {
    const front = { app: 'Messages' };
    const { session } = thinking(front);
    session(claude(5000, ['Pause']));
    front.app = 'Finder';
    const keys = keysOf(session(tick(6000)));
    expect(keys.map(({ id }) => id)).toContain('quit');
    expect(keys.find(({ id }) => id === 'quit')?.label).toBe('Quit Messages');
  });

  it('asks main to quit the app it named, goes back to idle, and teaches only Scan Pace', () => {
    const front = { app: 'TextEdit' };
    const { session, fromPicker } = thinking(front);
    // Claude's Intents arrive at 5 s with no past ones, so Quit, after Close, is lit from 7 s.
    session(claude(5000, ['Pause']));
    expect(session(tick(7000))).toMatchObject({ highlight: 'quit' });
    front.app = 'Finder';
    expect(session(select(7100)).phase).toBe('idle');
    const actions = fromPicker();
    expect(actions).toContainEqual({ type: 'fixed-intent', name: 'quit', app: 'TextEdit' });
    expect(actions.filter(({ type }) => type === 'run-intent' || type === 'suggest-intents')).toEqual([]);
    expect(actions.filter((action) => action.type === 'learn' && action.signal.kind === 'gaze')).toEqual([]);
    expect(actions.filter((action) => action.type === 'learn' && action.signal.kind === 'select')).toHaveLength(1);
  });
});
