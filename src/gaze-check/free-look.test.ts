import { describe, expect, it } from 'vitest';
import { blinkCounter, holdTimer } from './free-look';

describe('holdTimer', () => {
  it('fires once the condition has held for the whole duration', () => {
    const held = holdTimer(3000);
    expect(held(0, true)).toBe(false);
    expect(held(2999, true)).toBe(false);
    expect(held(3000, true)).toBe(true);
  });

  it('starts again after a break', () => {
    const held = holdTimer(3000);
    held(0, true);
    held(2000, false);
    expect(held(3000, true)).toBe(false);
    expect(held(5999, true)).toBe(false);
    expect(held(6000, true)).toBe(true);
  });
});

describe('blinkCounter', () => {
  // Each blink closes the eyes at t and opens them 100 ms later. Returns whether any frame fired.
  const blinkAt = (count: ReturnType<typeof blinkCounter>, times: number[]) =>
    times.map((t) => [count(t, true), count(t + 100, false)].some(Boolean));

  it('fires on the fourth quick blink', () => {
    expect(blinkAt(blinkCounter(), [0, 500, 1000, 1500])).toEqual([false, false, false, true]);
  });

  it('ignores blinks that are too far apart', () => {
    expect(blinkAt(blinkCounter(), [0, 2000, 4000, 6000])).toEqual([false, false, false, false]);
  });

  it('counts eyes held closed as one blink', () => {
    const count = blinkCounter();
    expect([0, 100, 200, 300, 400].some((t) => count(t, true))).toBe(false);
  });

  it('needs four new blinks after firing', () => {
    const count = blinkCounter();
    blinkAt(count, [0, 500, 1000, 1500]);
    expect(blinkAt(count, [2000, 2500, 3000])).toEqual([false, false, false]);
  });
});
