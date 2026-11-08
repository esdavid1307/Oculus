import Anthropic from '@anthropic-ai/sdk';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { createCapture } from './capture';
import { runClaudeCode } from './claude-code';
import { checkAccessibility, execute } from './executor';
import { runAgentCheck } from './loop';
import { focusChrome, logPermissions } from './macos';
import { LOG_PREFIX, type AgentCheckResult, type AgentConfig } from './types';

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
    // shortcut: the hands script is read from the repo, so the claude-code backend is dev-only. Bundle it to package the app.
    // Copied into the run folder, Claude's working folder, so a space in the repo path can't split its command.
    await copyFile(join(app.getAppPath(), 'scripts', 'oculus-hands.mjs'), join(runDir, 'oculus-hands.mjs'));
    const capture = createCapture({ overlay, display: screen.getPrimaryDisplay(), saveDir: runDir, hideOverlay: !config.showOverlayInShots });
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const result =
      config.backend === 'claude-code'
        ? await runClaudeCode(config, { capture, execute, log, sleep, now: Date.now, hands: 'oculus-hands.mjs', cwd: runDir })
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
