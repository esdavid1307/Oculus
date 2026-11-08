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

const KEYSTROKE = ['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'];
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

// keystroke drops "\n" and garbles accents ("café" typed "cafa"), so other text is pasted and the clipboard put back.
// shortcut: one form of the clipboard comes back and a copy made in the 0.5 s is lost, save every type if users notice.
const PASTE = [
  'on run argv',
  'try',
  'set saved to the clipboard',
  'end try',
  'set the clipboard to (item 1 of argv)',
  'tell application "System Events" to keystroke "v" using command down',
  'delay 0.5',
  'try',
  'set the clipboard to saved',
  'end try',
  'end run',
];

// Every script checks Accessibility first, since CGEventPost drops events silently without it.
// System Events fails on its own without it.
export const execute: Execute = (action) => {
  if (action.type === 'type') {
    const script = PRINTABLE_ASCII.test(action.text) ? KEYSTROKE : PASTE;
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
