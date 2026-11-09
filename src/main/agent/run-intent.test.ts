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

describe('intentGoal with a Chrome element', () => {
  it('names the element the Gaze Scan chose, in screenshot pixels', () => {
    const goal = intentGoal({ ...run, intent: 'Open this video', element: { name: 'Lo-fi beats', rect: { x: 400, y: 300, width: 160, height: 90 } } });
    expect(goal).toContain('They chose the element "Lo-fi beats" at (320, 240), 128 x 72 pixels.');
  });

  it('says nothing about an element when none was chosen', () => {
    expect(intentGoal(run)).not.toContain('chose the element');
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
    changedPixels: () => 10_000,
    screenText: async () => 'The end.',
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

  // Live, the agent typed into a page margin, nothing appeared, and it still said "Done". On a page that takes no typing,
  // a leading space scrolled it, so the screen changed even though no text landed: the words are what count.
  const TYPED = 'Trees make every street cooler and calmer.';
  const typeOnce = async (_options: unknown, d: { execute: RunIntentDeps['execute'] }) => {
    await d.execute({ type: 'type', text: TYPED });
    return result({ finalText: 'Done: added a paragraph.' });
  };

  it.each(['claude-code', 'api'] as const)('fails a %s run whose typed words never show up, whatever the agent says', async (backend) => {
    const errors: string[] = [];
    const steps = async (_options: unknown, d: { execute: RunIntentDeps['execute'] }) => {
      await d.execute({ type: 'type', text: TYPED }).catch((cause: Error) => errors.push(cause.message));
      return result({ finalText: 'Done: added a paragraph.' });
    };
    let looks = 0;
    const screenText = async () => (looks++, 'Why Cities Should Plant More Trees\nWalk down any street');
    const { deps } = setup({ screenText, backends: { 'claude-code': steps, api: steps } });
    const outcome = await runIntent(run, { ...config, backend }, deps);
    expect(looks).toBe(3);
    expect(errors).toEqual(["The typed text didn't show up on screen. Take a screenshot: if it isn't there, click into the text and type it again."]);
    expect(outcome).toMatchObject({ ok: false, stopped: false, summary: "The typed text didn't show up on screen" });
  });

  // A false miss would make the agent type the paragraph twice, so one misread word mustn't fail it.
  it('finds the typed words across line breaks and one misread word', async () => {
    const { deps } = setup({ screenText: async () => 'Walk down any street.\nTrees make every street cooIer and\ncalmer.', backends: { 'claude-code': typeOnce } });
    expect(await runIntent(run, config, deps)).toMatchObject({ ok: true, summary: 'added a paragraph.' });
  });

  // Live in Google Docs, the last words of a 500-character paragraph weren't drawn yet when the first look came.
  it('looks again while a slow app is still drawing the typed words', async () => {
    const texts = ['Walk down any street.', 'Walk down any street. Trees make', `Walk down any street. ${TYPED}`];
    const waits: number[] = [];
    const { deps } = setup({ screenText: async () => texts.shift()!, sleep: async (ms) => void waits.push(ms), backends: { 'claude-code': typeOnce } });
    expect(await runIntent(run, config, deps)).toMatchObject({ ok: true, summary: 'added a paragraph.' });
    expect(waits).toEqual([1000, 1000]);
  });

  it('skips the check when the screen text cannot be read', async () => {
    const { deps, logs } = setup({ screenText: async () => null, backends: { 'claude-code': typeOnce } });
    expect(await runIntent(run, config, deps)).toMatchObject({ ok: true });
    expect(logs).toContain('[intent-run] typing check skipped: could not read the screen text');
  });

  it('passes a run that typed again after a miss and the text showed up', async () => {
    const texts = ['', '', '', TYPED];
    const steps = async (_options: unknown, d: { execute: RunIntentDeps['execute'] }) => {
      await d.execute({ type: 'type', text: TYPED }).catch(() => {});
      await d.execute({ type: 'type', text: TYPED });
      return result({ finalText: 'Done: added a paragraph.' });
    };
    const { deps } = setup({ screenText: async () => texts.shift()!, backends: { 'claude-code': steps } });
    expect(await runIntent(run, config, deps)).toMatchObject({ ok: true, summary: 'added a paragraph.' });
  });

  it('fails a run that says Done when the screen at the end is the same as at the start', async () => {
    const steps = async (_options: unknown, d: { capture: RunIntentDeps['capture']; execute: RunIntentDeps['execute'] }) => {
      await d.capture();
      await d.execute({ type: 'click', at: { x: 1, y: 2 }, button: 'left', count: 1, modifiers: [] });
      return result({ finalText: 'Done: opened the video.' });
    };
    const { deps } = setup({ changedPixels: () => 3, backends: { 'claude-code': steps } });
    expect(await runIntent(run, config, deps)).toMatchObject({ ok: false, stopped: false, summary: 'Nothing changed on screen' });
  });

  // The model's turn after each input takes most of the run, so the overlay mustn't keep showing the input.
  it.each(['claude-code', 'api'] as const)('reports each screenshot and input of the %s backend, and thinking after each input', async (backend) => {
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
    expect(activities).toEqual([
      'Looking at the screen',
      'Clicking',
      'Thinking',
      'Pressing cmd+down',
      'Thinking',
      'Typing',
      'Thinking',
      'Scrolling',
      'Thinking',
    ]);
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
