import { MODIFIER_NAMES, type Modifier } from './types';

// CGEventFlags masks.
export const MODIFIER_FLAGS: Record<Modifier, number> = { cmd: 0x100000, shift: 0x20000, ctrl: 0x40000, alt: 0x80000 };

export function modifierFlags(modifiers: Modifier[]): number {
  return modifiers.reduce((flags, m) => flags | MODIFIER_FLAGS[m], 0);
}

// US ANSI virtual keycodes (Carbon HIToolbox). Keys are lowercase.
const KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
  '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25, '0': 29,
  '-': 27, minus: 27, '=': 24, equal: 24, '[': 33, bracketleft: 33, ']': 30, bracketright: 30,
  '\\': 42, backslash: 42, ';': 41, semicolon: 41, "'": 39, apostrophe: 39, '`': 50, grave: 50,
  ',': 43, comma: 43, '.': 47, period: 47, '/': 44, slash: 44,
  return: 36, enter: 36, kp_enter: 76, tab: 48, space: 49, backspace: 51, delete: 117, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119,
  page_up: 116, prior: 116, page_down: 121, next: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

// No implied shift: "A" is the a key, and the model asks for "shift+a" when it wants a capital.
export function parseKeyCombo(combo: string): { keyCode: number; flags: number } {
  const parts = combo.split('+');
  const key = parts.pop()!.trim();
  const modifiers = parts.map((part) => {
    const modifier = MODIFIER_NAMES[part.trim().toLowerCase()];
    if (!modifier) throw new Error(`Unknown key: ${part}`);
    return modifier;
  });
  const keyCode = KEY_CODES[key.toLowerCase()];
  if (keyCode === undefined) throw new Error(`Unknown key: ${key}`);
  return { keyCode, flags: modifierFlags(modifiers) };
}
