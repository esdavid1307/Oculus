import { describe, expect, it, vi } from 'vitest';
import type { SessionInput } from '../shared/session';
import { createGazeSource, GAZE_REGION_RADIUS } from './gaze-source';

const setup = () => {
  const events: SessionInput[] = [];
  const onRecalibrate = vi.fn();
  const onDot = vi.fn();
  return { events, onRecalibrate, onDot, source: createGazeSource((event) => events.push(event), onRecalibrate, onDot) };
};

describe('gaze source', () => {
  it('reports smoothed gaze as a Gaze Region', () => {
    const { events, source } = setup();
    source({ t: 0, estimate: { x: 100, y: 200 } });
    source({ t: 100, estimate: { x: 300, y: 400 } });
    expect(events.at(-1)).toEqual({ type: 'gaze', t: 100, region: { x: 200, y: 300, radius: GAZE_REGION_RADIUS } });
  });

  it('moves the Gaze Dot with the smoothed gaze and hides it when tracking is lost', () => {
    const { onDot, source } = setup();
    source({ t: 0, estimate: { x: 100, y: 200 } });
    source({ t: 100, estimate: { x: 300, y: 400 } });
    expect(onDot).toHaveBeenLastCalledWith({ x: 200, y: 300 });
    source({ t: 133, estimate: null });
    expect(onDot).toHaveBeenLastCalledWith(null);
  });

  it('reports null when tracking is lost, and does not smooth across the gap', () => {
    const { events, source } = setup();
    source({ t: 0, estimate: { x: 100, y: 200 } });
    source({ t: 33, estimate: null });
    expect(events.at(-1)).toEqual({ type: 'gaze', t: 33, region: null });
    source({ t: 66, estimate: { x: 500, y: 600 } });
    expect(events.at(-1)).toMatchObject({ region: { x: 500, y: 600 } });
  });

  // Each blink closes the eyes at t and opens them 100 ms later.
  const blink = (source: ReturnType<typeof setup>['source'], t: number) => {
    source({ t, estimate: { x: 100, y: 200 }, eyesClosed: true });
    source({ t: t + 100, estimate: { x: 100, y: 200 }, eyesClosed: false });
  };

  it('asks to recalibrate on the Recalibrate Gesture', () => {
    const { onRecalibrate, source } = setup();
    [0, 500, 1000].forEach((t) => blink(source, t));
    expect(onRecalibrate).not.toHaveBeenCalled();
    blink(source, 1500);
    expect(onRecalibrate).toHaveBeenCalledOnce();
  });

  it('ignores natural blinks', () => {
    const { onRecalibrate, source } = setup();
    [0, 4000, 8000, 12000].forEach((t) => blink(source, t));
    expect(onRecalibrate).not.toHaveBeenCalled();
  });

  it('works without a calibration, so a failed one can still be redone', () => {
    const { events, onRecalibrate, source } = setup();
    [0, 500, 1000, 1500].forEach((t) => {
      source({ t, estimate: null, eyesClosed: true });
      source({ t: t + 100, estimate: null, eyesClosed: false });
    });
    expect(onRecalibrate).toHaveBeenCalledOnce();
    expect(events.every((event) => event.type === 'gaze' && event.region === null)).toBe(true);
  });

  const selects = (events: SessionInput[]) => events.filter((event) => event.type === 'select');

  it('sends one select for a Select Blink, when the eyes have been closed for half a second', () => {
    const { events, source } = setup();
    [0, 250, 499].forEach((t) => source({ t, estimate: { x: 100, y: 200 }, eyesClosed: true }));
    expect(selects(events)).toEqual([]);
    source({ t: 500, estimate: { x: 100, y: 200 }, eyesClosed: true });
    source({ t: 900, estimate: { x: 100, y: 200 }, eyesClosed: true });
    source({ t: 1000, estimate: { x: 100, y: 200 }, eyesClosed: false });
    expect(selects(events)).toEqual([{ type: 'select', t: 500 }]);
  });

  it('does not select on natural blinks or the Recalibrate Gesture', () => {
    const { events, source } = setup();
    [0, 500, 1000, 1500, 6000].forEach((t) => blink(source, t));
    expect(selects(events)).toEqual([]);
  });
});
