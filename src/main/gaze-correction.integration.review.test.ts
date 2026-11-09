import { describe, expect, it } from 'vitest';
import type { GazeEvent, GazeRegion } from '../shared/gaze';
import { GROUPS, layoutKeyboard } from '../shared/keyboard';
import { createSession, type AgentAction, type OverlayState } from '../shared/session';
import { createGazeCorrection } from './gaze-correction';

// The real session and the real network, wired the way src/main/index.ts wires them, with a tracker that reads every
// look a fixed distance off. This is the whole learning loop without Electron.

const screen = { width: 1512, height: 982 };
const keyCentre = (id: string, group: string | null = null) => {
  const { x, y, width, height } = layoutKeyboard(screen, group).keys.find((key) => key.id === id)!.rect;
  return { x: x + width / 2, y: y + height / 2 };
};
const groupOf = (letter: string) => GROUPS.find((group) => group.includes(letter))!;

function app({ enabled = true, error = { x: -100, y: 50 } } = {}) {
  const correction = createGazeCorrection({ screen, enabled, seed: 1 });
  const typed: string[] = [];
  let pending = Promise.resolve();
  // Same as perform() in src/main/index.ts.
  const perform = (action: AgentAction) => {
    if (action.type === 'type-text') typed.push(action.text);
    else if (action.type === 'reset-gaze-correction') correction.reset();
    else pending = correction.learn(action.examples);
  };
  const session = createSession({ screen, act: perform, correct: correction.correct });
  let t = 0;
  let state: OverlayState = { phase: 'idle', wakeProgress: 0 };
  let group: string | null = null;
  // The user looks at `at`; the tracker reports it `error` px off.
  const look = (at: { x: number; y: number }, ms = 100) => {
    const region: GazeRegion = { x: at.x + error.x, y: at.y + error.y, radius: 120 };
    state = session({ type: 'gaze', t: (t += ms), region } satisfies GazeEvent);
    if (state.phase === 'typing') group = state.group;
    return state;
  };
  const hold = (id: string, ms = 1000, offset = { x: 0, y: 0 }) => {
    const c = keyCentre(id, group);
    const at = { x: c.x + offset.x, y: c.y + offset.y };
    look(at);
    for (let waited = 0; waited < ms; waited += 100) look(at);
    return look({ x: screen.width / 2, y: 50 });
  };
  const typeWord = (word: string) => {
    for (const letter of word) {
      hold(groupOf(letter));
      hold(letter);
    }
    hold('done');
  };
  const open = () => (state = session({ type: 'open-keyboard', t: (t += 1) }));
  return { correction, session, typed, look, hold, typeWord, open, settle: () => pending, state: () => state, now: () => t };
}

describe('Gaze Correction, end to end', () => {
  it('typing "hello" teaches it the tracker error, as docs/gaze-correction.md shows', async () => {
    const run = app();
    run.open();
    run.typeWord('hello');
    await run.settle();
    expect(run.typed).toEqual(['hello']);
    expect(run.correction.exampleCount).toBe(11);
    const centre = { x: screen.width / 2, y: screen.height / 2, radius: 0 };
    const shifted = run.correction.correct(centre);
    expect(Math.abs(shifted.x - centre.x - 100)).toBeLessThan(5);
    expect(Math.abs(shifted.y - centre.y + 50)).toBeLessThan(5);
  });

  it('after learning, a look near a key edge picks the key the user meant; without it, the wrong one', async () => {
    // The tracker reads 140 px left. The user looks 60 px inside the left edge of the KLMNO key.
    const error = { x: -140, y: 0 };
    const nearLeftEdge = { x: -(keyCentre('klmno').x - keyCentre('fghij').x) / 2 + 60, y: 0 };
    const learned = app({ error });
    const off = app({ enabled: false, error });
    for (const run of [learned, off]) {
      run.open();
      run.typeWord('hi');
      run.open();
      run.typeWord('ok');
      await run.settle();
      run.open();
      run.hold('klmno', 1000, nearLeftEdge);
    }
    expect(learned.correction.active).toBe(true);
    expect(learned.state()).toMatchObject({ phase: 'typing', group: 'klmno' });
    expect(off.correction.active).toBe(false);
    expect(off.state()).toMatchObject({ phase: 'typing', group: 'fghij' });
  });

  it('the Reset gaze key forgets what was learned', async () => {
    const run = app();
    run.open();
    run.typeWord('hello');
    await run.settle();
    expect(run.correction.active).toBe(true);
    run.open();
    run.hold('reset', 2000);
    expect(run.correction.active).toBe(false);
    expect(run.correction.exampleCount).toBe(0);
  });

  it('recalibration forgets what was learned, even while training is still running', async () => {
    const run = app();
    run.open();
    run.typeWord('hello');
    run.session({ type: 'recalibrated', t: run.now() + 1 });
    await run.settle();
    expect(run.correction.active).toBe(false);
  });

  it('a Stop Gesture teaches nothing and types nothing', async () => {
    const run = app();
    run.open();
    for (const letter of 'hello') {
      run.hold(groupOf(letter));
      run.hold(letter);
    }
    for (let i = 0; i < 60; i++) run.look({ x: screen.width / 2, y: -1000 });
    await run.settle();
    expect(run.state().phase).toBe('idle');
    expect(run.typed).toEqual([]);
    expect(run.correction.exampleCount).toBe(0);
  });

  it('switched off, it learns nothing and the Gaze Region passes through untouched', async () => {
    const run = app({ enabled: false });
    run.open();
    run.typeWord('hello');
    await run.settle();
    expect(run.typed).toEqual(['hello']);
    expect(run.correction.exampleCount).toBe(0);
    expect(run.correction.correct({ x: 10, y: 20, radius: 30 })).toEqual({ x: 10, y: 20, radius: 30 });
  });

  it('keeps up with 30 fps gaze for a minute once trained (non-functional)', async () => {
    const run = app();
    run.open();
    run.typeWord('hello');
    await run.settle();
    const start = performance.now();
    for (let i = 0; i < 30 * 60; i++) run.look({ x: (i * 13) % screen.width, y: (i * 7) % screen.height }, 33);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
