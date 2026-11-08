import { describe, expect, it } from 'vitest';
import { toComputerAction } from './actions';
import { fitScreenshot } from './frame';

const frame = fitScreenshot({ x: 0, y: 0, width: 1470, height: 956 }, 1280);
const act = (name: string, input: unknown) => toComputerAction(name, input, frame);

describe('toComputerAction', () => {
  it('scales click coordinates from the screenshot to screen points', () => {
    expect(act('left_click', { coordinate: [640, 416] })).toEqual({
      type: 'click',
      at: { x: 735, y: 478 },
      button: 'left',
      count: 1,
      modifiers: [],
    });
  });

  it('maps every click member', () => {
    const c = [10, 10];
    expect(act('right_click', { coordinate: c })).toMatchObject({ button: 'right', count: 1 });
    expect(act('double_click', { coordinate: c })).toMatchObject({ button: 'left', count: 2 });
    expect(act('triple_click', { coordinate: c })).toMatchObject({ button: 'left', count: 3 });
  });

  it('clicks at the cursor without a coordinate and normalizes modifiers', () => {
    expect(act('left_click', {})).toMatchObject({ at: null, modifiers: [] });
    expect(act('left_click', { text: 'Shift+Super' })).toMatchObject({ modifiers: ['shift', 'cmd'] });
  });

  it('adds the frame origin of a second display', () => {
    const second = { x: 1470, y: 0, width: 1470, height: 956, imageWidth: 1470, imageHeight: 956 };
    expect(toComputerAction('mouse_move', { coordinate: [10, 20] }, second)).toEqual({ type: 'move', at: { x: 1480, y: 20 } });
  });

  it('moves, requiring a coordinate', () => {
    expect(act('mouse_move', { coordinate: [0, 0] })).toEqual({ type: 'move', at: { x: 0, y: 0 } });
    expect(() => act('mouse_move', {})).toThrow('coordinate is required');
  });

  it('scrolls', () => {
    expect(act('scroll', { coordinate: [640, 416], scroll_direction: 'down', scroll_amount: 3, text: 'ctrl' })).toEqual({
      type: 'scroll',
      at: { x: 735, y: 478 },
      direction: 'down',
      amount: 3,
      modifiers: ['ctrl'],
    });
    expect(act('scroll', { scroll_direction: 'up', scroll_amount: 1 })).toMatchObject({ at: null });
    expect(() => act('scroll', { scroll_direction: 'sideways', scroll_amount: 1 })).toThrow('scroll_direction');
    expect(() => act('scroll', { scroll_direction: 'up', scroll_amount: 0 })).toThrow('scroll_amount');
  });

  it('types and presses keys', () => {
    expect(act('type', { text: 'hello' })).toEqual({ type: 'type', text: 'hello' });
    expect(act('type', { text: '' })).toEqual({ type: 'type', text: '' });
    expect(() => act('type', {})).toThrow('text');
    expect(act('key', { text: 'cmd+l' })).toEqual({ type: 'key', keys: 'cmd+l', repeat: 1 });
    expect(act('key', { text: 'Down', repeat: 5 })).toEqual({ type: 'key', keys: 'Down', repeat: 5 });
    expect(() => act('key', { text: 'a', repeat: 101 })).toThrow('repeat');
    expect(() => act('key', { repeat: 2 })).toThrow('text');
  });

  it('waits in ms, capped', () => {
    expect(act('wait', { duration: 1.5 })).toEqual({ type: 'wait', ms: 1500 });
    expect(act('wait', { duration: 60 })).toEqual({ type: 'wait', ms: 10_000 });
  });

  it('takes screenshots', () => {
    expect(act('screenshot', {})).toEqual({ type: 'screenshot' });
  });

  it('rejects unknown members, bad inputs and unknown modifiers', () => {
    expect(() => act('zoom', {})).toThrow('Unsupported computer action: zoom');
    expect(() => act('left_click', 'nope')).toThrow('object');
    expect(() => act('left_click', { coordinate: [1] })).toThrow('[x, y]');
    expect(() => act('left_click', { coordinate: ['a', 2] })).toThrow('number');
    expect(() => act('left_click', { text: 'hyper' })).toThrow('Unknown modifier: hyper');
  });
});
