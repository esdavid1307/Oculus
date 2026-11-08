import { execFile } from 'node:child_process';
import { systemPreferences } from 'electron';
import { LOG_PREFIX } from './types';

const CHROME_LAUNCH_WAIT_MS = 800;

export function logPermissions(log: (line: string) => void): void {
  const screen = systemPreferences.getMediaAccessStatus('screen');
  const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
  log(`${LOG_PREFIX} permissions: screen=${screen} accessibility=${accessibility}`);
  if (screen !== 'granted' || !accessibility) {
    log(`${LOG_PREFIX} grant Screen Recording and Accessibility to the app running npm, see docs/agent-check.md`);
  }
}

export function focusChrome(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', 'Google Chrome'], (error) => {
      if (error) {
        reject(new Error(`Could not bring Google Chrome forward, is it installed? ${error.message}`));
        return;
      }
      setTimeout(resolve, CHROME_LAUNCH_WAIT_MS);
    });
  });
}
