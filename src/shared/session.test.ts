import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import type { Rect } from './geometry';
import { GROUPS, layoutKeyboard } from './keyboard';
import { createSession, type AgentAction, type OverlayState } from './session';

const screen = { width: 1600, height: 1000 };
const inBox = { x: 800, y: 500, radius: 120 };
const outsideBox = { x: 200, y: 500, radius: 120 };
const offScreen = { x: 800, y: -400, radius: 120 };

const typedText = (state: OverlayState) => (state.phase === 'typing' ? state.text : null);
const tick = (t: number) => ({ type: 'tick', t }) as const;
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });

describe('Start Gesture', () => {
  it('wakes the agent after 3 seconds on the centre box', () => {
    const session = createSession({ screen });
    session(gaze(0, inBox));
    expect(session(gaze(2999, inBox)).phase).toBe('idle');
    expect(session(gaze(3000, inBox)).phase).toBe('waiting-for-target');
  });

  it('counts only a Gaze Region centred inside the box', () => {
    const session = createSession({ screen });
    const nearEdge = { x: 540, y: 500, radius: 120 };
    session(gaze(0, nearEdge));
    expect(session(gaze(3000, nearEdge)).phase).toBe('idle');
  });

  it('restarts the hold when the user looks away from the box', () => {
    const session = createSession({ screen });
    session(gaze(0, inBox));
    session(gaze(1000, outsideBox));
    session(gaze(1100, inBox));
    expect(session(gaze(3100, inBox)).phase).toBe('idle');
    expect(session(gaze(4100, inBox)).phase).toBe('waiting-for-target');
  });

  it('restarts the hold when tracking is lost', () => {
    const session = createSession({ screen });
    session(gaze(0, inBox));
    session(gaze(1000, null));
    expect(session(gaze(3000, inBox)).phase).toBe('idle');
  });

  it('fills the ring during the hold and empties it on looking away', () => {
    const session = createSession({ screen });
    expect(session(gaze(0, inBox)).wakeProgress).toBe(0);
    expect(session(gaze(750, inBox)).wakeProgress).toBe(0.25);
    expect(session(gaze(2250, inBox)).wakeProgress).toBe(0.75);
    expect(session(gaze(2300, outsideBox)).wakeProgress).toBe(0);
  });

  it('does not count the old corners', () => {
    const session = createSession({ screen });
    const corner = { x: 1500, y: 100, radius: 120 };
    session(gaze(0, corner));
    expect(session(gaze(3000, corner))).toEqual({ phase: 'idle', wakeProgress: 0 });
  });
});

describe('Look Away', () => {
  const wokenAt3s = () => {
    const session = createSession({ screen });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    return session;
  };

  it('empties the ring once awake', () => {
    expect(wokenAt3s()(gaze(3100, outsideBox))).toEqual({ phase: 'waiting-for-target', wakeProgress: 0 });
  });

  it('stays awake while the user looks around the screen', () => {
    const session = wokenAt3s();
    session(gaze(4000, outsideBox));
    expect(session(gaze(20000, outsideBox)).phase).toBe('waiting-for-target');
  });

  it('stops the agent after 5 seconds off screen', () => {
    const session = wokenAt3s();
    session(gaze(4000, offScreen));
    expect(session(gaze(8999, offScreen)).phase).toBe('waiting-for-target');
    expect(session(gaze(9000, offScreen)).phase).toBe('idle');
  });

  it('counts tracking loss as looking away', () => {
    const session = wokenAt3s();
    session(gaze(4000, null));
    expect(session(gaze(9000, null)).phase).toBe('idle');
  });

  it('still stops on timer ticks if gaze events stop arriving', () => {
    const session = wokenAt3s();
    session(gaze(4000, null));
    expect(session(tick(8999)).phase).toBe('waiting-for-target');
    expect(session(tick(9000)).phase).toBe('idle');
  });

  it('starts counting again when the user looks back', () => {
    const session = wokenAt3s();
    session(gaze(4000, offScreen));
    session(gaze(8000, outsideBox));
    session(gaze(8100, offScreen));
    expect(session(gaze(13099, offScreen)).phase).toBe('waiting-for-target');
    expect(session(gaze(13100, offScreen)).phase).toBe('idle');
  });

  it('needs a full new hold to wake again', () => {
    const session = wokenAt3s();
    session(gaze(4000, null));
    session(gaze(9000, null));
    expect(session(gaze(9100, inBox))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(session(gaze(12099, inBox)).phase).toBe('idle');
    expect(session(gaze(12100, inBox)).phase).toBe('waiting-for-target');
  });
});

describe('timings', () => {
  it('uses configured timings', () => {
    const session = createSession({ screen, timings: { wakeHoldMs: 1000, lookAwayMs: 300 } });
    session(gaze(0, inBox));
    expect(session(gaze(500, inBox)).wakeProgress).toBe(0.5);
    expect(session(gaze(1000, inBox)).phase).toBe('waiting-for-target');
    session(gaze(1100, null));
    expect(session(gaze(1400, null)).phase).toBe('idle');
  });

  it('keeps the default for a timing left out', () => {
    const session = createSession({ screen, timings: { lookAwayMs: 300 } });
    session(gaze(0, inBox));
    expect(session(gaze(1500, inBox)).wakeProgress).toBe(0.5);
  });

  it.each([[null], ['fast'], [{ wakeHoldMs: 'slow' }], [{ wakeHoldMs: -1 }], [{ wakeHoldMs: 0 }], [{ wakeHoldMs: null }]])(
    'falls back to the defaults for invalid timings %j',
    (timings) => {
      const session = createSession({ screen, timings });
      session(gaze(0, inBox));
      expect(session(gaze(1500, inBox))).toEqual({ phase: 'idle', wakeProgress: 0.5 });
    },
  );
});

describe('Gaze Keyboard', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  const onKey = (id: string, group: string | null = null) => {
    const { x, y, width, height } = layoutKeyboard(screen, group).keys.find((key) => key.id === id)!.rect;
    return { x: x + width / 2, y: y + height / 2, radius: 120 };
  };
  const groupOf = (letter: string) => GROUPS.find((group) => group.includes(letter))!;

  const typing = (timings?: unknown) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, timings, act: (action) => actions.push(action) });
    let state = session({ type: 'open-keyboard', t: 0 });
    let t = 0;
    // Waits for the scan to reach a key, then presses it with a Select Blink.
    const press = (id: string) => {
      const start = t;
      while (state.phase === 'typing' && state.highlight !== id) {
        if (t - start > 60_000) throw new Error(`the scan never reached ${id}`);
        state = session(tick((t += 100)));
      }
      return (state = session(select(t)));
    };
    // Letters go through their group first. Other keys are on the group screen.
    const type = (...ids: string[]) => {
      for (const id of ids) {
        if (id.length === 1) press(groupOf(id));
        press(id);
      }
      return state;
    };
    return { session, actions, press, type, at: () => t };
  };

  it('opens on the group screen with no text, highlighting the first key', () => {
    const session = createSession({ screen });
    expect(session({ type: 'open-keyboard', t: 0 })).toEqual({ phase: 'typing', wakeProgress: 0, text: '', group: null, highlight: 'abcde', suggestions: [] });
  });

  it('moves the highlight to the next key every 2 seconds, and wraps round', () => {
    const { session } = typing();
    expect(session(tick(1999))).toMatchObject({ highlight: 'abcde' });
    expect(session(tick(2000))).toMatchObject({ highlight: 'fghij' });
    expect(session(tick(15000))).toMatchObject({ highlight: 'done' });
    expect(session(tick(16000))).toMatchObject({ highlight: 'abcde' });
  });

  it('presses the highlighted key on a Select Blink, then scans again from the first key', () => {
    const { session } = typing();
    expect(session(select(3000))).toMatchObject({ group: 'fghij', highlight: 'f' });
    expect(session(tick(4999))).toMatchObject({ highlight: 'f' });
    expect(session(tick(5000))).toMatchObject({ highlight: 'g' });
    expect(session(select(7200))).toMatchObject({ text: 'h', group: null, highlight: 'abcde' });
  });

  it('presses nothing by looking at a key', () => {
    const { session } = typing();
    session(gaze(0, onKey('klmno')));
    expect(session(gaze(5000, onKey('klmno')))).toMatchObject({ group: null, text: '' });
  });

  it('ignores a Select Blink while not typing', () => {
    const session = createSession({ screen });
    expect(session(select(0))).toEqual({ phase: 'idle', wakeProgress: 0 });
  });

  it('types a double letter', () => {
    expect(typedText(typing().type('h', 'e', 'l', 'l', 'o'))).toBe('hello');
  });

  it('types words with Space', () => {
    expect(typedText(typing().type('h', 'i', 'space', 'y', 'o', 'u'))).toBe('hi you');
  });

  it('returns to the groups with Back, without typing', () => {
    const { press } = typing();
    press('klmno');
    expect(press('back')).toMatchObject({ group: null, text: '' });
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
    expect(session({ type: 'open-keyboard', t: 99_000 })).toMatchObject({ text: '', group: null });
  });

  it('keeps the text when asked to open while already typing', () => {
    const { session, type, at } = typing();
    type('a');
    expect(typedText(session({ type: 'open-keyboard', t: at() + 1 }))).toBe('a');
  });

  it('stays open while the user looks around the screen', () => {
    const { session } = typing();
    expect(session(tick(60_000)).phase).toBe('typing');
  });

  it('closes without typing on the Stop Gesture', () => {
    const { session, type, actions, at } = typing();
    type('h', 'i');
    session(gaze(at() + 100, offScreen));
    expect(session(gaze(at() + 5100, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(actions).toEqual([]);
  });

  it('ignores the Start Gesture while typing', () => {
    const { session } = typing();
    session(gaze(0, inBox));
    expect(session(gaze(5000, inBox))).toMatchObject({ phase: 'typing', wakeProgress: 0 });
  });

  it('uses the configured scan step', () => {
    const { session } = typing({ scanStepMs: 400 });
    expect(session(tick(400))).toMatchObject({ highlight: 'fghij' });
  });
});

describe('Gaze Keyboard word suggestions', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  // A fake predictor: finishes 'wa' as water, and suggests 'please' after 'water '.
  const suggest = (text: string) => (text.endsWith('wa') ? ['water', 'want', 'was'] : text.endsWith('water ') ? ['please', 'now'] : ['i', 'you', 'the']);

  const typing = () => {
    const actions: AgentAction[] = [];
    const asked: string[] = [];
    const session = createSession({ screen, act: (action) => actions.push(action), suggest: (text) => (asked.push(text), suggest(text)) });
    let state = session({ type: 'open-keyboard', t: 0 });
    let t = 0;
    const press = (id: string) => {
      const start = t;
      while (state.phase === 'typing' && state.highlight !== id) {
        if (t - start > 60_000) throw new Error(`the scan never reached ${id}`);
        state = session(tick((t += 100)));
      }
      return (state = session(select(t)));
    };
    const type = (...ids: string[]) => {
      for (const id of ids) {
        if (id.length === 1) press(GROUPS.find((group) => group.includes(id))!);
        press(id);
      }
      return state;
    };
    return { session, actions, asked, press, type, state: () => state };
  };

  it('shows suggestions for the text so far, and scans them first', () => {
    const { state } = typing();
    expect(state()).toMatchObject({ suggestions: ['i', 'you', 'the'], highlight: 'word:i' });
  });

  it('finishes the word being typed with a suggestion, adding the space', () => {
    const { type, press } = typing();
    type('w', 'a');
    expect(press('word:water')).toMatchObject({ text: 'water ', suggestions: ['please', 'now'], group: null });
  });

  it('predicts the next word after a suggestion', () => {
    const { type, press } = typing();
    type('w', 'a');
    press('word:water');
    expect(press('word:please')).toMatchObject({ text: 'water please ' });
  });

  it('asks on opening and after each press, never on a tick', () => {
    const { type, asked } = typing();
    type('w', 'a');
    expect(asked).toEqual(['', '', 'w', 'w', 'wa']);
  });

  it('types the finished text on Done, which is what teaches the predictor', () => {
    const { type, press, actions } = typing();
    type('w', 'a');
    press('word:water');
    press('done');
    expect(actions).toEqual([{ type: 'type-text', text: 'water ' }]);
  });

  it('keeps suggestions off the letter screens, so letters scan as before', () => {
    const { press } = typing();
    expect(press('fghij')).toMatchObject({ group: 'fghij', highlight: 'f' });
  });
});

describe('Gaze Keyboard layout', () => {
  const area = (r: Rect) => r.width * r.height;
  const intersect = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it.each([[{ width: 1512, height: 982 }], [{ width: 1440, height: 900 }], [{ width: 1920, height: 1080 }]])(
    'fits every screen of keys on a %j display, with no more than 10 keys',
    (size) => {
      for (const group of [null, ...GROUPS]) {
        const { keys, text } = layoutKeyboard(size, group);
        expect(keys.length).toBeLessThanOrEqual(10);
        for (const { rect } of [...keys, { rect: text }]) {
          expect(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= size.width && rect.y + rect.height <= size.height).toBe(true);
          for (const other of keys) if (other.rect !== rect) expect(intersect(rect, other.rect)).toBe(false);
        }
        // 240 px is near the low end of #5's usable key size, 263 to 703 px.
        for (const { rect } of keys) expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(240);
      }
      // Suggestions add a row, so the keys get shorter. Keys are chosen by the scan since #26, not by gaze, so they only need to stay readable.
      const suggested = layoutKeyboard(size, null, ['water', 'want', 'was']).keys;
      expect(suggested.slice(0, 3).map(({ id }) => id)).toEqual(['word:water', 'word:want', 'word:was']);
      for (const { rect } of suggested) {
        expect(rect.x >= 0 && rect.y >= 120 && rect.x + rect.width <= size.width && rect.y + rect.height <= size.height).toBe(true);
        expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(170);
        for (const other of suggested) if (other.rect !== rect) expect(intersect(rect, other.rect)).toBe(false);
      }
      const groupScreen = layoutKeyboard(size, null).keys;
      expect(groupScreen.reduce((sum, key) => sum + area(key.rect), 0) / area({ x: 0, y: 0, ...size })).toBeGreaterThan(0.6);
    },
  );

  it('puts every letter in exactly one group', () => {
    expect(GROUPS.join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  });
});
