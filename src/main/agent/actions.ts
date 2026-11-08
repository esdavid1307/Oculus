import { toScreenPoint } from './frame';
import { MODIFIER_NAMES, type ComputerAction, type Modifier, type Point, type ScreenFrame, type ScrollDirection } from './types';

// shortcut: a wait longer than this is cut short, the run has a latency budget.
const MAX_WAIT_MS = 10_000;
const DIRECTIONS: readonly string[] = ['up', 'down', 'left', 'right'];
const CLICKS = {
  left_click: { button: 'left', count: 1 },
  right_click: { button: 'right', count: 1 },
  double_click: { button: 'left', count: 2 },
  triple_click: { button: 'left', count: 3 },
} as const;

function fields(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Input must be an object');
  return input as Record<string, unknown>;
}

function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  const n = number(value, name);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

function point(input: Record<string, unknown>, frame: ScreenFrame, required: true): Point;
function point(input: Record<string, unknown>, frame: ScreenFrame, required: false): Point | null;
function point(input: Record<string, unknown>, frame: ScreenFrame, required: boolean): Point | null {
  const value = input.coordinate;
  if (value == null) {
    if (required) throw new Error('coordinate is required');
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2) throw new Error('coordinate must be [x, y]');
  return toScreenPoint(frame, [number(value[0], 'coordinate x'), number(value[1], 'coordinate y')]);
}

// "shift+ctrl" held during a click or scroll, carried in `text`.
function modifiers(value: unknown): Modifier[] {
  if (value == null || value === '') return [];
  if (typeof value !== 'string') throw new Error('text must be a string');
  return value.split('+').map((part) => {
    const modifier = MODIFIER_NAMES[part.trim().toLowerCase()];
    if (!modifier) throw new Error(`Unknown modifier: ${part}`);
    return modifier;
  });
}

// name is the tool_use block's member name. Throws an Error the model can read.
export function toComputerAction(name: string, input: unknown, frame: ScreenFrame): ComputerAction {
  const args = fields(input);
  switch (name) {
    case 'left_click':
    case 'right_click':
    case 'double_click':
    case 'triple_click':
      return { type: 'click', at: point(args, frame, false), ...CLICKS[name], modifiers: modifiers(args.text) };
    case 'mouse_move':
      return { type: 'move', at: point(args, frame, true) };
    case 'scroll': {
      const direction = args.scroll_direction;
      if (typeof direction !== 'string' || !DIRECTIONS.includes(direction)) throw new Error('scroll_direction must be up, down, left or right');
      return {
        type: 'scroll',
        at: point(args, frame, false),
        direction: direction as ScrollDirection,
        amount: integer(args.scroll_amount, 'scroll_amount', 1, Number.MAX_SAFE_INTEGER),
        modifiers: modifiers(args.text),
      };
    }
    case 'type':
      if (typeof args.text !== 'string') throw new Error('text must be a string');
      return { type: 'type', text: args.text };
    case 'key':
      if (typeof args.text !== 'string' || args.text === '') throw new Error('text must be a key combination');
      return { type: 'key', keys: args.text, repeat: integer(args.repeat ?? 1, 'repeat', 1, 100) };
    case 'wait':
      return { type: 'wait', ms: Math.min(Math.max(number(args.duration, 'duration'), 0) * 1000, MAX_WAIT_MS) };
    case 'screenshot':
      return { type: 'screenshot' };
    default:
      throw new Error(`Unsupported computer action: ${name}`);
  }
}
