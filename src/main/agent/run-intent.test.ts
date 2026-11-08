import { describe, expect, it } from 'vitest';
import { INTENT_MIN_STEPS, INTENT_TIMEOUT_MS, SUMMARY_MAX_CHARS, intentGoal, readOutcome, runIntent, type IntentRun, type RunIntentDeps } from './run-intent';
import { STOPPED_ERROR, type AgentCheckResult, type AgentConfig, type ScreenFrame } from './types';

const frame: ScreenFrame = { x: 0, y: 0, width: 1600, height: 1000, imageWidth: 1280, imageHeight: 800 };
const run: IntentRun = { intent: 'Skip the ad', region: { x: 800, y: 250, radius: 120 }, request: 7, frame };
const config: AgentConfig = {
  goal: '',
  backend: 'claude-code',
  model: 'claude-sonnet-5-5',
  effort: 'low',
  maxSteps: 5,
  showOverlayInShots: false,
  quitWhenDone: false,
};

const result = (over: Partial<AgentCheckResult> = {}): AgentCheckResult => ({
  ok: true,
  goal: '',
  model: 'm',
  calls: [],
  actions: [],
  screenshots: [],
  finalText: 'Done: skipped',
  error: null,
  ...over,
});

describe('intentGoal', () => {
  it('gives the region in screenshot pixels and the rules', () => {
    const goal = intentGoal(run);
    expect(goal).toContain('"Skip the ad"');
    expect(goal).toContain('(640, 200)');
    expect(goal).toContain('96 pixels');
    expect(goal).toContain('1280 x 800 screenshot');
    expect(goal).toContain('Never sign in');
    expect(goal).toContain('"Done:"');
    expect(goal).toContain('"Failed:"');
  });
});

describe('readOutcome', () => {
  it('strips Done: and keeps ok', () => {
    expect(readOutcome(result({ finalText: 'Done: Skipped the ad.' }))).toEqual({ ok: true, stopped: false, summary: 'Skipped the ad.' });
  });
  it('treats Failed: as not ok even when actions ran', () => {
    expect(readOutcome(result({ finalText: ' failed: no skip button' }))).toEqual({ ok: false, stopped: false, summary: 'no skip button' });
  });
  it('keeps text without a prefix, and falls back when empty', () => {
    expect(readOutcome(result({ finalText: 'Clicked it' })).summary).toBe('Clicked it');
    expect(readOutcome(result({ finalText: '' })).summary).toBe('Done');
    expect(readOutcome(result({ ok: false, finalText: '' })).summary).toBe('Failed');
    expect(readOutcome(result({ ok: false, finalText: 'Done: x' })).ok).toBe(false);
  });
  it('reads a stop and other errors', () => {
    expect(readOutcome(result({ ok: false, error: STOPPED_ERROR }))).toEqual({ ok: false, stopped: true, summary: 'Stopped' });
    expect(readOutcome(result({ ok: false, error: 'boom' }))).toEqual({ ok: false, stopped: false, summary: 'boom' });
  });
  it('truncates long summaries', () => {
    const { summary } = readOutcome(result({ finalText: `Done: ${'a'.repeat(200)}` }));
    expect(summary).toHaveLength(SUMMARY_MAX_CHARS);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.slice(0, -1)).toBe('a'.repeat(SUMMARY_MAX_CHARS - 1));
  });
});

function setup(over: Partial<RunIntentDeps> = {}) {
  const logs: string[] = [];
  const calls: Array<{ api: boolean; options: any; deps: any }> = [];
  let t = 1000;
  const deps: RunIntentDeps = {
    capture: async () => ({ png: Buffer.alloc(0), frame, savedTo: '/s.png' }),
    execute: async () => {},
    log: (line) => logs.push(line),
    sleep: async () => {},
    now: () => (t += 250),
    hands: '/hands.mjs',
    cwd: '/cwd',
    messages: () => ({ create: async () => ({}) as never }),
    signal: new AbortController().signal,
    onActivity: () => {},
    backends: {
      'claude-code': async (options, d) => (calls.push({ api: false, options, deps: d }), result()),
      api: async (options, d) => (calls.push({ api: true, options, deps: d }), result({ finalText: 'Done: via api' })),
    },
    ...over,
  };
  return { deps, logs, calls };
}

describe('runIntent', () => {
  it('runs claude-code with the signal, timeout and at least the minimum steps', async () => {
    const { deps, calls, logs } = setup();
    const outcome = await runIntent(run, config, deps);
    expect(outcome).toEqual({ ok: true, stopped: false, summary: 'skipped', ms: 250 });
    expect(calls).toHaveLength(1);
    expect(calls[0].api).toBe(false);
    expect(calls[0].options).toEqual({ goal: intentGoal(run), model: config.model, effort: 'low', maxSteps: INTENT_MIN_STEPS });
    expect(calls[0].deps).toMatchObject({ signal: deps.signal, timeoutMs: INTENT_TIMEOUT_MS, hands: '/hands.mjs', cwd: '/cwd' });
    expect(logs.filter((l) => l.startsWith('[intent-run] done'))).toEqual([
      '[intent-run] done request=7 ok=true stopped=false ms=250 backend=claude-code intent="Skip the ad" summary="skipped"',
    ]);
  });

  it('runs the api backend, keeping a larger maxSteps', async () => {
    const { deps, calls } = setup();
    const outcome = await runIntent(run, { ...config, backend: 'api', maxSteps: 12 }, deps);
    expect(outcome.summary).toBe('via api');
    expect(calls[0].api).toBe(true);
    expect(calls[0].options.maxSteps).toBe(12);
    expect(calls[0].deps.signal).toBe(deps.signal);
    expect(calls[0].deps.messages).toBeDefined();
  });

  it('does not call a backend when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, calls, logs } = setup({ signal: controller.signal });
    const outcome = await runIntent(run, config, deps);
    expect(calls).toHaveLength(0);
    expect(outcome).toMatchObject({ ok: false, stopped: true, summary: 'Stopped' });
    expect(logs.at(-1)).toContain('stopped=true');
  });

  it.each(['claude-code', 'api'] as const)('reports each screenshot and input of the %s backend as an activity', async (backend) => {
    const activities: string[] = [];
    const steps = async (_options: unknown, d: { capture: RunIntentDeps['capture']; execute: RunIntentDeps['execute'] }) => {
      await d.capture();
      await d.execute({ type: 'click', at: { x: 1, y: 2 }, button: 'left', count: 1, modifiers: [] });
      await d.execute({ type: 'key', keys: 'cmd+down', repeat: 1 });
      await d.execute({ type: 'type', text: 'The end.' });
      await d.execute({ type: 'scroll', at: null, direction: 'down', amount: 3, modifiers: [] });
      return result();
    };
    const { deps } = setup({ onActivity: (activity) => activities.push(activity), backends: { 'claude-code': steps, api: steps } });
    await runIntent(run, { ...config, backend }, deps);
    expect(activities).toEqual(['Looking at the screen', 'Clicking', 'Pressing cmd+down', 'Typing', 'Scrolling']);
  });

  it('never throws when the backend throws', async () => {
    const { deps, logs } = setup({
      backends: {
        'claude-code': async () => {
          throw new Error('spawn failed');
        },
      },
    });
    await expect(runIntent(run, config, deps)).resolves.toMatchObject({ ok: false, stopped: false, summary: 'spawn failed' });
    expect(logs.at(-1)).toContain('ok=false');
  });
});
