import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import type { Rect } from './geometry';
import { GROUPS, layoutIntents, layoutKeyboard } from './keyboard';
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
    expect(session(gaze(20000, outsideBox)).phase).not.toBe('idle');
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
  const { text } = layoutKeyboard(screen, null);
  const onTypedText = { x: text.x + text.width / 2, y: text.y + text.height / 2, radius: 120 };
  const onKey = (id: string, group: string | null = null) => {
    const { x, y, width, height } = layoutKeyboard(screen, group).keys.find((key) => key.id === id)!.rect;
    return { x: x + width / 2, y: y + height / 2, radius: 120 };
  };
  const groupOf = (letter: string) => GROUPS.find((group) => group.includes(letter))!;

  const typing = (timings?: unknown) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, timings, act: (action) => actions.push(action) });
    session({ type: 'open-keyboard', t: 0 });
    let t = 0;
    let group: string | null = null;
    // Holds on a key for a full dwell, then Moves Off to the typed text.
    const hold = (id: string) => {
      session(gaze((t += 100), onKey(id, group)));
      const state = session(gaze((t += 1000), onKey(id, group)));
      session(gaze((t += 100), onTypedText));
      if (state.phase === 'typing') group = state.group;
      return state;
    };
    // Letters go through their group first. Other keys are on the group screen.
    const type = (...ids: string[]) => {
      let state = session(gaze((t += 100), onTypedText));
      for (const id of ids) {
        if (id.length === 1) hold(groupOf(id));
        state = hold(id);
      }
      return state;
    };
    return { session, actions, hold, type, at: () => t };
  };

  it('opens on the group screen with no text', () => {
    const session = createSession({ screen });
    expect(session({ type: 'open-keyboard', t: 0 })).toEqual({ phase: 'typing', wakeProgress: 0, text: '', group: null, dwell: null });
  });

  it('opens a group after a 1 second dwell, then types a letter from it', () => {
    const { session } = typing();
    session(gaze(0, onKey('fghij')));
    expect(session(gaze(999, onKey('fghij')))).toMatchObject({ group: null });
    expect(session(gaze(1000, onKey('fghij')))).toMatchObject({ group: 'fghij', text: '' });
    session(gaze(1100, onKey('h', 'fghij')));
    session(gaze(2100, onKey('h', 'fghij')));
    expect(session(gaze(3100, onKey('h', 'fghij')))).toMatchObject({ text: 'h', group: null });
  });

  it('needs a Move Off before the key that appears under the gaze can press', () => {
    const { session } = typing();
    // 'abcde' and then 'a' share the first cell.
    session(gaze(0, onKey('abcde')));
    session(gaze(1000, onKey('abcde')));
    expect(session(gaze(1001, onKey('a', 'abcde')))).toMatchObject({ dwell: null });
    expect(session(gaze(5000, onKey('a', 'abcde')))).toMatchObject({ group: 'abcde', text: '', dwell: null });
  });

  it('shows dwell progress on the key being looked at', () => {
    const { session } = typing();
    session(gaze(0, onKey('abcde')));
    expect(session(gaze(250, onKey('abcde')))).toMatchObject({ dwell: { key: 'abcde', progress: 0.25 } });
    expect(session(gaze(300, onKey('fghij')))).toMatchObject({ dwell: { key: 'fghij', progress: 0 } });
    expect(session(gaze(400, onTypedText))).toMatchObject({ dwell: null });
  });

  it('restarts the dwell when tracking is lost', () => {
    const { session } = typing();
    session(gaze(0, onKey('abcde')));
    session(gaze(500, null));
    expect(session(gaze(1000, onKey('abcde')))).toMatchObject({ group: null });
  });

  it('types a double letter with a Move Off between', () => {
    expect(typedText(typing().type('h', 'e', 'l', 'l', 'o'))).toBe('hello');
  });

  it('types words with Space', () => {
    expect(typedText(typing().type('h', 'i', 'space', 'y', 'o', 'u'))).toBe('hi you');
  });

  it('returns to the groups with Back, without typing', () => {
    const { hold } = typing();
    hold('klmno');
    expect(hold('back')).toMatchObject({ group: null, text: '' });
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

  it('uses the configured key dwell', () => {
    const { session } = typing({ keyDwellMs: 400 });
    session(gaze(0, onKey('abcde')));
    expect(session(gaze(400, onKey('abcde')))).toMatchObject({ group: 'abcde' });
  });
});

describe('Suggested Intents', () => {
  const target = { x: 300, y: 300, radius: 120 };
  const awake = (timings?: unknown) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, timings, act: (action) => actions.push(action) });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    return { session, actions };
  };

  it('asks the model about a target held for 1 second, then shows it is thinking', () => {
    const { session, actions } = awake();
    session(gaze(3100, target));
    expect(session(gaze(4099, target)).phase).toBe('waiting-for-target');
    expect(actions).toEqual([]);
    expect(session(gaze(4100, target)).phase).toBe('thinking');
    expect(actions).toEqual([{ type: 'suggest-intents', region: target }]);
  });

  it('restarts the hold when the gaze moves to somewhere else, but not on jitter inside the Gaze Region', () => {
    const { session } = awake();
    session(gaze(3100, target));
    session(gaze(3600, { ...target, x: target.x + 100 }));
    expect(session(gaze(4100, target)).phase).toBe('thinking');

    const moved = awake();
    moved.session(gaze(3100, target));
    moved.session(gaze(3600, { ...target, x: target.x + 400 }));
    expect(moved.session(gaze(4100, { ...target, x: target.x + 400 })).phase).toBe('waiting-for-target');
    expect(moved.session(gaze(4600, { ...target, x: target.x + 400 })).phase).toBe('thinking');
  });

  it('needs a full new hold after waking again, even if the last hold was cut short by the Gaze Keyboard', () => {
    const { session, actions } = awake();
    session(gaze(3100, inBox));
    session({ type: 'open-keyboard', t: 3500 });
    session(gaze(3600, offScreen));
    session(gaze(8600, offScreen));
    session(gaze(9000, inBox));
    expect(session(gaze(12_000, inBox)).phase).toBe('waiting-for-target');
    expect(session(gaze(12_100, inBox)).phase).toBe('waiting-for-target');
    expect(actions).toEqual([]);
    expect(session(gaze(13_099, inBox)).phase).toBe('waiting-for-target');
    expect(session(gaze(13_100, inBox)).phase).toBe('thinking');
  });

  const thinking = () => {
    const woken = awake();
    woken.session(gaze(3100, target));
    woken.session(gaze(4100, target));
    return woken;
  };

  it('shows up to 3 Suggested Intents from the model, plus Something else', () => {
    const { session } = thinking();
    const intents = ['Skip the ad', 'Open a related video', 'Pause', 'Like the video'];
    expect(session({ type: 'intents', t: 5000, intents })).toMatchObject({
      phase: 'choosing',
      intents: ['Skip the ad', 'Open a related video', 'Pause'],
      dwell: null,
    });
    expect(layoutIntents(screen, ['Skip the ad', 'Open a related video', 'Pause']).map((key) => key.label)).toEqual([
      'Skip the ad',
      'Open a related video',
      'Pause',
      'Something else',
    ]);
  });

  const choosing = (intents = ['Skip the ad', 'Open a related video', 'Pause']) => {
    const woken = thinking();
    woken.session({ type: 'intents', t: 5000, intents });
    const onChoice = (label: string) => {
      const { x, y, width, height } = layoutIntents(screen, intents).find((key) => key.label === label)!.rect;
      return { x: x + width / 2, y: y + height / 2, radius: 120 };
    };
    return { ...woken, onChoice };
  };

  it('runs a Suggested Intent chosen by a 1 second dwell, which is the confirmation', () => {
    const { session, actions, onChoice } = choosing();
    session(gaze(5100, onChoice('Pause')));
    expect(session(gaze(5600, onChoice('Pause')))).toMatchObject({ dwell: { key: 'intent-2', progress: 0.5 } });
    expect(actions).toEqual([{ type: 'suggest-intents', region: target }]);
    expect(session(gaze(6100, onChoice('Pause')))).toEqual({ phase: 'running', wakeProgress: 0, intent: 'Pause' });
    expect(actions.at(-1)).toEqual({ type: 'run-intent', intent: 'Pause' });
  });

  it('fetches fresh suggestions for the same target on Something else', () => {
    const { session, actions, onChoice } = choosing();
    session(gaze(5100, onChoice('Something else')));
    expect(session(gaze(6100, onChoice('Something else'))).phase).toBe('thinking');
    expect(actions).toEqual([
      { type: 'suggest-intents', region: target },
      { type: 'suggest-intents', region: target },
    ]);
  });

  it('needs a Move Off before Something else can press again on the fresh suggestions', () => {
    const { session, actions, onChoice } = choosing();
    session(gaze(5100, onChoice('Something else')));
    session(gaze(6100, onChoice('Something else')));
    expect(session({ type: 'intents', t: 7000, intents: ['Mute'] })).toMatchObject({ phase: 'choosing', dwell: null });
    expect(session(gaze(9000, onChoice('Something else'))).phase).toBe('choosing');
    expect(actions).toHaveLength(2);
  });

  it.each([
    ['thinking', () => thinking().session],
    ['choosing', () => choosing().session],
    [
      'running',
      () => {
        const { session, onChoice } = choosing();
        session(gaze(5100, onChoice('Pause')));
        session(gaze(6100, onChoice('Pause')));
        return session;
      },
    ],
  ])('stops on the Stop Gesture while %s', (phase, reach) => {
    const session = reach();
    expect(session(tick(6200)).phase).toBe(phase);
    session(gaze(6200, offScreen));
    expect(session(tick(11_200))).toEqual({ phase: 'idle', wakeProgress: 0 });
  });

  it('ignores suggestions that arrive when it is not thinking', () => {
    const { session } = awake();
    expect(session({ type: 'intents', t: 3100, intents: ['Pause'] }).phase).toBe('waiting-for-target');
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
      const groupScreen = layoutKeyboard(size, null).keys;
      expect(groupScreen.reduce((sum, key) => sum + area(key.rect), 0) / area({ x: 0, y: 0, ...size })).toBeGreaterThan(0.6);
    },
  );

  it('puts every letter in exactly one group', () => {
    expect(GROUPS.join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  });
});
