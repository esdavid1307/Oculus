import Anthropic from '@anthropic-ai/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { createCapture } from './capture';
import { runClaudeCode } from './claude-code';
import { readAgentConfig } from './config';
import { checkAccessibility, execute } from './executor';
import { fitScreenshot } from './frame';
import { runAgentCheck } from './loop';
import { focusChrome, logPermissions } from './macos';
import { RUN_LOG_PREFIX, runIntent, type IntentOutcome, type IntentRun } from './run-intent';
import { LOG_PREFIX, MODEL_MAX_LONG_EDGE, type AgentCheckResult, type AgentConfig } from './types';

const failed = (config: AgentConfig, error: string): AgentCheckResult => ({
  ok: false,
  goal: config.goal,
  model: config.model,
  calls: [],
  actions: [],
  screenshots: [],
  finalText: '',
  error,
});

// Never throws: the caller decides the exit code from result.ok.
export async function runAgentCheckInElectron(
  overlay: BrowserWindow,
  config: AgentConfig,
  log: (line: string) => void = console.log,
): Promise<AgentCheckResult> {
  try {
    const runDir = join(app.getPath('userData'), 'agent-check', new Date().toISOString().replace(/[:.]/g, '-'));
    logPermissions(log);
    if (config.backend === 'api' && !process.env.ANTHROPIC_API_KEY) {
      const result = failed(config, 'ANTHROPIC_API_KEY missing: copy .env.example to .env');
      log(`${LOG_PREFIX} ${result.error}`);
      return result;
    }
    // Fails before the model call, so a run can't report ok while every click was dropped.
    await checkAccessibility();
    await focusChrome();
    await mkdir(runDir, { recursive: true });
    const capture = createCapture({ overlay, display: screen.getPrimaryDisplay(), saveDir: runDir, hideOverlay: !config.showOverlayInShots });
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const result =
      config.backend === 'claude-code'
        ? // shortcut: the hands script is read from the repo, so this backend is dev-only.
          await runClaudeCode(config, { capture, execute, log, sleep, now: Date.now, hands: join(app.getAppPath(), 'scripts', 'oculus-hands.mjs'), cwd: runDir })
        : await runAgentCheck(config, { messages: new Anthropic().beta.messages, capture, execute, log, sleep, now: Date.now });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({ result, config }, null, 2));
    log(`${LOG_PREFIX} screenshots and run.json in ${runDir}`);
    return result;
  } catch (error) {
    const result = failed(config, error instanceof Error ? error.message : String(error));
    log(`${LOG_PREFIX} ${result.error}`);
    return result;
  }
}

// Runs one chosen Suggested Intent (#14). Never throws. The frame comes from the primary display, as the capture's does.
// Saves the screenshots and run.json under userData/intent-runs/<timestamp>/.
export async function runIntentInElectron(
  overlay: BrowserWindow,
  run: Omit<IntentRun, 'frame'>,
  signal: AbortSignal,
  log: (line: string) => void = console.log,
): Promise<IntentOutcome> {
  const started = Date.now();
  const failure = (summary: string): IntentOutcome => {
    log(`${RUN_LOG_PREFIX} ${summary}`);
    return { ok: false, stopped: false, summary, ms: Date.now() - started };
  };
  try {
    const config = readAgentConfig(process.env, 'shortcut')!;
    if (config.backend === 'api' && !process.env.ANTHROPIC_API_KEY) return failure('ANTHROPIC_API_KEY missing: copy .env.example to .env');
    try {
      await checkAccessibility();
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'Accessibility is not granted');
    }
    const runDir = join(app.getPath('userData'), 'intent-runs', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(runDir, { recursive: true });
    const display = screen.getPrimaryDisplay();
    const capture = createCapture({ overlay, display, saveDir: runDir, hideOverlay: true });
    const frame = fitScreenshot(display.bounds, MODEL_MAX_LONG_EDGE);
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const outcome = await runIntent({ ...run, frame }, config, {
      capture,
      execute,
      log,
      sleep,
      now: Date.now,
      // shortcut: the hands script is read from the repo, so the claude-code backend is dev-only.
      hands: join(app.getAppPath(), 'scripts', 'oculus-hands.mjs'),
      cwd: runDir,
      messages: () => new Anthropic().beta.messages,
      signal,
    });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({ run, outcome, config }, null, 2));
    log(`${RUN_LOG_PREFIX} screenshots and run.json in ${runDir}`);
    return outcome;
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
