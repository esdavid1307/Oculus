import { toComputerAction } from './actions';
import { LOG_PREFIX, type ActionRecord, type Capture, type Execute, type ScreenFrame, type Screenshot } from './types';

// The page needs a moment to react to the last input before the next screenshot.
const SETTLE_MS = 500;

export type HandsReply = { ok: true; screenshot?: string; width?: number; height?: number } | { ok: false; error: string };

type HandsDeps = { capture: Capture; execute: Execute; sleep: (ms: number) => Promise<void>; log: (line: string) => void };

// The only way the background Claude Code touches the computer: the same computer use member names,
// in screenshot pixels, through the overlay-hiding capture and the Accessibility-checked executor.
export function createHands(first: Screenshot, { capture, execute, sleep, log }: HandsDeps) {
  let frame: ScreenFrame = first.frame;
  let lastWasInput = false;
  const actions: ActionRecord[] = [];
  const screenshots: string[] = first.savedTo ? [first.savedTo] : [];

  async function handle(name: string, input: unknown): Promise<HandsReply> {
    const record: ActionRecord = { step: actions.length + 1, name, input, action: null, ok: false, error: null };
    actions.push(record);
    try {
      const action = toComputerAction(name, input ?? {}, frame);
      record.action = action;
      let reply: HandsReply = { ok: true };
      if (action.type === 'screenshot') {
        if (lastWasInput) await sleep(SETTLE_MS);
        const shot = await capture();
        frame = shot.frame;
        if (!shot.savedTo) throw new Error('Screenshot was not saved');
        screenshots.push(shot.savedTo);
        reply = { ok: true, screenshot: shot.savedTo, width: frame.imageWidth, height: frame.imageHeight };
      } else if (action.type === 'wait') {
        await sleep(action.ms);
      } else {
        await execute(action);
      }
      lastWasInput = action.type !== 'screenshot' && action.type !== 'wait';
      record.ok = true;
      log(`${LOG_PREFIX} action ${record.step} ${name} ${JSON.stringify(input)} ok`);
      return reply;
    } catch (cause) {
      record.error = cause instanceof Error ? cause.message : String(cause);
      log(`${LOG_PREFIX} action ${record.step} ${name} ${JSON.stringify(input)} error: ${record.error}`);
      return { ok: false, error: record.error };
    }
  }

  return { handle, actions, screenshots };
}
