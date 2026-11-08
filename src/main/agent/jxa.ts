import { modifierFlags, parseKeyCombo } from './keys';
import type { InputAction } from './types';

const num = (n: number) => JSON.stringify(n);

export const ACCESSIBILITY_ERROR =
  'Accessibility is not granted to the app running npm, so clicks and keys would be dropped. See docs/agent-check.md';

// Without Accessibility, CGEventPost drops events and osascript still exits 0, so check first and fail loudly.
// osascript gets the trust of the app that launched it, the same trust its events are judged by.
export const ACCESSIBILITY_GUARD = [
  "ObjC.import('ApplicationServices');",
  `if (!$.AXIsProcessTrusted()) throw new Error(${JSON.stringify(ACCESSIBILITY_ERROR)});`,
].join('\n');

// Mouse and key events go out as CGEvents at the HID tap, so they reach whichever app is beneath the click-through overlay.
export function jxaFor(action: Exclude<InputAction, { type: 'type' }>): string {
  const lines = [ACCESSIBILITY_GUARD, "ObjC.import('CoreGraphics');"];
  const post = (event: string) => lines.push(`$.CGEventPost(0, ${event});`);
  const flagged = (event: string, flags: number) => {
    lines.push(`var e = ${event};`);
    if (flags) lines.push(`$.CGEventSetFlags(e, ${num(flags)});`);
  };
  const point = (at: { x: number; y: number } | null) => {
    lines.push(at ? `var p = {x: ${num(at.x)}, y: ${num(at.y)}};` : 'var p = $.CGEventGetLocation($.CGEventCreate(null));');
  };

  switch (action.type) {
    case 'move':
      point(action.at);
      post('$.CGEventCreateMouseEvent(null, 5, p, 0)');
      break;
    case 'click': {
      const [down, up, button] = action.button === 'right' ? [3, 4, 1] : [1, 2, 0];
      const flags = modifierFlags(action.modifiers);
      point(action.at);
      post('$.CGEventCreateMouseEvent(null, 5, p, 0)');
      lines.push('delay(0.05);');
      for (let i = 1; i <= action.count; i++) {
        for (const type of [down, up]) {
          flagged(`$.CGEventCreateMouseEvent(null, ${type}, p, ${button})`, flags);
          lines.push(`$.CGEventSetIntegerValueField(e, 1, ${i});`, '$.CGEventPost(0, e);');
        }
        if (i < action.count) lines.push('delay(0.03);');
      }
      break;
    }
    case 'scroll': {
      const { direction, amount } = action;
      const dy = direction === 'up' ? amount : direction === 'down' ? -amount : 0;
      const dx = direction === 'left' ? amount : direction === 'right' ? -amount : 0;
      if (action.at) {
        point(action.at);
        post('$.CGEventCreateMouseEvent(null, 5, p, 0)');
      }
      flagged(`$.CGEventCreateScrollWheelEvent2(null, 1, 2, ${num(dy)}, ${num(dx)}, 0)`, modifierFlags(action.modifiers));
      lines.push('$.CGEventPost(0, e);');
      break;
    }
    case 'key': {
      const { keyCode, flags } = parseKeyCombo(action.keys);
      for (let i = 0; i < action.repeat; i++) {
        for (const isDown of [true, false]) {
          flagged(`$.CGEventCreateKeyboardEvent(null, ${num(keyCode)}, ${isDown})`, flags);
          lines.push('$.CGEventPost(0, e);');
        }
        lines.push('delay(0.02);');
      }
      break;
    }
  }
  return lines.join('\n');
}
