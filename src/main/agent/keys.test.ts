import { describe, expect, it } from 'vitest';
import { MODIFIER_FLAGS, modifierFlags, parseKeyCombo } from './keys';

describe('parseKeyCombo', () => {
  it('parses a modifier and a letter', () => {
    expect(parseKeyCombo('cmd+l')).toEqual({ keyCode: 37, flags: 0x100000 });
  });

  it('parses a bare key case-insensitively', () => {
    expect(parseKeyCombo('Return')).toEqual({ keyCode: 36, flags: 0 });
    expect(parseKeyCombo('KP_Enter')).toEqual({ keyCode: 76, flags: 0 });
    expect(parseKeyCombo('Page_Down').keyCode).toBe(121);
  });

  it('combines modifiers', () => {
    expect(parseKeyCombo('ctrl+shift+Tab')).toEqual({ keyCode: 48, flags: MODIFIER_FLAGS.ctrl | MODIFIER_FLAGS.shift });
  });

  it('maps xdotool names to macOS modifiers', () => {
    expect(parseKeyCombo('super+a')).toEqual({ keyCode: 0, flags: MODIFIER_FLAGS.cmd });
    expect(parseKeyCombo('Alt+F4')).toEqual({ keyCode: 118, flags: MODIFIER_FLAGS.alt });
  });

  it('sends the Mission Control key with the Fn flag, or the Dock ignores it', () => {
    expect(parseKeyCombo('cmd+mission_control')).toEqual({ keyCode: 160, flags: MODIFIER_FLAGS.cmd | 0x800000 });
    expect(parseKeyCombo('F3')).toEqual({ keyCode: 99, flags: 0 });
  });

  it('adds no implied shift for capitals', () => {
    expect(parseKeyCombo('A')).toEqual({ keyCode: 0, flags: 0 });
  });

  it('throws on unknown keys and modifiers', () => {
    expect(() => parseKeyCombo('cmd+nonsense')).toThrow('Unknown key: nonsense');
    expect(() => parseKeyCombo('hyper+a')).toThrow('Unknown key: hyper');
    expect(() => parseKeyCombo('')).toThrow('Unknown key: ');
  });
});

describe('modifierFlags', () => {
  it('ors the flags', () => {
    expect(modifierFlags([])).toBe(0);
    expect(modifierFlags(['cmd', 'alt'])).toBe(0x100000 | 0x80000);
  });
});
