import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { runAgentCheck } from './loop';
import { AGENT_MAX_STEPS, HALT_TEXT, STOPPED_ERROR, type AgentDeps, type InputAction, type ScreenFrame } from './types';

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const frameA: ScreenFrame = { x: 0, y: 0, width: 1470, height: 956, imageWidth: 1280, imageHeight: 832 };
const frameB: ScreenFrame = { x: 0, y: 0, width: 1000, height: 500, imageWidth: 1000, imageHeight: 500 };

const use = (id: string, name: string, input: unknown, toolset_name = 'computer') => ({ type: 'tool_use' as const, id, name, input, toolset_name });

function reply(content: unknown[], stop_reason = 'tool_use', extra: Record<string, unknown> = {}): Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...extra,
  } as unknown as Message;
}

function setup(responses: Array<Message | Error | (() => Message)>, over: Partial<AgentDeps> = {}) {
  const sent: Params[] = [];
  const executed: InputAction[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const shots = [frameA, frameB];
  let captures = 0;
  let t = 0;
  const deps: AgentDeps = {
    messages: {
      async create(params) {
        // The history array is shared across calls, so snapshot what this call saw.
        sent.push(structuredClone(params));
        const next = responses[Math.min(sent.length - 1, responses.length - 1)];
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next() : next;
      },
    },
    async capture() {
      const frame = shots[Math.min(captures, shots.length - 1)];
      return { png: Buffer.from([captures++]), frame, savedTo: `/shots/${captures}.png` };
    },
    async execute(action) {
      executed.push(action);
    },
    log: (line) => logs.push(line),
    sleep: async (ms) => void sleeps.push(ms),
    now: () => (t += 100),
    ...over,
  };
  return { deps, sent, executed, sleeps, logs };
}

const options = { goal: 'Do it', model: 'claude-sonnet-5-5', effort: 'low' as const, maxSteps: 5 };
const lastUser = (params: Params) => params.messages[params.messages.length - 1].content as unknown as Array<Record<string, unknown>>;

describe('runAgentCheck', () => {
  it('runs a batch in order and echoes toolset_name on every result', async () => {
    const { deps, sent, executed, logs } = setup([
      reply([use('a', 'left_click', { coordinate: [640, 416] }), use('b', 'type', { text: 'hi' }), use('c', 'key', { text: 'Return' })]),
      reply([{ type: 'text', text: 'Done.' }], 'end_turn'),
    ]);
    const result = await runAgentCheck(options, deps);
    expect(executed.map((a) => a.type)).toEqual(['click', 'type', 'key']);
    expect(executed[0]).toMatchObject({ at: { x: 735, y: 478 } });
    const results = lastUser(sent[1]);
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b', 'c']);
    for (const r of results) expect(r).toMatchObject({ type: 'tool_result', toolset_name: 'computer', content: 'OK' });
    expect(result).toMatchObject({ ok: true, finalText: 'Done.', error: null, screenshots: ['/shots/1.png'] });
    expect(result.actions.map((a) => a.name)).toEqual(['left_click', 'type', 'key']);
    expect(logs[0]).toBe('[agent-check] goal: "Do it" model=claude-sonnet-5-5 effort=low max_steps=5');
    expect(logs.at(-1)).toBe('[agent-check] done ok=true calls=2 first_call_ms=100 total_model_ms=200 actions=left_click,type,key');
  });

  it('halts the rest of the turn after a failure', async () => {
    const { deps, sent, executed } = setup(
      [reply([use('a', 'type', { text: 'x' }), use('b', 'zoom', {}), use('c', 'key', { text: 'Return' })]), reply([], 'end_turn')],
    );
    const result = await runAgentCheck(options, deps);
    expect(executed).toHaveLength(1);
    expect(lastUser(sent[1])).toEqual([
      { type: 'tool_result', tool_use_id: 'a', toolset_name: 'computer', content: 'OK' },
      { type: 'tool_result', tool_use_id: 'b', toolset_name: 'computer', content: 'Error: Unsupported computer action: zoom', is_error: true },
      { type: 'tool_result', tool_use_id: 'c', toolset_name: 'computer', content: HALT_TEXT, is_error: true },
    ]);
    expect(result.actions.map((a) => a.ok)).toEqual([true, false, false]);
  });

  it('halts after an execute failure and rejects a foreign toolset', async () => {
    const failing = setup([reply([use('a', 'type', { text: 'x' }), use('b', 'key', { text: 'a' })]), reply([], 'end_turn')], {
      async execute() {
        throw new Error('no permission');
      },
    });
    const r1 = await runAgentCheck(options, failing.deps);
    expect(lastUser(failing.sent[1]).map((r) => r.content)).toEqual(['Error: no permission', HALT_TEXT]);
    expect(r1.ok).toBe(false);
    const foreign = setup([reply([use('a', 'left_click', {}, 'browser')]), reply([], 'end_turn')]);
    await runAgentCheck(options, foreign.deps);
    expect(foreign.executed).toHaveLength(0);
    expect(lastUser(foreign.sent[1])[0]).toMatchObject({ is_error: true });
  });

  it('answers a screenshot member with an image and scales with the new frame', async () => {
    const { deps, sent, executed, sleeps } = setup([
      reply([use('a', 'left_click', { coordinate: [10, 10] }), use('b', 'screenshot', {}), use('c', 'left_click', { coordinate: [500, 250] })]),
      reply([], 'end_turn'),
    ]);
    const result = await runAgentCheck(options, deps);
    expect(sleeps).toEqual([500]);
    expect(lastUser(sent[1])[1]).toMatchObject({
      toolset_name: 'computer',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQ==' } }],
    });
    expect(executed[1]).toMatchObject({ at: { x: 500, y: 250 } });
    expect(result.screenshots).toHaveLength(2);
  });

  it('does not settle before a screenshot that follows no input', async () => {
    const { deps, sleeps } = setup([reply([use('a', 'screenshot', {})]), reply([], 'end_turn')]);
    await runAgentCheck(options, deps);
    expect(sleeps).toEqual([]);
  });

  it('stops on end_turn with the text', async () => {
    const { deps, sent } = setup([reply([{ type: 'text', text: 'All set.' }], 'end_turn')]);
    const result = await runAgentCheck(options, deps);
    expect(sent).toHaveLength(1);
    expect(result).toMatchObject({ finalText: 'All set.', ok: false, error: null });
  });

  // A run still acting at its last step hasn't finished, so it must not be reported as done.
  it('bounds the model calls by maxSteps, and fails when they run out', async () => {
    const { deps, sent, logs } = setup([reply([use('a', 'type', { text: 'x' })])]);
    const result = await runAgentCheck({ ...options, maxSteps: 3 }, deps);
    expect(sent).toHaveLength(3);
    expect(result).toMatchObject({ ok: false, error: 'Ran out of steps' });
    expect(logs).toContain('[agent-check] max steps reached');
    expect(AGENT_MAX_STEPS).toBe(5);
  });

  it('logs the latency measured with now()', async () => {
    let t = 0;
    const { deps, logs } = setup([reply([{ type: 'text', text: 'x' }], 'end_turn')], { now: () => (t += 250) });
    const result = await runAgentCheck(options, deps);
    expect(result.calls[0]).toMatchObject({ ms: 250, inputTokens: 10, outputTokens: 5, stopReason: 'end_turn' });
    expect(logs).toContain(
      '[agent-check] model call 1: 250 ms (model=claude-sonnet-5-5, stop_reason=end_turn, input_tokens=10, output_tokens=5, tools=none)',
    );
  });

  it('reports an API error without throwing', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    const { deps, logs } = setup([new APIError(529, undefined, 'overloaded', new Headers())]);
    const result = await runAgentCheck(options, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('API 529: 529 overloaded');
    expect(logs.at(-1)).toContain('error=API 529');
  });

  it('reports other failures and refusals', async () => {
    const boom = setup([new Error('network')]);
    expect((await runAgentCheck(options, boom.deps)).error).toBe('network');
    const refused = setup([reply([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } })]);
    expect((await runAgentCheck(options, refused.deps)).error).toBe('refused: cyber');
    const cut = setup([reply([use('a', 'type', { text: 'x' })], 'max_tokens')]);
    const result = await runAgentCheck(options, cut.deps);
    expect(result.error).toContain('max_tokens');
    expect(cut.executed).toHaveLength(0);
  });

  it('is not ok when only screenshots were taken', async () => {
    const { deps } = setup([reply([use('a', 'screenshot', {}), use('b', 'wait', { duration: 1 })]), reply([], 'end_turn')]);
    const result = await runAgentCheck(options, deps);
    expect(result.actions.every((a) => a.ok)).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('only appends to the history', async () => {
    const { deps, sent } = setup([
      reply([use('a', 'type', { text: 'x' })]),
      reply([use('b', 'key', { text: 'a' })]),
      reply([], 'end_turn'),
    ]);
    await runAgentCheck(options, deps);
    expect(sent.map((p) => p.messages.length)).toEqual([1, 3, 5]);
    expect(sent[2].messages.slice(0, 1)).toEqual(sent[0].messages);
    expect(sent[2].messages.slice(0, 3)).toEqual(sent[1].messages);
  });

  it('stops with STOPPED_ERROR when aborted between calls, with no further create or execute', async () => {
    const controller = new AbortController();
    const { deps, sent, executed } = setup(
      [reply([use('a', 'left_click', { coordinate: [10, 10] })]), reply([use('b', 'left_click', { coordinate: [20, 20] })])],
      { signal: controller.signal },
    );
    const execute = deps.execute;
    deps.execute = async (action) => {
      await execute(action);
      controller.abort();
    };
    const result = await runAgentCheck(options, deps);
    expect(result.error).toBe(STOPPED_ERROR);
    expect(sent).toHaveLength(1);
    expect(executed).toHaveLength(1);
  });

  it('stops before an action when aborted during a model call, and passes the signal', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const { deps, executed } = setup([() => (controller.abort(), reply([use('a', 'left_click', { coordinate: [10, 10] })]))], { signal: controller.signal });
    const create = deps.messages.create;
    deps.messages.create = (params, opts) => ((received = opts?.signal), create(params, opts));
    const result = await runAgentCheck(options, deps);
    expect(received).toBe(controller.signal);
    expect(executed).toHaveLength(0);
    expect(result.error).toBe(STOPPED_ERROR);
  });

  it('maps an abort error from the SDK to STOPPED_ERROR', async () => {
    const controller = new AbortController();
    const { deps } = setup([new Error('Request was aborted.')], { signal: controller.signal });
    controller.abort();
    const result = await runAgentCheck(options, deps);
    expect(result.error).toBe(STOPPED_ERROR);
  });
});
