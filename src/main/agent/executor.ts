import { execFile } from 'node:child_process';
import { ACCESSIBILITY_GUARD, jxaFor } from './jxa';
import type { Execute } from './types';

const TIMEOUT_MS = 10_000;

function osascript(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', args, { timeout: TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      // "execution error: Error: Error: <message> (-2700)" from a thrown JXA error.
      const message = String(stderr).trim().replace(/^execution error: (Error: )*/, '').replace(/ \(-?\d+\)$/, '');
      reject(new Error(message || error.message));
    });
  });
}

// Rejects with ACCESSIBILITY_ERROR when the events would be dropped.
export function checkAccessibility(): Promise<void> {
  return osascript(['-l', 'JavaScript', '-e', ACCESSIBILITY_GUARD]);
}

// Every script checks Accessibility first, since CGEventPost drops events silently without it.
// System Events fails on its own without it.
export const execute: Execute = (action) => {
  if (action.type === 'type') {
    const script = ['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'];
    return osascript([...script.flatMap((line) => ['-e', line]), action.text]);
  }
  let script: string;
  try {
    script = jxaFor(action);
  } catch (error) {
    return Promise.reject(error);
  }
  return osascript(['-l', 'JavaScript', '-e', script]);
};
