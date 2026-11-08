import Anthropic from '@anthropic-ai/sdk';
import { toComputerAction } from './actions';
import { buildRequest, firstMessage } from './request';
import {
  COMPUTER_TOOLSET_NAME,
  HALT_TEXT,
  LOG_PREFIX,
  type ActionRecord,
  type AgentCheckResult,
  type AgentDeps,
  type AgentRunOptions,
  type ComputerAction,
  type ModelCall,
  type ScreenFrame,
} from './types';

// The page needs a moment to react to the last input before the model looks at it again.
const SETTLE_MS = 500;
const round = (n: number) => Math.round(n);

function describe(action: ComputerAction | null): string {
  if (!action) return 'not run';
  const at = (p: { x: number; y: number } | null) => (p ? `(${round(p.x)}, ${round(p.y)})` : 'the cursor');
  switch (action.type) {
    case 'click':
      return `${action.button} click x${action.count} at ${at(action.at)}`;
    case 'move':
      return `move to ${at(action.at)}`;
    case 'scroll':
      return `scroll ${action.direction} ${action.amount} at ${at(action.at)}`;
    case 'type':
      return `type ${action.text.length} chars`;
    case 'key':
      return `key ${action.keys} x${action.repeat}`;
    case 'wait':
      return `wait ${action.ms} ms`;
    case 'screenshot':
      return 'screenshot';
  }
}

export async function runAgentCheck(options: AgentRunOptions, deps: AgentDeps): Promise<AgentCheckResult> {
  const { goal, model, effort, maxSteps } = options;
  const { log } = deps;
  const calls: ModelCall[] = [];
  const actions: ActionRecord[] = [];
  const screenshots: string[] = [];
  let finalText = '';
  let error: string | null = null;

  const capture = async () => {
    const shot = await deps.capture();
    if (shot.savedTo) screenshots.push(shot.savedTo);
    return shot;
  };

  try {
    log(`${LOG_PREFIX} goal: "${goal}" model=${model} effort=${effort} max_steps=${maxSteps}`);
    const first = await capture();
    let frame: ScreenFrame = first.frame;
    // Append-only: earlier turns are never pruned or rewritten.
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [firstMessage(goal, first)];
    let lastWasInput = false;

    for (let step = 1; step <= maxSteps; step++) {
      const started = deps.now();
      const response = await deps.messages.create(buildRequest({ model, effort }, messages));
      const ms = deps.now() - started;
      const toolUses = response.content.filter((block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === 'tool_use');
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ').trim();
      calls.push({
        step,
        ms,
        stopReason: response.stop_reason,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        toolCalls: toolUses.map((block) => block.name),
        text,
      });
      log(
        `${LOG_PREFIX} model call ${step}: ${ms} ms (model=${response.model}, stop_reason=${response.stop_reason}, ` +
          `input_tokens=${response.usage.input_tokens}, output_tokens=${response.usage.output_tokens}, ` +
          `tools=${toolUses.map((block) => block.name).join(',') || 'none'})`,
      );
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });

      if (response.stop_reason === 'refusal') {
        error = `refused: ${response.stop_details?.category}`;
        break;
      }
      if (response.stop_reason === 'max_tokens') {
        error = 'stopped at max_tokens';
        break;
      }
      if (toolUses.length === 0) {
        finalText = text;
        break;
      }

      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      let halted = false;
      for (const [i, block] of toolUses.entries()) {
        const result = (content: Anthropic.Beta.Messages.BetaToolResultBlockParam['content'], isError = false): Anthropic.Beta.Messages.BetaToolResultBlockParam => ({
          type: 'tool_result',
          tool_use_id: block.id,
          toolset_name: COMPUTER_TOOLSET_NAME,
          content,
          ...(isError && { is_error: true }),
        });
        const record: ActionRecord = { step, name: block.name, input: block.input, action: null, ok: false, error: null };
        actions.push(record);
        if (halted) {
          record.error = HALT_TEXT;
          results.push(result(HALT_TEXT, true));
          log(`${LOG_PREFIX} action ${step}.${i} ${block.name} ${JSON.stringify(block.input)} -> not run error: ${HALT_TEXT}`);
          continue;
        }
        try {
          if (block.toolset_name !== COMPUTER_TOOLSET_NAME) throw new Error(`Unsupported toolset: ${block.toolset_name}`);
          const action = toComputerAction(block.name, block.input, frame);
          record.action = action;
          if (action.type === 'screenshot') {
            if (lastWasInput) await deps.sleep(SETTLE_MS);
            const shot = await capture();
            frame = shot.frame;
            lastWasInput = false;
            results.push(result([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.png.toString('base64') } }]));
          } else if (action.type === 'wait') {
            await deps.sleep(action.ms);
            lastWasInput = false;
            results.push(result('OK'));
          } else {
            await deps.execute(action);
            lastWasInput = true;
            results.push(result('OK'));
          }
          record.ok = true;
          log(`${LOG_PREFIX} action ${step}.${i} ${block.name} ${JSON.stringify(block.input)} -> ${describe(action)} ok`);
        } catch (cause) {
          halted = true;
          record.error = cause instanceof Error ? cause.message : String(cause);
          results.push(result(`Error: ${record.error}`, true));
          log(`${LOG_PREFIX} action ${step}.${i} ${block.name} ${JSON.stringify(block.input)} -> ${describe(record.action)} error: ${record.error}`);
        }
      }
      messages.push({ role: 'user', content: results });
      if (step === maxSteps) log(`${LOG_PREFIX} max steps reached`);
    }
  } catch (cause) {
    if (cause instanceof Anthropic.APIError) error = `API ${cause.status}: ${cause.message}`;
    else error = cause instanceof Error ? cause.message : String(cause);
  }

  const ok = error === null && actions.some((a) => a.ok && a.action && a.action.type !== 'screenshot' && a.action.type !== 'wait');
  const totalMs = calls.reduce((sum, call) => sum + call.ms, 0);
  log(
    `${LOG_PREFIX} done ok=${ok} calls=${calls.length} first_call_ms=${calls[0]?.ms ?? 0} total_model_ms=${totalMs} ` +
      `actions=${actions.map((a) => a.name).join(',') || 'none'}${error ? ` error=${error}` : ''}`,
  );
  return { ok, goal, model, calls, actions, screenshots, finalText, error };
}
