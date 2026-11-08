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
    expect(session({ type: 'open-keyboard', t: 0 })).toEqual({ phase: 'typing', wakeProgress: 0, text: '', group: null, highlight: 'abcde' });
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

describe('Dock', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  const items = ['Finder', 'Safari', 'Notes'].map((name, i) => ({ name, rect: { x: 600 + i * 70, y: 910, width: 66, height: 82 } }));
  const nearDock = { x: 700, y: 820, radius: 120 };
  const belowDock = { x: 700, y: 1300, radius: 120 };

  const awake = (timings?: unknown) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, timings, act: (action) => actions.push(action), dock: () => items });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    return { session, actions };
  };
  // Sticks to the Dock at 6100.
  const onDock = () => {
    const awoken = awake();
    awoken.session(gaze(3100, nearDock));
    awoken.session(gaze(6100, nearDock));
    return awoken;
  };

  it('sticks to the Dock after 3 seconds near it, highlighting the first icon', () => {
    const { session } = awake();
    session(gaze(3100, nearDock));
    expect(session(gaze(6099, nearDock)).phase).toBe('waiting-for-target');
    expect(session(gaze(6100, nearDock))).toEqual({ phase: 'icons', wakeProgress: 0, source: 'dock', highlight: items[0] });
  });

  describe('showing the Dock', () => {
    const hidden = items.map(({ name, rect }) => ({ name, rect: { ...rect, y: screen.height } }));
    const awakeWithHiddenDock = () => {
      const actions: AgentAction[] = [];
      const session = createSession({ screen, act: (action) => actions.push(action), dock: () => hidden });
      session(gaze(0, inBox));
      session(gaze(3000, inBox));
      return { session, actions };
    };

    it('shows the Dock when the user starts looking at it, and gives it back when they move off', () => {
      const { session, actions } = awakeWithHiddenDock();
      session(gaze(3100, belowDock));
      session(gaze(3200, belowDock));
      session(gaze(3300, outsideBox));
      session(gaze(3800, outsideBox));
      session(gaze(3900, belowDock));
      expect(actions).toEqual([{ type: 'show-dock' }, { type: 'release-dock' }, { type: 'show-dock' }]);
    });

    it('keeps the Dock up through a shaky moment during the hold', () => {
      const { session, actions } = awakeWithHiddenDock();
      session(gaze(3100, belowDock));
      session(gaze(4000, belowDock));
      session(gaze(4300, outsideBox));
      session(gaze(4400, belowDock));
      expect(session(gaze(6100, belowDock)).phase).toBe('icons');
      expect(actions).toEqual([{ type: 'show-dock' }]);
    });

    it('keeps the Dock up for the whole scan, even when the gaze leaves it', () => {
      const { session, actions } = awakeWithHiddenDock();
      session(gaze(3100, belowDock));
      session(gaze(6100, belowDock));
      session(gaze(6200, outsideBox));
      session(tick(9000));
      expect(actions).toEqual([{ type: 'show-dock' }]);
    });

    it('lets the opened app take the Dock away', () => {
      const { session, actions } = awakeWithHiddenDock();
      session(gaze(3100, belowDock));
      session(gaze(6100, belowDock));
      session(select(6200));
      session(gaze(6300, outsideBox));
      expect(actions.map(({ type }) => type)).toEqual(['show-dock', 'open-icon']);
    });

    it('gives the Dock back when the Stop Gesture ends the scan', () => {
      const { session, actions } = awakeWithHiddenDock();
      session(gaze(3100, belowDock));
      session(gaze(6100, belowDock));
      session(gaze(6200, offScreen));
      session(gaze(11_200, offScreen));
      expect(actions).toEqual([{ type: 'show-dock' }, { type: 'release-dock' }]);
    });

    it('does not ask for the Dock while asleep', () => {
      const actions: AgentAction[] = [];
      const session = createSession({ screen, act: (action) => actions.push(action), dock: () => hidden });
      session(gaze(0, belowDock));
      expect(actions).toEqual([]);
    });
  });

  it('restarts the hold when the user moves off the Dock', () => {
    const { session } = awake();
    session(gaze(3100, nearDock));
    session(gaze(5000, outsideBox));
    session(gaze(5100, nearDock));
    expect(session(gaze(8099, nearDock)).phase).toBe('waiting-for-target');
    expect(session(gaze(8100, nearDock)).phase).toBe('icons');
  });

  it('does not stick to the Dock on a Select Blink', () => {
    const { session } = awake();
    session(gaze(3100, nearDock));
    expect(session(select(3200)).phase).toBe('waiting-for-target');
  });

  it('ignores the Dock while asleep', () => {
    const session = createSession({ screen, dock: () => items });
    session(gaze(0, nearDock));
    expect(session(gaze(5000, nearDock)).phase).toBe('idle');
  });

  it('ignores the Dock when it could not be read', () => {
    const session = createSession({ screen });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    session(gaze(3100, nearDock));
    expect(session(gaze(6100, nearDock)).phase).toBe('waiting-for-target');
  });

  it('uses the configured Dock hold', () => {
    const { session } = awake({ iconHoldMs: 1000 });
    session(gaze(3100, nearDock));
    expect(session(gaze(4100, nearDock)).phase).toBe('icons');
  });

  it('steps through the icons every 2 seconds and opens the highlighted one on a Select Blink', () => {
    const { session, actions } = onDock();
    expect(session(tick(8100))).toMatchObject({ highlight: items[1] });
    expect(session(tick(10100))).toMatchObject({ highlight: items[2] });
    expect(session(tick(12100))).toMatchObject({ highlight: items[0] });
    session(tick(14100));
    expect(session(select(14200))).toEqual({ phase: 'waiting-for-target', wakeProgress: 0 });
    expect(actions).toEqual([{ type: 'show-dock' }, { type: 'open-icon', source: 'dock', name: 'Safari' }]);
  });

  it('counts gaze far past the screen edge under the Dock as near it', () => {
    const { session } = awake();
    session(gaze(3100, belowDock));
    expect(session(gaze(6100, belowDock)).phase).toBe('icons');
  });

  it('does not count gaze past the edge under the Dock as Look Away', () => {
    const { session } = onDock();
    expect(session(gaze(30_000, belowDock)).phase).toBe('icons');
  });

  it('still counts gaze past the edge away from the Dock as Look Away', () => {
    const { session } = awake();
    const belowCorner = { x: 100, y: 1300, radius: 120 };
    session(gaze(3100, belowCorner));
    expect(session(gaze(8100, belowCorner)).phase).toBe('idle');
  });

  it('leaves without opening anything on the Stop Gesture', () => {
    const { session, actions } = onDock();
    session(gaze(7000, offScreen));
    expect(session(gaze(12_000, offScreen)).phase).toBe('idle');
    expect(actions).toEqual([{ type: 'show-dock' }, { type: 'release-dock' }]);
  });

  it('still stops the Gaze Keyboard when the user looks down past the Dock', () => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, act: (action) => actions.push(action), dock: () => items });
    session({ type: 'open-keyboard', t: 0 });
    session(gaze(100, belowDock));
    expect(session(gaze(5100, belowDock)).phase).toBe('idle');
  });

  it('needs a full new hold after waking again', () => {
    const { session } = awake();
    session(gaze(3100, nearDock));
    session(gaze(4000, null));
    session(gaze(9000, null));
    session(gaze(9100, inBox));
    session(gaze(12_100, inBox));
    expect(session(gaze(12_200, nearDock)).phase).toBe('waiting-for-target');
  });
});

describe('Desktop', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  // Out of order, as Accessibility lists them: a column on the right edge and one icon on its own.
  const at = (name: string, x: number, y: number) => ({ name, rect: { x, y, width: 64, height: 64 } });
  const desktop = [at('Projects', 650, 230), at('Screenshot 2', 1500, 490), at('school', 1500, 40), at('Screenshot 1', 1500, 150)];
  const dock = [at('Finder', 600, 920)];
  const awake = () => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, act: (action) => actions.push(action), dock: () => dock, desktop: () => desktop });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    return { session, actions };
  };

  it('sticks to the Desktop after 3 seconds near any of its icons', () => {
    const { session } = awake();
    session(gaze(3100, { x: 660, y: 260, radius: 120 }));
    expect(session(gaze(6100, { x: 660, y: 260, radius: 120 }))).toMatchObject({ phase: 'icons', source: 'desktop' });
  });

  it('counts gaze past the right edge beside a Desktop icon', () => {
    const { session } = awake();
    const pastEdge = { x: 1900, y: 500, radius: 120 };
    session(gaze(3100, pastEdge));
    expect(session(gaze(6100, pastEdge))).toMatchObject({ phase: 'icons', source: 'desktop' });
    expect(session(gaze(30_000, pastEdge)).phase).toBe('icons');
  });

  it('scans column by column from the left, top to bottom, and opens the highlighted file', () => {
    const { session, actions } = awake();
    session(gaze(3100, { x: 660, y: 260, radius: 120 }));
    session(gaze(6100, { x: 660, y: 260, radius: 120 }));
    const order = [6100, 8100, 10_100, 12_100].map((t) => {
      const state = session(tick(t));
      return state.phase === 'icons' ? state.highlight.name : null;
    });
    expect(order).toEqual(['Projects', 'school', 'Screenshot 1', 'Screenshot 2']);
    session(select(12_200));
    expect(actions).toEqual([{ type: 'open-icon', source: 'desktop', name: 'Screenshot 2' }]);
  });

  it('stays awake after opening, so the next icon needs only another 3 second look', () => {
    const { session, actions } = awake();
    const onProjects = { x: 660, y: 260, radius: 120 };
    session(gaze(3100, onProjects));
    session(gaze(6100, onProjects));
    session(select(6200));
    session(gaze(6300, onProjects));
    expect(session(gaze(9300, onProjects))).toMatchObject({ phase: 'icons', source: 'desktop' });
    session(select(9400));
    expect(actions).toEqual([
      { type: 'open-icon', source: 'desktop', name: 'Projects' },
      { type: 'open-icon', source: 'desktop', name: 'Projects' },
    ]);
  });

  it('restarts the hold when the gaze moves from the Desktop to the Dock', () => {
    const { session } = awake();
    session(gaze(3100, { x: 660, y: 260, radius: 120 }));
    session(gaze(5000, { x: 630, y: 950, radius: 120 }));
    expect(session(gaze(6100, { x: 630, y: 950, radius: 120 })).phase).toBe('waiting-for-target');
    expect(session(gaze(8000, { x: 630, y: 950, radius: 120 }))).toMatchObject({ phase: 'icons', source: 'dock' });
  });

  it('ignores a spot with no visible Desktop icon', () => {
    const { session } = awake();
    session(gaze(3100, outsideBox));
    expect(session(gaze(6100, outsideBox)).phase).toBe('waiting-for-target');
  });
});

describe('Menu bar', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  const at = (name: string, x: number, width: number) => ({ name, rect: { x, y: 0, width, height: 33 } });
  // App menus on the left, status items on the right, out of order as they're read.
  const menubar = [at('wifi', 1300, 22), at('apple', 10, 34), at('file', 44, 50), at('clock', 1450, 120)];
  const commands = ['new', 'open', 'close'].map((name, i) => ({ name, rect: { x: 44, y: 34 + i * 24, width: 300, height: 24 } }));
  const atTop = { x: 800, y: 10, radius: 120 };

  const onMenuBar = () => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, act: (action) => actions.push(action), menubar: () => menubar });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    session(gaze(3100, atTop));
    session(gaze(6100, atTop));
    return { session, actions };
  };
  const highlighted = (state: OverlayState) => (state.phase === 'icons' ? state.highlight.name : null);

  it('sticks to the menu bar after 3 seconds anywhere along it, even past the top edge', () => {
    const { session } = onMenuBar();
    expect(session(tick(6200))).toMatchObject({ phase: 'icons', source: 'menubar' });
    const above = createSession({ screen, menubar: () => menubar });
    above(gaze(0, inBox));
    above(gaze(3000, inBox));
    above(gaze(3100, { x: 800, y: -400, radius: 120 }));
    expect(above(gaze(6100, { x: 800, y: -400, radius: 120 }))).toMatchObject({ phase: 'icons', source: 'menubar' });
  });

  it('scans the app menus from the left, then the status items', () => {
    const { session } = onMenuBar();
    expect([6100, 8100, 10_100, 12_100].map((t) => highlighted(session(tick(t))))).toEqual(['apple', 'file', 'wifi', 'clock']);
  });

  it('opens the highlighted item, then scans the commands of the menu it opened from the top', () => {
    const { session, actions } = onMenuBar();
    session(tick(8100));
    expect(session(select(8200)).phase).toBe('waiting-for-target');
    expect(actions).toEqual([{ type: 'open-icon', source: 'menubar', name: 'file' }]);
    expect(session({ type: 'menu-opened', t: 8800, icons: commands })).toMatchObject({ phase: 'icons', source: 'menu', highlight: commands[0] });
    session(tick(10_800));
    session(select(10_900));
    expect(actions.at(-1)).toEqual({ type: 'open-icon', source: 'menu', name: 'open' });
  });

  it('stays waiting when the item opened no menu, such as a status item panel', () => {
    const { session } = onMenuBar();
    session(select(6200));
    expect(session({ type: 'menu-opened', t: 6800, icons: [] }).phase).toBe('waiting-for-target');
  });

  it('closes the open menu without running anything on the Stop Gesture', () => {
    const { session, actions } = onMenuBar();
    session(select(6200));
    session({ type: 'menu-opened', t: 6800, icons: commands });
    session(gaze(7000, offScreen));
    expect(session(gaze(12_000, offScreen)).phase).toBe('idle');
    expect(actions.map(({ type }) => type)).toEqual(['open-icon', 'close-menu']);
  });

  it('picks a Desktop icon just under the menu bar when the gaze is on the icon', () => {
    const school = { name: 'school', rect: { x: 1414, y: 41, width: 64, height: 64 } };
    const session = createSession({ screen, menubar: () => menubar, desktop: () => [school] });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    const onSchool = { x: 1440, y: 60, radius: 60 };
    session(gaze(3100, onSchool));
    expect(session(gaze(6100, onSchool))).toMatchObject({ phase: 'icons', source: 'desktop' });
  });

  it('picks the menu bar over a Desktop icon just under it when the gaze is on the bar', () => {
    const school = { name: 'school', rect: { x: 1414, y: 41, width: 64, height: 64 } };
    const session = createSession({ screen, menubar: () => menubar, desktop: () => [school] });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    const onBar = { x: 1440, y: 10, radius: 60 };
    session(gaze(3100, onBar));
    expect(session(gaze(6100, onBar))).toMatchObject({ phase: 'icons', source: 'menubar' });
  });

  it('closes a menu that opens after the user has left with the Stop Gesture', () => {
    const { session, actions } = onMenuBar();
    session(select(6200));
    session(gaze(6300, { x: -400, y: 500, radius: 120 }));
    session(gaze(11_300, { x: -400, y: 500, radius: 120 }));
    expect(session({ type: 'menu-opened', t: 11_400, icons: commands }).phase).toBe('idle');
    expect(actions.at(-1)).toEqual({ type: 'close-menu' });
  });

  it('does not scan a menu that opened with no commands', () => {
    const { session, actions } = onMenuBar();
    session(select(6200));
    expect(session({ type: 'menu-opened', t: 6800, icons: [] }).phase).toBe('waiting-for-target');
    expect(actions.map(({ type }) => type)).toEqual(['open-icon']);
  });

  it('does not count gaze past the top edge as Look Away during the scan', () => {
    const { session } = onMenuBar();
    expect(session(gaze(30_000, { x: 800, y: -400, radius: 120 })).phase).toBe('icons');
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
