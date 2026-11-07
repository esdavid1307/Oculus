import { describe, expect, it } from 'vitest';
import type { GazeEvent } from './gaze';
import { createSession } from './session';

const screen = { width: 1600, height: 1000 };
const onWakeTarget = { x: 1500, y: 100, radius: 60 };
const offTarget = { x: 800, y: 500, radius: 60 };

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
