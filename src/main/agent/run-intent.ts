import type { GazeRegion } from '../../shared/gaze';
import type { ElementHint } from '../../shared/session';
import { elementHint } from './intents';
import { runClaudeCode } from './claude-code';
import { runAgentCheck } from './loop';
import {
  STOPPED_ERROR,
  type AgentCheckResult,
  type AgentConfig,
  type Capture,
  type Execute,
  type InputAction,
  type MessagesApi,
  type ScreenFrame,
  type Screenshot,
} from './types';

// Running one chosen Suggested Intent for real (#14, and the base #10 builds on). No electron imports, so tests can load it.

export const RUN_LOG_PREFIX = '[intent-run]';
// A whole run on the Claude Code backend, several turns. Shorter than the agent check: one Intent is a few clicks.
export const INTENT_TIMEOUT_MS = 90_000;
// Model calls on the API backend: act, check with a screenshot, finish, with room for one retry.
export const INTENT_MIN_STEPS = 8;
// The longest summary the overlay shows.
export const SUMMARY_MAX_CHARS = 80;
// Fewer changed screenshot pixels than this between a run's first and last screenshot is no change: a blinking text
// caret is about 15.
// shortcut: a run whose only effect is a few pixels (a tiny toggle) reads as unchanged, lower it if one shows up.
const MIN_CHANGED_PIXELS = 100;
// Google Docs draws a 500-character paragraph well after the keystrokes are sent, so the check looks a few times.
const TYPING_LOOKS = 3;
const TYPING_LOOK_GAP_MS = 1000;
const TYPED_NOWHERE = "The typed text didn't show up on screen";
const NOTHING_CHANGED = 'Nothing changed on screen';

export type IntentRun = {
  intent: string;
  // The target the Intent was suggested for, in overlay (display) points, the space of GazeRegion.
  region: GazeRegion;
  request: number;
  // Where the screenshots the agent sees sit on screen, so the goal can give the region in screenshot pixels.
  frame: ScreenFrame;
  // The Chrome element a Gaze Scan chose, if any.
  element?: ElementHint;
};

export type IntentOutcome = {
  ok: boolean;
  // True when the Stop Gesture cut the run short.
  stopped: boolean;
  // One short sentence for the overlay, at most SUMMARY_MAX_CHARS.
  summary: string;
  ms: number;
  // Where the agent first clicked, in screen points, even in a run that failed. Only a run that went well uses it, as
  // what the user meant by "this".
  firstClick?: { x: number; y: number };
};

export type RunIntentDeps = {
  capture: Capture;
  execute: Execute;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  // Absolute path to scripts/oculus-hands.mjs, and the run's working directory. Claude Code backend only.
  hands: string;
  cwd: string;
  // Only called on the API backend, so a Claude Code run never needs ANTHROPIC_API_KEY.
  messages: () => MessagesApi;
  signal: AbortSignal;
  // Each screenshot and input in a few words, such as "Typing", so the overlay shows what the agent is doing.
  onActivity: (activity: string) => void;
  // How many pixels differ between two screenshots of the same size, so "Done" is checked against the screen.
  changedPixels: (a: Buffer, b: Buffer) => number;
  // The text readable in a screenshot, or null when it can't be read, so typing is checked against the screen.
  screenText: (shot: Screenshot) => Promise<string | null>;
  // Injected so tests swap the backends for fakes; defaults are runClaudeCode and runAgentCheck.
  backends?: { 'claude-code'?: typeof runClaudeCode; api?: typeof runAgentCheck };
};

// The goal the run agent gets: the Intent, where the user was looking in screenshot pixels, and tight bounds.
export function intentGoal(run: Pick<IntentRun, 'intent' | 'region' | 'frame' | 'element'>): string {
  const { intent, region, frame, element } = run;
  const scale = frame.imageWidth / frame.width;
  const [x, y, radius] = [region.x, region.y, region.radius].map((value) => Math.round(value * scale));
  return [
    `The user chose this Intent: "${intent}". Do only this, in the app on screen, in as few actions as possible.`,
    `They chose it while looking at about (${x}, ${y}), within about ${radius} pixels, in the ${frame.imageWidth} x ${frame.imageHeight} screenshot. ${elementHint(element, frame)}"This" or "that" in the Intent means what is there.`,
    'For a video: click its thumbnail or title once. "A related video" means one from the recommendations beside or below the player, not the one playing.',
    'For an ad: click "Skip" or "Skip ad" if it is shown; if a countdown is shown, wait for it (at most 10 seconds) and then click it. If no ad is playing, stop.',
    // Only for its own Intent: "Summarize the essay" got these steps too and typed a paragraph into the essay.
    // shortcut: only this prompt keeps the agent from deleting the user's text, the session core enforces it in #12.
    'If the Intent is "Continue the essay": look at the screenshot and click just after the last word of the essay\'s text, not where the user looked, which may be a margin. Press cmd+down to put the text caret at the very end, and read what is written on screen. ' +
      'Then type one paragraph of about 80 to 120 words that continues it, in the same voice, tense and language, starting with a space or a new line as fits. ' +
      'Never change or delete text that is already there.',
    "Don't scroll, search or browse further than the Intent needs. Never sign in, enter passwords, subscribe, buy or accept anything; stop instead.",
    'Take one screenshot to check, then reply with one short sentence starting "Done:" if it worked or "Failed:" if not.',
  ].join('\n');
}

function activityOf(action: InputAction): string {
  switch (action.type) {
    case 'click':
      return 'Clicking';
    case 'move':
      return 'Moving the pointer';
    case 'scroll':
      return 'Scrolling';
    case 'type':
      return 'Typing';
    case 'key':
      return `Pressing ${action.keys}`;
  }
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// Whether the last typed words can be read on screen. Any 3 in a row of the last 6 will do, so one misread word
// doesn't count as a miss: the agent would type the paragraph again.
function showsTyped(typed: string, screen: string): boolean {
  const tail = words(typed).slice(-6);
  const runs = tail.length <= 3 ? [tail] : tail.slice(0, -2).map((_, i) => tail.slice(i, i + 3));
  const onScreen = ` ${words(screen).join(' ')} `;
  return runs.some((run) => onScreen.includes(` ${run.join(' ')} `));
}

const clip = (text: string) => (text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…` : text);

// The agent's last sentence starts "Done:" or "Failed:". Strips the marker and trims to SUMMARY_MAX_CHARS.
export function readOutcome(result: Pick<AgentCheckResult, 'ok' | 'finalText' | 'error'>): Pick<IntentOutcome, 'ok' | 'stopped' | 'summary'> {
  if (result.error === STOPPED_ERROR) return { ok: false, stopped: true, summary: 'Stopped' };
  if (result.error) return { ok: false, stopped: false, summary: clip(result.error) };
  const failed = /^\s*failed:/i.test(result.finalText);
  const ok = result.ok && !failed;
  const text = result.finalText.replace(/^\s*(done|failed):\s*/i, '').trim();
  return { ok, stopped: false, summary: clip(text || (ok ? 'Done' : 'Failed')) };
}

// Runs the Intent on config.backend. Never throws. Logs one `[intent-run] done ...` line with the timing.
export async function runIntent(run: IntentRun, config: AgentConfig, deps: RunIntentDeps): Promise<IntentOutcome> {
  const { log, now, signal } = deps;
  const started = now();
  log(`${RUN_LOG_PREFIX} start request=${run.request} backend=${config.backend} model=${config.model} intent=${JSON.stringify(run.intent)}`);
  let outcome: Pick<IntentOutcome, 'ok' | 'stopped' | 'summary' | 'firstClick'>;
  try {
    if (signal.aborted) {
      outcome = readOutcome({ ok: false, finalText: '', error: STOPPED_ERROR });
    } else {
      const options = { goal: intentGoal(run), model: config.model, effort: config.effort, maxSteps: Math.max(config.maxSteps, INTENT_MIN_STEPS) };
      const { sleep, onActivity, changedPixels, screenText } = deps;
      const unchanged = (a: Screenshot, b: Screenshot) => {
        const changed = changedPixels(a.png, b.png);
        log(`${RUN_LOG_PREFIX} the run changed ${changed} pixels`);
        return changed < MIN_CHANGED_PIXELS;
      };
      // Both backends act only through these two, so wrapping them reports every step of either and checks the typing.
      let first: Screenshot | null = null;
      let typedNowhere = false;
      const capture: Capture = async () => {
        onActivity('Looking at the screen');
        const shot = await deps.capture();
        first ??= shot;
        return shot;
      };
      const execute: Execute = async (action) => {
        onActivity(activityOf(action));
        try {
          if (action.type !== 'type') return await deps.execute(action);
          await deps.execute(action);
          // Text typed where no text box has focus goes nowhere, and the agent can't tell. Pixels can't tell either: a
          // space scrolls a page that takes no typing.
          if (words(action.text).length === 0 || signal.aborted) return;
          let text: string | null = null;
          for (let look = 1; look <= TYPING_LOOKS; look++) {
            text = await screenText(await deps.capture());
            if (text === null || showsTyped(action.text, text)) break;
            if (look < TYPING_LOOKS) await sleep(TYPING_LOOK_GAP_MS);
          }
          if (text === null) return void log(`${RUN_LOG_PREFIX} typing check skipped: could not read the screen text`);
          typedNowhere = !showsTyped(action.text, text);
          log(`${RUN_LOG_PREFIX} typing check: the typed words ${typedNowhere ? 'are not' : 'are'} on screen`);
          if (typedNowhere) throw new Error(`${TYPED_NOWHERE}. Take a screenshot: if it isn't there, click into the text and type it again.`);
        } finally {
          // After an input the model takes its turn, which is most of the run.
          onActivity('Thinking');
        }
      };
      const result =
        config.backend === 'claude-code'
          ? await (deps.backends?.['claude-code'] ?? runClaudeCode)(options, {
              capture,
              execute,
              log,
              sleep,
              now,
              hands: deps.hands,
              cwd: deps.cwd,
              signal,
              timeoutMs: INTENT_TIMEOUT_MS,
            })
          : await (deps.backends?.api ?? runAgentCheck)(options, { messages: deps.messages(), capture, execute, log, sleep, now, signal });
      outcome = readOutcome(result);
      const click = result.actions.find(({ ok, action }) => ok && action?.type === 'click' && action.at)?.action;
      if (click?.type === 'click' && click.at) outcome = { ...outcome, firstClick: click.at };
      // "Done" is the agent's own word, so it stands only if the screen agrees.
      if (outcome.ok && typedNowhere) outcome = { ok: false, stopped: false, summary: TYPED_NOWHERE };
      else if (outcome.ok && first && unchanged(first, await deps.capture())) outcome = { ok: false, stopped: false, summary: NOTHING_CHANGED };
    }
  } catch (cause) {
    outcome = { ok: false, stopped: false, summary: clip(cause instanceof Error ? cause.message : String(cause)) };
  }
  const ms = now() - started;
  log(
    `${RUN_LOG_PREFIX} done request=${run.request} ok=${outcome.ok} stopped=${outcome.stopped} ms=${ms} backend=${config.backend} ` +
      `intent=${JSON.stringify(run.intent)} summary=${JSON.stringify(outcome.summary)}`,
  );
  return { ...outcome, ms };
}
