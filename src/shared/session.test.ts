import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import type { Rect } from './geometry';
import { GROUPS, layoutIntents, layoutKeyboard } from './keyboard';
import { createSession, type AgentAction, type OverlayState, type SessionInput } from './session';

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
    expect(session(gaze(6100, nearDock)).phase).not.toBe('icons');
  });

  it('uses the configured Dock hold', () => {
    const { session } = awake({ iconHoldMs: 1000 });
    session(gaze(3100, nearDock));
    expect(session(gaze(4100, nearDock)).phase).toBe('icons');
  });

  it('passes an icon\'s label through to the overlay', () => {
    const labelled = [{ name: '["Finder",0,2]', label: 'File', rect: items[0].rect }];
    const session = createSession({ screen, dock: () => labelled });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    session(gaze(3100, nearDock));
    expect(session(gaze(6100, nearDock))).toMatchObject({ phase: 'icons', highlight: { name: '["Finder",0,2]', label: 'File' } });
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
    expect(session(gaze(6100, outsideBox)).phase).not.toBe('icons');
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
    expect(actions).toEqual([{ type: 'suggest-intents', region: target, request: 1, turnedDown: [] }]);
  });

  it('needs a Move Off the Centre Box before a target hold starts, so staying on it after waking picks nothing', () => {
    const { session, actions } = awake();
    session(gaze(3100, inBox));
    expect(session(gaze(5000, inBox)).phase).toBe('waiting-for-target');
    expect(actions).toEqual([]);
    session(gaze(5100, target));
    session(gaze(5200, inBox));
    expect(session(gaze(6199, inBox)).phase).toBe('waiting-for-target');
    expect(session(gaze(6200, inBox)).phase).toBe('thinking');
    expect(actions).toEqual([{ type: 'suggest-intents', region: inBox, request: 1, turnedDown: [] }]);
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

  it('asks about where the gaze settled, not where the hold began', () => {
    const { session, actions } = awake();
    const settled = { ...target, x: target.x + 40 };
    session(gaze(3100, target));
    session(gaze(4100, settled));
    expect(actions).toEqual([{ type: 'suggest-intents', region: settled, request: 1, turnedDown: [] }]);
  });

  it('needs a full new hold after waking again, even if the last hold was cut short by the Gaze Keyboard', () => {
    const { session, actions } = awake();
    session(gaze(3100, target));
    session({ type: 'open-keyboard', t: 3500 });
    session(gaze(3600, offScreen));
    session(gaze(8600, offScreen));
    session(gaze(9000, inBox));
    expect(session(gaze(12_000, inBox)).phase).toBe('waiting-for-target');
    expect(session(gaze(12_100, target)).phase).toBe('waiting-for-target');
    expect(actions).toEqual([]);
    expect(session(gaze(13_099, target)).phase).toBe('waiting-for-target');
    expect(session(gaze(13_100, target)).phase).toBe('thinking');
  });

  const thinking = () => {
    const woken = awake();
    woken.session(gaze(3100, target));
    woken.session(gaze(4100, target));
    return woken;
  };

  const select = (t: number) => ({ type: 'select', t }) as const;

  it('shows up to 3 Suggested Intents from the model, plus Something else, highlighting the first', () => {
    const { session } = thinking();
    const intents = ['Skip the ad', 'Open a related video', 'Pause', 'Like the video'];
    expect(session({ type: 'intents', t: 5000, request: 1, intents })).toEqual({
      phase: 'choosing',
      wakeProgress: 0,
      intents: ['Skip the ad', 'Open a related video', 'Pause'],
      highlight: 'intent-0',
    });
    expect(layoutIntents(screen, ['Skip the ad', 'Open a related video', 'Pause']).map((key) => key.label)).toEqual([
      'Skip the ad',
      'Open a related video',
      'Pause',
      'Something else',
    ]);
  });

  // Suggestions arrive at 5000 ms, so the scan reaches intent-1 at 7000, intent-2 at 9000 and Something else at 11000.
  const choosing = (intents = ['Skip the ad', 'Open a related video', 'Pause']) => {
    const woken = thinking();
    woken.session({ type: 'intents', t: 5000, request: 1, intents });
    return woken;
  };

  it('moves the highlight to the next choice every 2 seconds, and wraps round', () => {
    const { session } = choosing();
    expect(session(tick(6999))).toMatchObject({ highlight: 'intent-0' });
    expect(session(tick(7000))).toMatchObject({ highlight: 'intent-1' });
    expect(session(tick(11_000))).toMatchObject({ highlight: 'something-else' });
    expect(session(tick(13_000))).toMatchObject({ highlight: 'intent-0' });
  });

  it('scans only the choices on screen when the model offers fewer than 3', () => {
    const { session } = choosing(['Pause']);
    expect(session(tick(7000))).toMatchObject({ highlight: 'something-else' });
    expect(session(tick(9000))).toMatchObject({ highlight: 'intent-0' });
  });

  it('runs the highlighted Suggested Intent on a Select Blink, which is the confirmation', () => {
    const { session, actions } = choosing();
    session(tick(9000));
    expect(actions).toEqual([{ type: 'suggest-intents', region: target, request: 1, turnedDown: [] }]);
    expect(session(select(9100))).toEqual({ phase: 'running', wakeProgress: 0, intent: 'Pause' });
    expect(actions.at(-1)).toEqual({ type: 'run-intent', intent: 'Pause', region: target, request: 2 });
  });

  it('presses nothing by looking at a choice', () => {
    const { session, actions } = choosing();
    const { x, y, width, height } = layoutIntents(screen, ['Skip the ad', 'Open a related video', 'Pause'])[2].rect;
    const onPause = { x: x + width / 2, y: y + height / 2, radius: 120 };
    session(gaze(5100, onPause));
    expect(session(gaze(8100, onPause)).phase).toBe('choosing');
    expect(actions).toHaveLength(1);
  });

  it('fetches fresh suggestions for the same target on Something else, passing over the ones shown', () => {
    const { session, actions } = choosing();
    session(tick(11_000));
    expect(session(select(11_000)).phase).toBe('thinking');
    expect(actions).toEqual([
      { type: 'suggest-intents', region: target, request: 1, turnedDown: [] },
      { type: 'suggest-intents', region: target, request: 2, turnedDown: ['Skip the ad', 'Open a related video', 'Pause'] },
    ]);
  });

  it('keeps passing over everything turned down for this target, and forgets it for a new target', () => {
    const { session, actions } = choosing();
    session(select(11_000));
    session({ type: 'intents', t: 12_000, request: 2, intents: ['Mute'] });
    session(select(14_000));
    expect(actions.at(-1)).toEqual({
      type: 'suggest-intents',
      region: target,
      request: 3,
      turnedDown: ['Skip the ad', 'Open a related video', 'Pause', 'Mute'],
    });

    session(gaze(14_100, offScreen));
    session(gaze(19_100, offScreen));
    session(gaze(19_200, inBox));
    session(gaze(22_200, inBox));
    session(gaze(22_300, target));
    session(gaze(23_300, target));
    expect(actions.at(-1)).toEqual({ type: 'suggest-intents', region: target, request: 4, turnedDown: [] });
  });

  it('starts the scan again from the first choice when fresh suggestions arrive', () => {
    const { session } = choosing();
    session(select(11_000));
    expect(session({ type: 'intents', t: 12_000, request: 2, intents: ['Mute'] })).toMatchObject({ phase: 'choosing', highlight: 'intent-0' });
  });

  it('ignores a Select Blink while thinking', () => {
    const { session, actions } = thinking();
    expect(session(select(4500)).phase).toBe('thinking');
    expect(actions).toHaveLength(1);
  });

  const stopRun = { type: 'stop-run', request: 2 };

  it.each([
    ['thinking', () => thinking(), []],
    ['choosing', () => choosing(), []],
    [
      'running',
      () => {
        const woken = choosing();
        woken.session(select(5100));
        return woken;
      },
      [stopRun],
    ],
  ])('stops on the Stop Gesture while %s', (phase, reach, stops) => {
    const { session, actions } = reach();
    expect(session(tick(6200)).phase).toBe(phase);
    session(gaze(6200, offScreen));
    expect(session(tick(11_200))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(actions.filter((action) => action.type === 'stop-run')).toEqual(stops);
  });

  it('ignores a late answer to an earlier request', () => {
    const { session } = thinking();
    session(gaze(4200, offScreen));
    session(gaze(9200, offScreen));
    session(gaze(9300, inBox));
    session(gaze(12_300, inBox));
    session(gaze(12_400, target));
    expect(session(gaze(13_400, target)).phase).toBe('thinking');
    expect(session({ type: 'intents', t: 13_500, request: 1, intents: ['Old'] }).phase).toBe('thinking');
    expect(session({ type: 'intents', t: 13_600, request: 2, intents: ['New'] })).toMatchObject({ intents: ['New'] });
  });

  it('ignores suggestions that arrive when it is not thinking', () => {
    const { session } = awake();
    expect(session({ type: 'intents', t: 3100, request: 1, intents: ['Pause'] }).phase).toBe('waiting-for-target');
  });
});

describe('Running an Intent', () => {
  const target = { x: 300, y: 300, radius: 120 };
  const select = (t: number) => ({ type: 'select', t }) as const;
  const finish = (t: number, request = 2, ok = true, summary = 'Skipped the ad.') => ({ type: 'run-finished', t, request, ok, summary }) as const;
  const stops = (actions: AgentAction[]) => actions.filter((action) => action.type === 'stop-run');

  // Woken at 3 s, thinking from 4.1 s (request 1), choosing from 5 s, and the first Intent chosen at 5.1 s (request 2).
  const reach = (until: 'awake' | 'thinking' | 'choosing' | 'running', timings?: unknown) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, timings, act: (action) => actions.push(action) });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    if (until !== 'awake') {
      session(gaze(3100, target));
      session(gaze(4100, target));
    }
    if (until === 'choosing' || until === 'running') session({ type: 'intents', t: 5000, request: 1, intents: ['Skip the ad', 'Pause'] });
    if (until === 'running') session(select(5100));
    return { session, actions };
  };

  it('asks the agent to run the chosen Intent on its target, with the next request number', () => {
    const { session, actions } = reach('choosing');
    expect(session(select(5100))).toEqual({ phase: 'running', wakeProgress: 0, intent: 'Skip the ad' });
    expect(actions.at(-1)).toEqual({ type: 'run-intent', intent: 'Skip the ad', region: target, request: 2 });
  });

  it('shows the result when the run finishes', () => {
    const { session } = reach('running');
    expect(session(finish(6000))).toEqual({ phase: 'finished', wakeProgress: 0, intent: 'Skip the ad', ok: true, summary: 'Skipped the ad.' });
    const failed = reach('running');
    expect(failed.session(finish(6000, 2, false, 'No skip button.'))).toMatchObject({ phase: 'finished', ok: false, summary: 'No skip button.' });
  });

  it('goes idle 3 seconds after the run finishes, on a tick or a gaze event', () => {
    const { session } = reach('running');
    session(finish(6000));
    expect(session(tick(8999)).phase).toBe('finished');
    expect(session(tick(9000))).toEqual({ phase: 'idle', wakeProgress: 0 });
    const byGaze = reach('running');
    byGaze.session(finish(6000));
    expect(byGaze.session(gaze(8999, inBox)).phase).toBe('finished');
    expect(byGaze.session(gaze(9000, inBox)).phase).toBe('idle');
  });

  it('uses the configured finished time', () => {
    const { session } = reach('running', { finishedMs: 500 });
    session(finish(6000));
    expect(session(tick(6499)).phase).toBe('finished');
    expect(session(tick(6500)).phase).toBe('idle');
  });

  it('needs a full new hold to wake again after the result goes away', () => {
    const { session } = reach('running');
    session(finish(6000));
    session(tick(9000));
    session(gaze(9100, inBox));
    expect(session(gaze(12_099, inBox)).phase).toBe('idle');
    expect(session(gaze(12_100, inBox)).phase).toBe('waiting-for-target');
  });

  it('ignores the end of an earlier run while running', () => {
    const { session } = reach('running');
    expect(session(finish(6000, 1)).phase).toBe('running');
    expect(session(finish(6100, 3)).phase).toBe('running');
    expect(session(finish(6200)).phase).toBe('finished');
  });

  it('ignores the end of a run when none is running', () => {
    for (const until of ['awake', 'thinking', 'choosing'] as const) {
      const { session } = reach(until);
      expect(session(finish(5200, 1)).phase).toBe(until === 'awake' ? 'waiting-for-target' : until);
    }
    expect(createSession({ screen })(finish(0, 0)).phase).toBe('idle');
  });

  it('keeps the first result if the run is reported finished again', () => {
    const { session } = reach('running');
    session(finish(6000));
    expect(session(finish(6100, 2, false, 'Late.'))).toMatchObject({ phase: 'finished', ok: true, summary: 'Skipped the ad.' });
  });

  it('stops the run once on the Stop Gesture, then goes idle', () => {
    const { session, actions } = reach('running');
    session(gaze(6000, offScreen));
    expect(session(gaze(10_999, offScreen)).phase).toBe('running');
    expect(stops(actions)).toEqual([]);
    expect(session(gaze(11_000, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    session(gaze(12_000, offScreen));
    session(tick(20_000));
    expect(stops(actions)).toEqual([{ type: 'stop-run', request: 2 }]);
  });

  it('ignores the end of a stopped run', () => {
    const { session } = reach('running');
    session(gaze(6000, offScreen));
    session(gaze(11_000, offScreen));
    expect(session(finish(11_500))).toEqual({ phase: 'idle', wakeProgress: 0 });
  });

  it.each(['thinking', 'choosing'] as const)('sends no stop-run on the Stop Gesture while %s', (until) => {
    const { session, actions } = reach(until);
    session(gaze(5100, offScreen));
    expect(session(gaze(10_100, offScreen)).phase).toBe('idle');
    expect(stops(actions)).toEqual([]);
  });

  it('sends no stop-run on the Stop Gesture while showing the result', () => {
    const { session, actions } = reach('running', { finishedMs: 20_000 });
    session(finish(6000));
    session(gaze(6100, offScreen));
    expect(session(gaze(11_100, offScreen))).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(stops(actions)).toEqual([]);
  });

  it('ignores open-keyboard while running, but not while showing the result', () => {
    const { session } = reach('running');
    expect(session({ type: 'open-keyboard', t: 5200 })).toMatchObject({ phase: 'running' });
    session(finish(6000));
    expect(session({ type: 'open-keyboard', t: 6100 })).toMatchObject({ phase: 'typing', text: '' });
  });

  it('ignores a Select Blink while running and while showing the result', () => {
    const { session, actions } = reach('running');
    expect(session(select(5500)).phase).toBe('running');
    session(finish(6000));
    expect(session(select(6100)).phase).toBe('finished');
    expect(actions).toHaveLength(2);
  });
});

describe('Suggested Phrase', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  const phrases: Record<string, string> = { pl: 'please call the nurse', pla: 'please call the nurse' };
  const make = (withPhrases = true) => {
    const session = createSession({
      screen,
      suggest: (text) => (text === '' ? [] : ['one', 'two', 'three']),
      suggestPhrase: withPhrases ? (text) => phrases[text] : undefined,
    });
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
    const type = (...letters: string[]) => letters.forEach((l) => (press(GROUPS.find((g) => g.includes(l))!), press(l)));
    return { press, type, state: () => state };
  };

  it('offers no phrase on an empty keyboard or after 1 letter', () => {
    const { type, state } = make();
    expect(state()).not.toHaveProperty('phrase');
    type('p');
    expect(state()).not.toHaveProperty('phrase');
  });

  it('offers the phrase after 2 letters and scans it before the Suggested Words', () => {
    const { type, state } = make();
    type('p', 'l');
    expect(state()).toMatchObject({ phrase: 'please call the nurse', suggestions: ['one', 'two', 'three'], highlight: 'phrase' });
  });

  it('replaces everything typed with the phrase when pressed', () => {
    const { type, press, state } = make();
    type('p', 'l');
    expect(press('phrase')).toMatchObject({ text: 'please call the nurse', group: null });
    expect(state()).not.toHaveProperty('phrase');
  });

  it('hides the phrase key on the letter screens', () => {
    expect(layoutKeyboard(screen, 'abcde', [], 'x').keys.map(({ id }) => id)).not.toContain('phrase');
  });

  it('behaves as before without a phrase dependency', () => {
    const { type, state } = make(false);
    type('p', 'l');
    expect(state()).not.toHaveProperty('phrase');
    expect(state()).toMatchObject({ highlight: 'word:one' });
  });

  it('lays the phrase out as one wide first row, with the words after it, without overlap', () => {
    for (const size of [{ width: 1512, height: 982 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const { keys } = layoutKeyboard(size, null, ['a', 'b', 'c'], 'a whole sentence');
      expect(keys.length).toBeLessThanOrEqual(13);
      expect(keys[0]).toMatchObject({ id: 'phrase', label: 'a whole sentence' });
      expect(keys[0].rect.width).toBeCloseTo(size.width);
      expect(keys.slice(1, 4).map(({ id }) => id)).toEqual(['word:a', 'word:b', 'word:c']);
      const hit = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      for (const { rect } of keys) {
        expect(rect.x >= 0 && rect.y >= 120 && rect.x + rect.width <= size.width + 0.001 && rect.y + rect.height <= size.height + 0.001).toBe(true);
        for (const other of keys) if (other.rect !== rect) expect(hit(rect, other.rect)).toBe(false);
      }
    }
  });

  it('keeps the layout unchanged when there is no phrase', () => {
    expect(layoutKeyboard(screen, null, ['a', 'b'], undefined)).toEqual(layoutKeyboard(screen, null, ['a', 'b']));
    expect(layoutKeyboard(screen, null, [], '')).toEqual(layoutKeyboard(screen, null));
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

describe('Stop Gesture in every state', () => {
  const select = (t: number) => ({ type: 'select', t }) as const;
  const target = { x: 300, y: 300, radius: 120 };
  const nearDock = { x: 700, y: 820, radius: 120 };
  const dock = [{ name: 'Finder', rect: { x: 600, y: 910, width: 66, height: 82 } }];
  const commands = [{ name: 'Copy', rect: { x: 100, y: 40, width: 200, height: 22 } }];

  type Until = 'waiting-for-target' | 'thinking' | 'choosing' | 'running' | 'typing' | 'dock' | 'menu';

  // Woken at 3 s. Every state is reached by 6.2 s, so looking away from 7 s stops it at 12 s.
  const reach = (until: Until) => {
    const actions: AgentAction[] = [];
    const session = createSession({ screen, act: (action) => actions.push(action), suggest: () => [], dock: () => dock });
    session(gaze(0, inBox));
    session(gaze(3000, inBox));
    if (until === 'typing') session({ type: 'open-keyboard', t: 3100 });
    if (until === 'dock') {
      session(gaze(3100, nearDock));
      session(gaze(6100, nearDock));
    }
    if (until === 'menu') {
      // A menu bar item opened a menu, which is scanned next.
      session({ type: 'menu-opened', t: 3100, icons: commands });
    }
    if (until === 'thinking' || until === 'choosing' || until === 'running') {
      session(gaze(3100, target));
      session(gaze(4100, target));
    }
    if (until === 'choosing' || until === 'running') session({ type: 'intents', t: 5000, request: 1, intents: ['Skip the ad', 'Pause'] });
    if (until === 'running') session(select(5100));
    return { session, actions };
  };

  const states: Until[] = ['waiting-for-target', 'thinking', 'choosing', 'running', 'typing', 'dock'];

  it.each(states)('counts down and goes idle after 5 seconds off screen while %s', (until) => {
    const { session } = reach(until);
    expect(session(gaze(7000, offScreen)).stopInMs).toBe(5000);
    expect(session(gaze(9000, offScreen)).stopInMs).toBe(3000);
    expect(session(tick(11_999)).stopInMs).toBe(1);
    expect(session(tick(12_000))).toEqual({ phase: 'idle', wakeProgress: 0 });
  });

  it.each(states)('has no countdown while the gaze is on the screen, or after it comes back, while %s', (until) => {
    const { session } = reach(until);
    expect(session(gaze(7000, target))).not.toHaveProperty('stopInMs');
    session(gaze(7100, offScreen));
    expect(session(gaze(8000, target))).not.toHaveProperty('stopInMs');
  });

  it.each(states)('stops at once on recalibrating while %s', (until) => {
    const { session } = reach(until);
    expect(session({ type: 'recalibrate', t: 7000 })).toEqual({ phase: 'idle', wakeProgress: 0 });
  });

  it('shows no countdown while asleep, or on the result of a finished run', () => {
    const asleep = createSession({ screen });
    expect(asleep(gaze(0, offScreen))).not.toHaveProperty('stopInMs');
    const { session } = reach('running');
    session({ type: 'run-finished', t: 6000, request: 2, ok: true, summary: 'Done.' });
    expect(session(gaze(6100, offScreen))).not.toHaveProperty('stopInMs');
  });

  it('closes the Gaze Keyboard without typing the text, on the Stop Gesture and on recalibrating', () => {
    for (const stopIt of [(s: ReturnType<typeof reach>['session']) => s(gaze(12_000, offScreen)), (s: ReturnType<typeof reach>['session']) => s({ type: 'recalibrate', t: 7000 })]) {
      const { session, actions } = reach('typing');
      session(select(3200));
      session(gaze(7000, offScreen));
      expect(stopIt(session).phase).toBe('idle');
      expect(actions.filter((action) => action.type === 'type-text')).toEqual([]);
    }
  });

  it('discards typed text on recalibrating, so the next keyboard starts empty', () => {
    const { session } = reach('typing');
    session(select(3200));
    session({ type: 'recalibrate', t: 7000 });
    expect(session({ type: 'open-keyboard', t: 8000 })).toMatchObject({ phase: 'typing', text: '' });
  });

  it('opens nothing from an icon scan on the Stop Gesture or recalibrating', () => {
    for (const stopIt of [(s: ReturnType<typeof reach>['session']) => s(gaze(12_000, offScreen)), (s: ReturnType<typeof reach>['session']) => s({ type: 'recalibrate', t: 7000 })]) {
      const { session, actions } = reach('dock');
      session(gaze(7000, offScreen));
      stopIt(session);
      expect(actions.filter((action) => action.type === 'open-icon')).toEqual([]);
    }
  });

  it('closes the open menu on the Stop Gesture and on recalibrating', () => {
    const { session, actions } = reach('menu');
    session(gaze(7000, offScreen));
    session(gaze(12_000, offScreen));
    expect(actions.filter((action) => action.type === 'close-menu')).toHaveLength(1);
    const other = reach('menu');
    other.session({ type: 'recalibrate', t: 7000 });
    expect(other.actions.filter((action) => action.type === 'close-menu')).toHaveLength(1);
  });

  it('stops a run once on recalibrating, and asks for nothing after it', () => {
    const { session, actions } = reach('running');
    const before = actions.length;
    session({ type: 'recalibrate', t: 7000 });
    expect(actions.slice(before)).toEqual([{ type: 'stop-run', request: 2 }]);
    for (const input of [gaze(7100, offScreen), gaze(12_100, offScreen), tick(20_000), select(21_000), { type: 'recalibrate', t: 22_000 } as const]) session(input);
    expect(actions).toHaveLength(before + 1);
  });

  it('asks for nothing after the stop-run of the Stop Gesture, whatever arrives next', () => {
    const { session, actions } = reach('running');
    session(gaze(6000, offScreen));
    session(gaze(11_000, offScreen));
    const after = actions.length;
    const inputs = [
      gaze(11_100, target),
      tick(12_000),
      select(12_100),
      { type: 'run-finished', t: 12_200, request: 2, ok: true, summary: 'Late.' } as const,
      { type: 'intents', t: 12_300, request: 2, intents: ['Pause'] } satisfies SessionInput,
      gaze(13_000, offScreen),
      gaze(18_000, offScreen),
    ];
    for (const input of inputs) expect(session(input).phase).toBe('idle');
    expect(actions).toHaveLength(after);
  });

  it('does nothing on recalibrating while asleep', () => {
    const { actions } = reach('waiting-for-target');
    const session = createSession({ screen, act: (action) => actions.push(action) });
    expect(session({ type: 'recalibrate', t: 100 })).toEqual({ phase: 'idle', wakeProgress: 0 });
    expect(actions).toEqual([]);
  });

  it('lets the Dock go on recalibrating, as it does on the Stop Gesture', () => {
    const { session, actions } = reach('dock');
    session({ type: 'recalibrate', t: 7000 });
    expect(actions.filter((action) => action.type === 'release-dock')).toHaveLength(1);
  });
});
