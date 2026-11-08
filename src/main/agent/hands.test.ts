import { describe, expect, it, vi } from 'vitest';
import { claudeArgs } from './claude-code';
import { createHands } from './hands';
import type { InputAction, ScreenFrame, Screenshot } from './types';

const frame: ScreenFrame = { x: 0, y: 0, width: 1470, height: 956, imageWidth: 1280, imageHeight: 832 };
const shot = (n: number): Screenshot => ({ png: Buffer.from([]), frame, savedTo: `/runs/shot-${n}.png` });

const setup = (execute = vi.fn(async (_action: InputAction) => {})) => {
  let n = 1;
  const sleep = vi.fn(async (_ms: number) => {});
  const hands = createHands(shot(1), { capture: async () => shot(++n), execute, sleep, log: () => {} });
  return { hands, execute, sleep };
};

describe('hands', () => {
  it('clicks in screen points, scaled from screenshot pixels', async () => {
    const { hands, execute } = setup();
    expect(await hands.handle('left_click', { coordinate: [640, 416] })).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({ type: 'click', at: { x: 735, y: 478 }, button: 'left', count: 1, modifiers: [] });
  });

  it('returns the saved screenshot, after letting the page settle from the last input', async () => {
    const { hands, sleep } = setup();
    await hands.handle('key', { text: 'Return' });
    expect(await hands.handle('screenshot', {})).toEqual({ ok: true, screenshot: '/runs/shot-2.png', width: 1280, height: 832 });
    expect(sleep).toHaveBeenCalledWith(500);
    expect(hands.screenshots).toEqual(['/runs/shot-1.png', '/runs/shot-2.png']);
  });

  it('reports a failed or unknown action as an error the model can read', async () => {
    const { hands } = setup(vi.fn(async () => Promise.reject(new Error('Accessibility is not granted'))));
    expect(await hands.handle('type', { text: 'hi' })).toEqual({ ok: false, error: 'Accessibility is not granted' });
    expect(await hands.handle('zoom', {})).toMatchObject({ ok: false });
    expect(hands.actions.map(({ name, ok }) => [name, ok])).toEqual([['type', false], ['zoom', false]]);
  });
});

describe('claudeArgs', () => {
  const args = claudeArgs({ goal: 'Open example.com', model: 'claude-sonnet-5-5', effort: 'low' }, '/repo/scripts/oculus-hands.mjs', '/runs/shot-1.png', 1280, 832);
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it('runs headless with the goal and the first screenshot', () => {
    expect(args[0]).toBe('-p');
    expect(args[1]).toContain('Open example.com');
    expect(args[1]).toContain('/runs/shot-1.png');
    expect(after('--output-format')).toBe('json');
    expect(after('--model')).toBe('claude-sonnet-5-5');
    expect(after('--effort')).toBe('low');
  });

  it('allows only the hands script and Read, and keeps the user settings and MCP servers out', () => {
    expect(after('--allowedTools')).toBe('Bash(node /repo/scripts/oculus-hands.mjs:*)');
    expect(args).toEqual(expect.arrayContaining(['WebFetch', 'Write', '--strict-mcp-config']));
    expect(after('--setting-sources')).toBe('project');
  });
});
