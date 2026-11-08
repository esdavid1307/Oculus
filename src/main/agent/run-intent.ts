import type { GazeRegion } from '../../shared/gaze';
import { runClaudeCode } from './claude-code';
import { runAgentCheck } from './loop';
import { STOPPED_ERROR, type AgentCheckResult, type AgentConfig, type Capture, type Execute, type MessagesApi, type ScreenFrame } from './types';

// Running one chosen Suggested Intent for real (#14, and the base #10 builds on). No electron imports, so tests can load it.

export const RUN_LOG_PREFIX = '[intent-run]';
// A whole run on the Claude Code backend, several turns. Shorter than the agent check: one Intent is a few clicks.
export const INTENT_TIMEOUT_MS = 90_000;
// Model calls on the API backend: act, check with a screenshot, finish, with room for one retry.
export const INTENT_MIN_STEPS = 8;
// The longest summary the overlay shows.
export const SUMMARY_MAX_CHARS = 80;

export type IntentRun = {
  intent: string;
  // The target the Intent was suggested for, in overlay (display) points, the space of GazeRegion.
  region: GazeRegion;
  request: number;
  // Where the screenshots the agent sees sit on screen, so the goal can give the region in screenshot pixels.
  frame: ScreenFrame;
};

export type IntentOutcome = {
  ok: boolean;
  // True when the Stop Gesture cut the run short.
  stopped: boolean;
  // One short sentence for the overlay, at most SUMMARY_MAX_CHARS.
  summary: string;
  ms: number;
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
  // Injected so tests swap the backends for fakes; defaults are runClaudeCode and runAgentCheck.
  backends?: { 'claude-code'?: typeof runClaudeCode; api?: typeof runAgentCheck };
};

// The goal the run agent gets: the Intent, where the user was looking in screenshot pixels, and tight bounds.
export function intentGoal(run: Pick<IntentRun, 'intent' | 'region' | 'frame'>): string {
  const { intent, region, frame } = run;
  const scale = frame.imageWidth / frame.width;
  const [x, y, radius] = [region.x, region.y, region.radius].map((value) => Math.round(value * scale));
  return [
    `The user chose this Intent: "${intent}". Do only this, in the app on screen, in as few actions as possible.`,
    `They chose it while looking at about (${x}, ${y}), within about ${radius} pixels, in the ${frame.imageWidth} x ${frame.imageHeight} screenshot. "This" or "that" in the Intent means what is there.`,
    'For a video: click its thumbnail or title once. "A related video" means one from the recommendations beside or below the player, not the one playing.',
    'For an ad: click "Skip" or "Skip ad" if it is shown; if a countdown is shown, wait for it (at most 10 seconds) and then click it. If no ad is playing, stop.',
    "Don't scroll, search or browse further than the Intent needs. Never sign in, enter passwords, subscribe, buy or accept anything; stop instead.",
    'Take one screenshot to check, then reply with one short sentence starting "Done:" if it worked or "Failed:" if not.',
  ].join('\n');
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
  let outcome: Pick<IntentOutcome, 'ok' | 'stopped' | 'summary'>;
  try {
    if (signal.aborted) {
      outcome = readOutcome({ ok: false, finalText: '', error: STOPPED_ERROR });
    } else {
      const options = { goal: intentGoal(run), model: config.model, effort: config.effort, maxSteps: Math.max(config.maxSteps, INTENT_MIN_STEPS) };
      const { capture, execute, sleep } = deps;
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
