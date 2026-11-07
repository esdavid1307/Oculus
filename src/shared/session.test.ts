import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { cornerTargets, type Rect } from './geometry';
import { layoutKeyboard } from './keyboard';
import { createSession, type AgentAction, type OverlayState } from './session';

const screen = { width: 1600, height: 1000 };
const onWakeTarget = { x: 1500, y: 100, radius: 60 };
const offTarget = { x: 800, y: 500, radius: 60 };

const typedText = (state: OverlayState) => (state.phase === 'typing' ? state.text : null);
const tick = (t: number) => ({ type: 'tick', t }) as const;
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });

describe('Wake Gesture', () => {
  it('wakes the agent after 2 seconds on the top-right target', () => {
    const session = createSession({ screen });
    session(gaze(0, onWakeTarget));
    expect(session(gaze(1999, onWakeTarget)).phase).toBe('idle');
    expect(session(gaze(2000, onWakeTarget)).phase).toBe('waiting-for-target');
  });

  it('counts a Gaze Region that overlaps the target, even with its centre outside', () => {
    const session = createSession({ screen });
    const overlapping = { x: 1320, y: 280, radius: 60 };
    session(gaze(0, overlapping));
    expect(session(gaze(2000, overlapping)).phase).toBe('waiting-for-target');
  });

  it('does not count a Gaze Region that only comes close to the target', () => {
    const session = createSession({ screen });
    const nearby = { x: 1300, y: 290, radius: 60 };
    session(gaze(0, nearby));
    expect(session(gaze(2000, nearby)).phase).toBe('idle');
  });

  it('restarts the hold when the user looks away', () => {
    const session = createSession({ screen });
    session(gaze(0, onWakeTarget));
    session(gaze(1000, offTarget));
    session(gaze(1100, onWakeTarget));
    expect(session(gaze(2100, onWakeTarget)).phase).toBe('idle');
    expect(session(gaze(3100, onWakeTarget)).phase).toBe('waiting-for-target');
  });

  it('restarts the hold when tracking is lost', () => {
    const session = createSession({ screen });
    session(gaze(0, onWakeTarget));
    session(gaze(1000, null));
    expect(session(gaze(2000, onWakeTarget)).phase).toBe('idle');
  });

  it('fills the ring during the hold and empties it on looking away', () => {
    const session = createSession({ screen });
    expect(session(gaze(0, onWakeTarget)).wakeProgress).toBe(0);
    expect(session(gaze(500, onWakeTarget)).wakeProgress).toBe(0.25);
    expect(session(gaze(1500, onWakeTarget)).wakeProgress).toBe(0.75);
    expect(session(gaze(1600, offTarget)).wakeProgress).toBe(0);
  });

  it('does not count a hold on the bottom-left target', () => {
    const session = createSession({ screen });
    session(gaze(0, { x: 100, y: 900, radius: 60 }));
    const state = session(gaze(2000, { x: 100, y: 900, radius: 60 }));
    expect(state).toEqual({ phase: 'idle', wakeProgress: 0 });
  });
});

describe('waiting for a target', () => {
  const wokenAt2s = () => {
    const session = createSession({ screen });
    session(gaze(0, onWakeTarget));
    session(gaze(2000, onWakeTarget));
    return session;
  };

  it('empties the ring once awake', () => {
    expect(wokenAt2s()(gaze(2100, offTarget))).toEqual({ phase: 'waiting-for-target', wakeProgress: 0 });
  });

  it('cancels after 5 seconds on timer ticks alone', () => {
    const session = wokenAt2s();
    expect(session(tick(6999)).phase).toBe('waiting-for-target');
    expect(session(tick(7000)).phase).toBe('idle');
  });

  it('needs a full new hold to wake again after cancelling', () => {
    const session = wokenAt2s();
    session(gaze(3000, onWakeTarget));
    session(tick(7000));
    expect(session(gaze(7100, onWakeTarget))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(session(gaze(9099, onWakeTarget)).phase).toBe('idle');
    expect(session(gaze(9100, onWakeTarget)).phase).toBe('waiting-for-target');
  });
});

describe('timings', () => {
  it('uses configured timings', () => {
    const session = createSession({ screen, timings: { wakeHoldMs: 1000, targetTimeoutMs: 300 } });
    session(gaze(0, onWakeTarget));
    expect(session(gaze(500, onWakeTarget)).wakeProgress).toBe(0.5);
    expect(session(gaze(1000, onWakeTarget)).phase).toBe('waiting-for-target');
    expect(session(tick(1300)).phase).toBe('idle');
  });

  it('keeps the default for a timing left out', () => {
    const session = createSession({ screen, timings: { targetTimeoutMs: 300 } });
    session(gaze(0, onWakeTarget));
    expect(session(gaze(1000, onWakeTarget)).wakeProgress).toBe(0.5);
  });

  it.each([[null], ['fast'], [{ wakeHoldMs: 'slow' }], [{ wakeHoldMs: -1 }], [{ wakeHoldMs: 0 }], [{ wakeHoldMs: null }]])(
    'falls back to the defaults for invalid timings %j',
    (timings) => {
      const session = createSession({ screen, timings });
      session(gaze(0, onWakeTarget));
      expect(session(gaze(1000, onWakeTarget))).toEqual({ phase: 'idle', wakeProgress: 0.5 });
    },
  );
});

describe('Gaze Keyboard', () => {
  const { keys, text } = layoutKeyboard(screen);
  const onTypedText = { x: text.x + text.width / 2, y: text.y + text.height / 2, radius: 60 };
  const rectOf = (id: string) => keys.find((key) => key.id === id)!.rect;
  const onKey = (id: string) => {
    const { x, y, width, height } = rectOf(id);
    return { x: x + width / 2, y: y + height / 2, radius: 60 };
  };

  const typing = (timings?: unknown) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, timings, act: (action) => actions.push(action) });
    session({ type: 'open-keyboard', t: 0 });
    let t = 0;
    // Looks away, then holds on each key for a full dwell.
    const type = (...ids: string[]) => {
      let state = session(gaze((t += 100), null));
      for (const id of ids) {
        session(gaze((t += 100), onKey(id)));
        state = session(gaze((t += 1000), onKey(id)));
        session(gaze((t += 100), onTypedText));
      }
      return state;
    };
    return { session, actions, type, at: () => t };
  };

  it('opens with no text', () => {
    const session = createSession({ screen });
    expect(session({ type: 'open-keyboard', t: 0 })).toEqual({ phase: 'typing', wakeProgress: 0, text: '', dwell: null });
  });

  it('types a letter after a 1 second dwell on its key', () => {
    const { session } = typing();
    session(gaze(0, onKey('h')));
    expect(typedText(session(gaze(999, onKey('h'))))).toBe('');
    expect(typedText(session(gaze(1000, onKey('h'))))).toBe('h');
  });

  it('shows dwell progress on the key being looked at', () => {
    const { session } = typing();
    session(gaze(0, onKey('a')));
    expect(session(gaze(250, onKey('a')))).toMatchObject({ dwell: { key: 'a', progress: 0.25 } });
    expect(session(gaze(300, onKey('b')))).toMatchObject({ dwell: { key: 'b', progress: 0 } });
    expect(session(gaze(400, onTypedText))).toMatchObject({ dwell: null });
  });

  it('restarts the dwell when the gaze moves to another key', () => {
    const { session } = typing();
    session(gaze(0, onKey('a')));
    session(gaze(900, onKey('a')));
    session(gaze(950, onKey('b')));
    expect(typedText(session(gaze(1900, onKey('b'))))).toBe('');
    expect(typedText(session(gaze(1950, onKey('b'))))).toBe('b');
  });

  it('restarts the dwell when tracking is lost', () => {
    const { session } = typing();
    session(gaze(0, onKey('a')));
    session(gaze(500, null));
    expect(typedText(session(gaze(1000, onKey('a'))))).toBe('');
  });

  it('presses a key once per look, and again after looking away', () => {
    const { session } = typing();
    session(gaze(0, onKey('l')));
    session(gaze(1000, onKey('l')));
    expect(session(gaze(3000, onKey('l')))).toMatchObject({ text: 'l', dwell: { key: 'l', progress: 1 } });
    session(gaze(3100, onTypedText));
    session(gaze(3200, onKey('l')));
    expect(typedText(session(gaze(4200, onKey('l'))))).toBe('ll');
  });

  it('types words with Space', () => {
    expect(typedText(typing().type('h', 'i', 'space', 'y', 'o', 'u'))).toBe('hi you');
  });

  it('removes the last character with Delete', () => {
    const { type } = typing();
    type('c', 'a', 't', 'x');
    expect(typedText(type('delete'))).toBe('cat');
  });

  it('does nothing on Delete with no text', () => {
    expect(typedText(typing().type('delete', 'a'))).toBe('a');
  });

  it('puts the text in the focused box and returns to the app on Done', () => {
    const { type, actions } = typing();
    type('o', 'k');
    expect(type('done')).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(actions).toEqual([{ type: 'type-text', text: 'ok' }]);
  });

  it('requests no typing when Done is pressed with no text', () => {
    const { type, actions } = typing();
    expect(type('done').phase).toBe('idle');
    expect(actions).toEqual([]);
  });

  it('starts with no text when opened again', () => {
    const { session, type } = typing();
    type('a', 'done');
    expect(session({ type: 'open-keyboard', t: 99_000 })).toMatchObject({ text: '' });
  });

  it('keeps the text when asked to open while already typing', () => {
    const { session, type, at } = typing();
    type('a');
    expect(typedText(session({ type: 'open-keyboard', t: at() + 1 }))).toBe('a');
  });

  it('does not time out while typing', () => {
    const { session } = typing();
    expect(session(tick(60_000)).phase).toBe('typing');
  });

  it('ignores the Wake Gesture while typing', () => {
    const { session } = typing();
    session(gaze(0, onWakeTarget));
    expect(session(gaze(5000, onWakeTarget))).toEqual({ phase: 'typing', wakeProgress: 0, text: '', dwell: null });
  });

  it('never presses a key when the Gaze Region overlaps a corner target', () => {
    const { session } = typing();
    const del = rectOf('delete');
    const nearStop = { x: del.x + 120, y: del.y + del.height - 1, radius: 60 };
    session(gaze(0, nearStop));
    expect(session(gaze(2000, nearStop))).toMatchObject({ dwell: null });
  });

  it('uses the configured key dwell', () => {
    const { session } = typing({ keyDwellMs: 400 });
    session(gaze(0, onKey('a')));
    expect(typedText(session(gaze(400, onKey('a'))))).toBe('a');
  });
});

describe('Gaze Keyboard layout', () => {
  const area = (r: Rect) => r.width * r.height;
  const intersect = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it.each([[{ width: 1512, height: 982 }], [{ width: 1440, height: 900 }], [{ width: 1920, height: 1080 }]])(
    'fills most of a %j screen and leaves both corners free',
    (size) => {
      const { keys, text } = layoutKeyboard(size);
      const { wake, stop } = cornerTargets(size);
      expect(keys.reduce((sum, key) => sum + area(key.rect), 0) / area({ x: 0, y: 0, ...size })).toBeGreaterThan(0.55);
      for (const { rect } of [...keys, { rect: text }]) {
        expect(intersect(rect, wake) || intersect(rect, stop)).toBe(false);
        expect(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= size.width && rect.y + rect.height <= size.height).toBe(true);
        for (const other of keys) if (other.rect !== rect) expect(intersect(rect, other.rect)).toBe(false);
      }
      expect(keys.map((key) => key.id)).toEqual([...'abcdefghijklmnopqrstuvwxyz', 'space', 'done', 'delete']);
    },
  );
});
