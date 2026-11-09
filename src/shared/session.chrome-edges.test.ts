// Issue #22 test pass (2026-11-09): how the session treats Chrome near the screen's edges, with the geometry measured
// on a 14" MacBook Pro (1800 x 1169 points, a 39 point menu bar) and Chrome 157 maximised under it. Mouse gaze has a
// 60 point radius, camera gaze 120 (src/renderer/gaze-source.ts). The bugs it found are written up
// in TEST-REPORT-22.local.md.
import { describe, expect, it } from 'vitest';
import type { GazeEvent, GazeRegion } from './gaze';
import { createSession, type AgentAction, type Icon, type OverlayState } from './session';

const screen = { width: 1800, height: 1169 };
const MOUSE = 60;
const CAMERA = 120;
const inBox = { x: 900, y: 585, radius: CAMERA };
const gaze = (t: number, region: GazeEvent['region']): GazeEvent => ({ type: 'gaze', t, region });
const tick = (t: number) => ({ type: 'tick', t }) as const;
const select = (t: number) => ({ type: 'select', t }) as const;

// Chrome's menus in the menu bar, as READ_MENU_BAR reads them (measured).
const menubar: Icon[] = [
  ['Apple', 10, 34],
  ['Chrome', 43, 72],
  ['File', 114, 42],
  ['Edit', 155, 44],
  ['View', 198, 50],
  ['History', 247, 65],
].map(([name, x, width]) => ({ name: String(name), label: String(name), rect: { x: Number(x), y: 0, width: Number(width), height: 39 } }));
// Text boxes as READ_TEXT_BOXES reports them (measured): the address bar, and the VideoTube mock's search box.
const addressBar = { name: 'AXTextField#0:Address and search bar', rect: { x: 187, y: 90, width: 1484, height: 24 } };
const searchBox = { name: 'AXTextField#1:Search', rect: { x: 148, y: 136, width: 559, height: 36 } };
// Chrome elements the helper found by the toolbar (measured).
const back = { name: 'AXButton Back', label: 'Back', rect: { x: 0, y: 85, width: 40, height: 34 } };
const reload = { name: 'AXButton Reload', label: 'Reload', rect: { x: 78, y: 85, width: 34, height: 34 } };

const at = (x: number, y: number, radius: number): GazeRegion => ({ x, y, radius });

function awake(options: Partial<Parameters<typeof createSession>[0]> = {}) {
  const actions: AgentAction[] = [];
  const session = createSession({ screen, act: (a) => a.type !== 'learn' && actions.push(a), menubar: () => menubar, chromeInFront: () => true, ...options });
  session(gaze(0, inBox));
  session(gaze(3000, inBox));
  // Move Off the Centre Box first, as a real look at the top would.
  session(gaze(3050, at(900, 900, CAMERA)));
  return { session, actions };
}

// Holds a region from t for ms, sampling every 100 ms as the camera would, and returns the last state.
function hold(session: (input: GazeEvent) => OverlayState, region: GazeRegion, from: number, ms: number) {
  let state: OverlayState | undefined;
  for (let t = from; t <= from + ms; t += 100) state = session(gaze(t, region));
  return state!;
}

describe('target hold vs the menu bar Icon Scan in Chrome', () => {
  // docs/chrome-scan.md: "Looking at the tab strip falls back to the 1 second target hold."
  it('a 1 second look at a Chrome tab, just under the menu bar, asks for Suggested Intents (mouse gaze)', () => {
    const { session, actions } = awake();
    const tab = at(300, 59, MOUSE);
    hold(session, tab, 3100, 1000);
    expect(actions.map((a) => a.type)).toContain('suggest-intents');
  });

  it('a 1 second look at a Chrome tab asks for Suggested Intents (camera gaze)', () => {
    const { session, actions } = awake();
    hold(session, at(300, 59, CAMERA), 3100, 1000);
    expect(actions.map((a) => a.type)).toContain('suggest-intents');
  });

  it('the address bar opens the Gaze Keyboard after 1 second with mouse gaze (63 points below the menu bar)', () => {
    const { session, actions } = awake({ textBoxes: () => [addressBar] });
    expect(hold(session, at(600, 102, MOUSE), 3100, 1000).phase).toBe('typing');
    expect(actions[0]).toMatchObject({ type: 'focus-text-box', name: addressBar.name });
  });

  // docs/chrome-scan.md: "Text boxes (the address bar, a search box) are left to the Gaze Keyboard."
  it('the address bar opens the Gaze Keyboard after 1 second with camera gaze', () => {
    const { session } = awake({ textBoxes: () => [addressBar] });
    expect(hold(session, at(600, 102, CAMERA), 3100, 1000).phase).toBe('typing');
  });

  // #13 acceptance: "Works on the YouTube search box". Its centre is about 115 points below the menu bar.
  it('a search box just under the toolbar opens the Gaze Keyboard after 1 second with camera gaze', () => {
    const { session } = awake({ textBoxes: () => [searchBox] });
    expect(hold(session, at(420, 154, CAMERA), 3100, 1000).phase).toBe('typing');
  });

  it('a search box further down (camera gaze, more than 120 points below the menu bar) still opens the keyboard', () => {
    const { session } = awake({ textBoxes: () => [{ ...searchBox, rect: { ...searchBox.rect, y: 200 } }] });
    expect(hold(session, at(420, 218, CAMERA), 3100, 1000).phase).toBe('typing');
  });

  it('boundary: the gaze centre on the bottom edge of the menu bar is near it, one point below is not', () => {
    const onEdge = awake();
    expect(hold(onEdge.session, at(900, 39, CAMERA), 3100, 1000).phase).toBe('waiting-for-target');
    const past = awake();
    expect(hold(past.session, at(900, 40, CAMERA), 3100, 1000).phase).toBe('thinking');
  });

  // The stricter rule is only for Chrome: in any other app a look that lands a little low still reaches the menu bar.
  it('with Chrome not in front, a camera look just below the menu bar still starts its Icon Scan', () => {
    const { session } = awake({ chromeInFront: () => false });
    expect(hold(session, at(300, 59, CAMERA), 3100, 3000)).toMatchObject({ phase: 'icons', source: 'menubar' });
    const past = awake({ chromeInFront: () => false });
    expect(hold(past.session, at(300, 39 + CAMERA + 1, CAMERA), 3100, 1000).phase).toBe('thinking');
  });

  it('looking past the top edge still starts the menu bar Icon Scan', () => {
    const { session } = awake();
    expect(hold(session, at(300, -40, CAMERA), 3100, 3000)).toMatchObject({ phase: 'icons', source: 'menubar' });
  });
});

describe('Gaze Scan in Chrome near the top edge ("chromeScan": true)', () => {
  it('the nearer source wins: on Back, below the menu bar, the Chrome elements win over the menu bar', () => {
    const { session } = awake({ chrome: () => [back, reload] });
    expect(hold(session, at(20, 100, MOUSE), 3100, 3000)).toMatchObject({ phase: 'icons', source: 'chrome' });
  });

  it('on a tie with the menu bar, the menu bar wins (sort order dock, menubar, desktop, chrome)', () => {
    const chromeMenu = { name: 'AXMenuBarItem History', label: 'History', rect: menubar[5].rect };
    const { session } = awake({ chrome: () => [chromeMenu] });
    expect(hold(session, at(280, 20, MOUSE), 3100, 3000)).toMatchObject({ phase: 'icons', source: 'menubar' });
  });

  it('a text box keeps the Chrome hold away, so the address bar still opens the keyboard with mouse gaze', () => {
    const { session } = awake({ chrome: () => [back, reload], textBoxes: () => [addressBar] });
    expect(hold(session, at(300, 102, MOUSE), 3100, 1000).phase).toBe('typing');
  });

  it('boundary: the Chrome hold sticks at exactly 3 seconds, not before', () => {
    const { session } = awake({ chrome: () => [back] });
    for (let t = 3100; t < 6100; t += 100) session(gaze(t, at(20, 100, MOUSE)));
    expect(session(gaze(6099, at(20, 100, MOUSE))).phase).toBe('waiting-for-target');
    expect(session(gaze(6100, at(20, 100, MOUSE))).phase).toBe('icons');
  });

  it('a lookup that comes back empty at the 3 second mark starts no scan, and the 1 second hold takes over', () => {
    let found: Icon[] = [back];
    const { session, actions } = awake({ chrome: () => found });
    hold(session, at(20, 100, MOUSE), 3100, 2900);
    found = [];
    expect(session(gaze(6100, at(20, 100, MOUSE))).phase).toBe('waiting-for-target');
    expect(hold(session, at(20, 100, MOUSE), 6200, 1000).phase).toBe('thinking');
    expect(actions.at(-1)).toMatchObject({ type: 'suggest-intents' });
    expect(actions.at(-1)).not.toHaveProperty('element');
  });

  // The glossary keeps "past the edge counts as on the icons" for Icon Scan. The toolbar is 85 points from the edge.
  it('looking up past the top edge stops a Chrome scan of the toolbar after 5 seconds (camera gaze)', () => {
    const { session } = awake({ chrome: () => [back, reload] });
    hold(session, at(40, 100, CAMERA), 3100, 3000);
    expect(session(tick(6200)).phase).toBe('icons');
    const up = at(60, -300, CAMERA);
    hold(session, up, 6300, 5000);
    expect(session(gaze(11_400, up)).phase).toBe('idle');
  });

  it('looking up past the top edge stops a Chrome scan of the toolbar after 5 seconds (mouse gaze, 60 radius)', () => {
    const { session } = awake({ chrome: () => [back, reload] });
    hold(session, at(40, 100, MOUSE), 3100, 3000);
    hold(session, at(60, -300, MOUSE), 6300, 5000);
    expect(session(gaze(11_400, at(60, -300, MOUSE))).phase).toBe('idle');
  });

  it('a null gaze (face lost) always stops a Chrome scan after 5 seconds', () => {
    const { session } = awake({ chrome: () => [back, reload] });
    hold(session, at(40, 100, CAMERA), 3100, 3000);
    session(gaze(6300, null));
    expect(session(gaze(11_300, null)).phase).toBe('idle');
  });

  it('a Select Blink on a toolbar element asks for Suggested Intents with the element and the panel away from it', () => {
    const { session, actions } = awake({ chrome: () => [back, reload] });
    hold(session, at(40, 100, MOUSE), 3100, 3000);
    session(select(6200));
    expect(actions.at(-1)).toMatchObject({ type: 'suggest-intents', element: { name: 'Back' }, region: { x: 20, y: 102, radius: MOUSE } });
    session({ type: 'intents', t: 7000, request: 1, intents: ['Go back'] });
    expect(session(tick(7100))).toMatchObject({ phase: 'choosing', side: 'right' });
  });
});

describe('Suggested Intents panel side for Chrome targets', () => {
  it('a target exactly in the middle puts the panel on the left, a point left of it on the right', () => {
    const mid = awake();
    hold(mid.session, at(900, 900, MOUSE), 3100, 1000);
    mid.session({ type: 'intents', t: 5000, request: 1, intents: ['Open this video'] });
    expect(mid.session(tick(5100))).toMatchObject({ side: 'left' });
    const left = awake();
    hold(left.session, at(899, 900, MOUSE), 3100, 1000);
    left.session({ type: 'intents', t: 5000, request: 1, intents: ['Open this video'] });
    expect(left.session(tick(5100))).toMatchObject({ side: 'right' });
  });
});

describe('a Chrome hold that ends on a sample with no gaze', () => {
  it('asks about the chosen element with the radius last seen, not 0', () => {
    const { session, actions } = awake({ chrome: () => [back] });
    hold(session, at(20, 100, MOUSE), 3100, 2900);
    // The hold grace lets the 3 seconds finish on a blink.
    expect(session(gaze(6100, null)).phase).toBe('icons');
    session(select(6200));
    expect(actions.at(-1)).toMatchObject({ type: 'suggest-intents', region: { radius: MOUSE } });
  });
});
