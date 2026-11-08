import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCESSIBILITY_GUARD, jxaFor } from './jxa';
import type { InputAction } from './types';

type Scripted = Exclude<InputAction, { type: 'type' }>;

const count = (script: string, pattern: RegExp) => script.match(pattern)?.length ?? 0;

describe('jxaFor', () => {
  it('checks Accessibility before posting anything, because macOS drops the events silently', () => {
    const script = jxaFor({ type: 'key', keys: 'Return', repeat: 1 });
    expect(script.startsWith(ACCESSIBILITY_GUARD)).toBe(true);
    expect(script).toContain('AXIsProcessTrusted()');
  });

  it('moves the cursor with one mouseMoved event', () => {
    const script = jxaFor({ type: 'move', at: { x: 200, y: 150.5 } });
    expect(script).toContain('var p = {x: 200, y: 150.5};');
    expect(count(script, /CGEventCreateMouseEvent\(null, 5, p, 0\)/g)).toBe(1);
    expect(count(script, /CGEventPost/g)).toBe(1);
  });

  it('single left click: move, then down and up with click state 1', () => {
    const script = jxaFor({ type: 'click', at: { x: 10, y: 20 }, button: 'left', count: 1, modifiers: [] });
    expect(script).toContain('var p = {x: 10, y: 20};');
    expect(script).toContain('CGEventCreateMouseEvent(null, 1, p, 0)');
    expect(script).toContain('CGEventCreateMouseEvent(null, 2, p, 0)');
    expect(count(script, /CGEventSetIntegerValueField\(e, 1, 1\)/g)).toBe(2);
    expect(script).not.toContain('CGEventSetFlags');
  });

  it('double click raises the click state on the second pair', () => {
    const script = jxaFor({ type: 'click', at: { x: 10, y: 20 }, button: 'left', count: 2, modifiers: [] });
    expect(count(script, /CGEventSetIntegerValueField\(e, 1, 1\)/g)).toBe(2);
    expect(count(script, /CGEventSetIntegerValueField\(e, 1, 2\)/g)).toBe(2);
  });

  it('triple click has three pairs', () => {
    const script = jxaFor({ type: 'click', at: { x: 1, y: 2 }, button: 'left', count: 3, modifiers: [] });
    expect(count(script, /CGEventSetIntegerValueField\(e, 1, 3\)/g)).toBe(2);
  });

  it('right click uses the right button events', () => {
    const script = jxaFor({ type: 'click', at: { x: 1, y: 2 }, button: 'right', count: 1, modifiers: [] });
    expect(script).toContain('CGEventCreateMouseEvent(null, 3, p, 1)');
    expect(script).toContain('CGEventCreateMouseEvent(null, 4, p, 1)');
  });

  it('click with no point uses the current cursor and sets modifier flags', () => {
    const script = jxaFor({ type: 'click', at: null, button: 'left', count: 1, modifiers: ['cmd', 'shift'] });
    expect(script).toContain('CGEventGetLocation($.CGEventCreate(null))');
    expect(script).toContain(`CGEventSetFlags(e, ${0x100000 | 0x20000})`);
  });

  it.each([
    ['up', '5, 0'],
    ['down', '-5, 0'],
    ['left', '0, 5'],
    ['right', '0, -5'],
  ] as const)('scroll %s', (direction, deltas) => {
    const script = jxaFor({ type: 'scroll', at: null, direction, amount: 5, modifiers: [] });
    expect(script).toContain(`CGEventCreateScrollWheelEvent2(null, 1, 2, ${deltas}, 0)`);
    expect(script).not.toContain('CGEventCreateMouseEvent');
  });

  it('scroll moves to the point first when given', () => {
    const script = jxaFor({ type: 'scroll', at: { x: 5, y: 6 }, direction: 'down', amount: 3, modifiers: ['ctrl'] });
    expect(script.indexOf('CGEventCreateMouseEvent(null, 5')).toBeLessThan(script.indexOf('ScrollWheelEvent2'));
    expect(script).toContain(`CGEventSetFlags(e, ${0x40000})`);
  });

  it('key presses down and up with the keycode, repeated', () => {
    const script = jxaFor({ type: 'key', keys: 'cmd+l', repeat: 2 });
    expect(count(script, /CGEventCreateKeyboardEvent\(null, 37, true\)/g)).toBe(2);
    expect(count(script, /CGEventCreateKeyboardEvent\(null, 37, false\)/g)).toBe(2);
    expect(count(script, /CGEventSetFlags\(e, 1048576\)/g)).toBe(4);
  });

  it('rejects an unknown key', () => {
    expect(() => jxaFor({ type: 'key', keys: 'cmd+nope', repeat: 1 })).toThrow('Unknown key: nope');
  });

  const samples: Scripted[] = [
    { type: 'move', at: { x: 1, y: 2 } },
    { type: 'click', at: { x: 1, y: 2 }, button: 'left', count: 3, modifiers: ['alt'] },
    { type: 'click', at: null, button: 'right', count: 1, modifiers: [] },
    { type: 'scroll', at: { x: 1, y: 2 }, direction: 'left', amount: 4, modifiers: ['shift'] },
    { type: 'scroll', at: null, direction: 'up', amount: 4, modifiers: [] },
    { type: 'key', keys: 'ctrl+shift+Tab', repeat: 3 },
  ];

  it.runIf(process.platform === 'darwin').each(samples)('compiles with osacompile: %j', (action) => {
    const dir = mkdtempSync(join(tmpdir(), 'jxa-'));
    try {
      execFileSync('osacompile', ['-l', 'JavaScript', '-o', join(dir, 'x.scpt'), '-e', jxaFor(action)], { stdio: 'pipe' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
