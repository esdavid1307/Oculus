import { describe, expect, it, vi } from 'vitest';
import type { GazeEvent, GazeRegion } from './gaze';
import { GROUPS, layoutKeyboard } from './keyboard';
import { createSession, type AgentAction, type CorrectGaze } from './session';

// Extra session checks from the review of #29: which presses teach Gaze Correction, and how the corrected and
// uncorrected gaze are used.

const screen = { width: 1600, height: 1000 };
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });
const keyRect = (id: string, group: string | null = null) => layoutKeyboard(screen, group).keys.find((key) => key.id === id)!.rect;
const keyCentre = (id: string, group: string | null = null) => {
  const { x, y, width, height } = keyRect(id, group);
  return { x: x + width / 2, y: y + height / 2 };
};
const groupOf = (letter: string) => GROUPS.find((group) => group.includes(letter))!;
// The typed-text strip, which holds no key, so looking there is a Move Off.
const moveOff = { x: 800, y: 60 };

function typing({ timings, correct }: { timings?: unknown; correct?: CorrectGaze } = {}) {
  const actions: AgentAction[] = [];
  const session = createSession({ screen, timings, act: (action) => actions.push(action), correct });
  session({ type: 'open-keyboard', t: 0 });
  let t = 0;
  let group: string | null = null;
  const look = (at: { x: number; y: number }, ms = 100) => {
    const state = session(gaze((t += ms), { ...at, radius: 120 }));
    if (state.phase === 'typing') group = state.group;
    return state;
  };
  const hold = (id: string, ms = 1000) => {
    const at = keyCentre(id, group);
    look(at);
    look(at, ms);
    return look(moveOff);
  };
  const type = (...ids: string[]) => {
    for (const id of ids) {
      if (id.length === 1) hold(groupOf(id));
      hold(id);
    }
  };
  const learned = () => actions.flatMap((action) => (action.type === 'learn-gaze' ? [action.examples] : []));
  return { session, actions, look, hold, type, learned, at: () => t };
}

describe('Which presses teach Gaze Correction', () => {
  it('typing "hello" and Done teaches 11 presses, as in docs/gaze-correction.md', () => {
    const { type, learned } = typing();
    type('h', 'e', 'l', 'l', 'o', 'done');
    expect(learned()).toHaveLength(1);
    expect(learned()[0]).toHaveLength(11);
  });

  it('takes the average uncorrected gaze over the dwell, not just one sample', () => {
    const { session, learned } = typing();
    const c = keyCentre('done');
    session(gaze(100, { x: c.x - 40, y: c.y - 20, radius: 120 }));
    session(gaze(500, { x: c.x + 40, y: c.y + 20, radius: 120 }));
    session(gaze(1100, { x: c.x, y: c.y, radius: 120 }));
    const [[{ gaze: average, target }]] = learned();
    expect(average.x).toBeCloseTo(c.x);
    expect(average.y).toBeCloseTo(c.y);
    expect(target).toEqual(c);
  });

  it('drops only the space when Delete removes a space', () => {
    const { type, learned } = typing();
    type('a', 'space', 'delete', 'done');
    const targets = learned()[0].map(({ target }) => target);
    expect(targets).not.toContainEqual(keyCentre('space'));
    expect(targets).toContainEqual(keyCentre('a', 'abcde'));
  });

  it('Delete with no text drops nothing it should keep', () => {
    const { type, learned } = typing();
    type('delete', 'a', 'done');
    expect(learned()[0].map(({ target }) => target)).toEqual([
      keyCentre('abcde'),
      keyCentre('a', 'abcde'),
      keyCentre('delete'),
      keyCentre('done'),
    ]);
  });

  it('two Deletes drop both characters, and a character typed after them is taught', () => {
    const { type, learned } = typing();
    type('a', 'b', 'delete', 'delete', 'c', 'done');
    // 'a' sits in the same cell as the ABCDE group, so the list is checked whole: one group press, for 'c'.
    expect(learned()[0].map(({ target }) => target)).toEqual([
      keyCentre('abcde'),
      keyCentre('c', 'abcde'),
      keyCentre('delete'),
      keyCentre('delete'),
      keyCentre('done'),
    ]);
  });

  it('Done with no text still teaches the Done press', () => {
    const { hold, actions } = typing();
    hold('done');
    expect(actions).toEqual([{ type: 'learn-gaze', examples: [{ gaze: keyCentre('done'), target: keyCentre('done') }] }]);
  });

  it('a press that the correction picked is taught as what the user chose', () => {
    // The corrected gaze lands 200 px right of the uncorrected gaze.
    const correct = (region: GazeRegion) => ({ ...region, x: region.x + 200 });
    const { session, learned } = typing({ correct });
    const c = keyCentre('done');
    session(gaze(100, { x: c.x - 200, y: c.y, radius: 120 }));
    session(gaze(1100, { x: c.x - 200, y: c.y, radius: 120 }));
    expect(learned()[0]).toEqual([{ gaze: { x: c.x - 200, y: c.y }, target: c }]);
  });
});

describe('The Reset gaze key', () => {
  it('sits between Space and Done, and only on the group screen', () => {
    expect(keyRect('reset').x).toBeGreaterThan(keyRect('space').x);
    expect(keyRect('reset').x).toBeLessThan(keyRect('done').x);
    for (const group of GROUPS) expect(layoutKeyboard(screen, group).keys.map(({ id }) => id)).not.toContain('reset');
  });

  it('shows half its fill after one key dwell', () => {
    const { session } = typing();
    const c = keyCentre('reset');
    session(gaze(100, { ...c, radius: 120 }));
    const state = session(gaze(1100, { ...c, radius: 120 }));
    expect(state.phase === 'typing' && state.dwell).toEqual({ key: 'reset', progress: 0.5 });
  });

  it('takes twice a custom key dwell too', () => {
    const { session, actions } = typing({ timings: { keyDwellMs: 400, gazeCorrection: false } });
    const c = keyCentre('reset');
    session(gaze(100, { ...c, radius: 120 }));
    session(gaze(500, { ...c, radius: 120 }));
    expect(actions).toEqual([]);
    session(gaze(900, { ...c, radius: 120 }));
    expect(actions).toEqual([{ type: 'reset-gaze-correction' }]);
  });

  it('resets once per look, and again after a Move Off', () => {
    const { hold, actions } = typing();
    const { look } = { look: hold };
    look('reset', 4000);
    expect(actions).toEqual([{ type: 'reset-gaze-correction' }]);
    look('reset', 2000);
    expect(actions).toHaveLength(2);
  });

  it('keeps the typed text', () => {
    const { type, hold, session, at } = typing();
    type('h', 'i');
    hold('reset', 2000);
    const state = session({ type: 'tick', t: at() + 1 });
    expect(state.phase === 'typing' && state.text).toBe('hi');
  });

  it('presses made after a reset still count, and Delete after a reset drops nothing it should keep', () => {
    const { type, hold, learned } = typing();
    type('a');
    hold('reset', 2000);
    type('b', 'delete', 'delete', 'c', 'done');
    // 'a' was taught before the reset, 'b' was deleted, so only the c presses, both Deletes and Done remain.
    expect(learned()[0].map(({ target }) => target)).toEqual([
      keyCentre('abcde'),
      keyCentre('c', 'abcde'),
      keyCentre('delete'),
      keyCentre('delete'),
      keyCentre('done'),
    ]);
  });
});

describe('Recalibration', () => {
  it('resets Gaze Correction even when the agent is idle', () => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, act: (action) => actions.push(action) });
    expect(session({ type: 'recalibrated', t: 0 })).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(actions).toEqual([{ type: 'reset-gaze-correction' }]);
  });

  it('puts an awake agent back to sleep', () => {
    const session = createSession({ screen });
    session(gaze(0, { x: 800, y: 500, radius: 120 }));
    expect(session(gaze(3000, { x: 800, y: 500, radius: 120 })).phase).toBe('waiting-for-target');
    expect(session({ type: 'recalibrated', t: 3100 }).phase).toBe('idle');
  });

  it('clears a half-filled wake hold', () => {
    const session = createSession({ screen });
    session(gaze(0, { x: 800, y: 500, radius: 120 }));
    session(gaze(2000, { x: 800, y: 500, radius: 120 }));
    session({ type: 'recalibrated', t: 2100 });
    expect(session(gaze(3500, { x: 800, y: 500, radius: 120 })).phase).toBe('idle');
  });

  it('the next keyboard starts empty and teaches only its own presses', () => {
    const { session, type, learned, at } = typing();
    type('h', 'i');
    session({ type: 'recalibrated', t: at() + 1 });
    session({ type: 'open-keyboard', t: at() + 2 });
    const state = session({ type: 'tick', t: at() + 3 });
    expect(state.phase === 'typing' && state.text).toBe('');
    // The helper's clock keeps going from where it was.
    const c = keyCentre('done');
    session(gaze(at() + 100, { ...c, radius: 120 }));
    session(gaze(at() + 1100, { ...c, radius: 120 }));
    expect(learned()).toEqual([[{ gaze: c, target: c }]]);
  });

  it('a dwell that was filling before recalibration starts over', () => {
    const { session, actions } = typing();
    const c = keyCentre('done');
    session(gaze(100, { ...c, radius: 120 }));
    session(gaze(900, { ...c, radius: 120 }));
    session({ type: 'recalibrated', t: 950 });
    session({ type: 'open-keyboard', t: 960 });
    session(gaze(1000, { ...c, radius: 120 }));
    session(gaze(1200, { ...c, radius: 120 }));
    expect(actions.filter(({ type }) => type === 'learn-gaze')).toEqual([]);
  });
});

describe('Corrected and uncorrected gaze', () => {
  it('passes only real Gaze Regions to the correction', () => {
    const correct = vi.fn((region: GazeRegion) => region);
    const session = createSession({ screen, correct });
    session({ type: 'tick', t: 0 });
    session(gaze(1, null));
    session({ type: 'open-keyboard', t: 2 });
    session({ type: 'recalibrated', t: 3 });
    expect(correct).not.toHaveBeenCalled();
    session(gaze(4, { x: 1, y: 2, radius: 3 }));
    expect(correct).toHaveBeenCalledExactlyOnceWith({ x: 1, y: 2, radius: 3 });
  });

  it('a correction that pushes the gaze off the screen presses nothing and does not stop the keyboard', () => {
    const correct = (region: GazeRegion) => ({ ...region, x: region.x + 150 });
    const { session } = typing({ correct });
    // On screen uncorrected, off the right edge corrected.
    for (let t = 100; t <= 8000; t += 100) session(gaze(t, { x: 1500, y: 870, radius: 120 }));
    const state = session({ type: 'tick', t: 8100 });
    expect(state.phase).toBe('typing');
  });

  // Review finding 6: Look Away runs on the uncorrected gaze, but keys are hit-tested on the corrected gaze. Just past the bottom
  // edge, a learned upward shift lands on Done, so Done fires 1 s into what the user meant as a 5 s Stop Gesture.
  it('a look just past the bottom edge, meant as a Stop Gesture, never types the text', () => {
    const correct = (region: GazeRegion) => ({ ...region, y: region.y - 100 });
    const { session, type, actions, at } = typing({ correct });
    type('h', 'i');
    const start = at();
    for (let t = start + 100; t <= start + 6000; t += 100) session(gaze(t, { x: 1340, y: 1050, radius: 120 }));
    expect(actions.filter(({ type }) => type === 'type-text')).toEqual([]);
  });

  it('a correction does not bend Look Away while the agent is awake (no keyboard)', () => {
    const correct = (region: GazeRegion) => ({ ...region, y: 500 });
    const session = createSession({ screen, correct });
    session(gaze(0, { x: 800, y: 500, radius: 120 }));
    session(gaze(3000, { x: 800, y: 500, radius: 120 }));
    session(gaze(3100, null));
    expect(session(gaze(8100, null)).phase).toBe('idle');
  });

  it('unknown keys in config.json, such as gazeCorrection, leave the timings alone', () => {
    const session = createSession({ screen, timings: { gazeCorrection: false, wakeHoldMs: 1000 } });
    session(gaze(0, { x: 800, y: 500, radius: 120 }));
    expect(session(gaze(1000, { x: 800, y: 500, radius: 120 })).phase).toBe('waiting-for-target');
  });
});
