import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClaudeCode, type ClaudeCodeDeps } from './claude-code';
import { STOPPED_ERROR, type InputAction, type ScreenFrame } from './types';

const frame: ScreenFrame = { x: 0, y: 0, width: 1000, height: 500, imageWidth: 1000, imageHeight: 500 };
const options = { goal: 'Do it', model: 'm', effort: 'low' as const, maxSteps: 5 };

let dir: string;
let path: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oculus-claude-'));
  path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
});
afterEach(async () => {
  process.env.PATH = path;
  await rm(dir, { recursive: true, force: true });
});

const fakeClaude = async (script: string) => {
  const file = join(dir, 'claude');
  await writeFile(file, script);
  await chmod(file, 0o755);
};

function setup(signal: AbortSignal, over: Partial<ClaudeCodeDeps> = {}) {
  const executed: InputAction[] = [];
  const deps: ClaudeCodeDeps = {
    capture: async () => ({ png: Buffer.alloc(0), frame, savedTo: join(dir, 'shot.png') }),
    execute: async (action) => void executed.push(action),
    log: () => {},
    sleep: async () => {},
    now: Date.now,
    hands: '/hands.mjs',
    cwd: dir,
    signal,
    ...over,
  };
  return { deps, executed };
}

describe('runClaudeCode abort', () => {
  it('kills the child and reports STOPPED_ERROR', async () => {
    await fakeClaude('#!/bin/sh\nsleep 30\n');
    const controller = new AbortController();
    const { deps } = setup(controller.signal);
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    const result = await runClaudeCode(options, deps);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.error).toBe(STOPPED_ERROR);
    expect(result.ok).toBe(false);
  });

  it('does not spawn when already aborted', async () => {
    await fakeClaude(`#!/bin/sh\ntouch ${join(dir, 'spawned')}\n`);
    const controller = new AbortController();
    controller.abort();
    const result = await runClaudeCode(options, setup(controller.signal).deps);
    expect(result.error).toBe(STOPPED_ERROR);
    await expect(readFile(join(dir, 'spawned'))).rejects.toThrow();
  });

  it('times out with timeoutMs', async () => {
    await fakeClaude('#!/bin/sh\nsleep 30\n');
    const started = Date.now();
    const result = await runClaudeCode(options, setup(new AbortController().signal, { timeoutMs: 200 }).deps);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Timed out after 0 s');
  });

  it('refuses hands actions after the abort', async () => {
    const reply = join(dir, 'reply.json');
    await fakeClaude(`#!/usr/bin/env node
// Survives SIGTERM, so the server's own refusal is what stops the click.
process.on('SIGTERM', () => {});
setTimeout(async () => {
  const response = await fetch(process.env.OCULUS_HANDS_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.OCULUS_HANDS_TOKEN },
    body: JSON.stringify({ name: 'left_click', input: { coordinate: [10, 10] } }),
  });
  require('node:fs').writeFileSync(${JSON.stringify(reply)}, await response.text());
  console.log(JSON.stringify({ result: 'Done: x', subtype: 'success' }));
}, 700);
`);
    const controller = new AbortController();
    const { deps, executed } = setup(controller.signal);
    // After node started and installed its SIGTERM handler.
    setTimeout(() => controller.abort(), 400);
    const result = await runClaudeCode(options, deps);
    expect(result.error).toBe(STOPPED_ERROR);
    expect(executed).toHaveLength(0);
    expect(JSON.parse(await readFile(reply, 'utf8'))).toEqual({ ok: false, error: STOPPED_ERROR });
  });
});
