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

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

// The AppleScript that types text, one line per argv item. keystroke drops "\n" and Google Docs adds a paragraph after
// a pasted line break, so lines are joined with Return. keystroke garbles accents ("café" typed "cafa"), so such a line
// is pasted, waiting for the app to read it, and the clipboard is put back.
// shortcut: one form of the clipboard comes back and a copy made during typing is lost, save every type if users notice.
export function typeScript(text: string): { script: string[]; args: string[] } {
  const args = text.split(/\r?\n/);
  const pastes = args.some((line) => !PRINTABLE_ASCII.test(line));
  const lines = args.flatMap((line, i) => [
    ...(i > 0 ? ['tell application "System Events" to key code 36'] : []),
    ...(line === ''
      ? []
      : PRINTABLE_ASCII.test(line)
        ? [`tell application "System Events" to keystroke (item ${i + 1} of argv)`]
        : [`set the clipboard to (item ${i + 1} of argv)`, 'tell application "System Events" to keystroke "v" using command down', 'delay 0.5']),
  ]);
  const save = pastes ? ['try', 'set saved to the clipboard', 'end try'] : [];
  const restore = pastes ? ['try', 'set the clipboard to saved', 'end try'] : [];
  return { script: ['on run argv', ...save, ...lines, ...restore, 'end run'], args };
}

// Every script checks Accessibility first, since CGEventPost drops events silently without it.
// System Events fails on its own without it.
export const execute: Execute = (action) => {
  if (action.type === 'type') {
    const { script, args } = typeScript(action.text);
    // "--" so a line starting with "-", like a bullet, isn't read as an osascript option.
    return osascript([...script.flatMap((line) => ['-e', line]), '--', ...args]);
  }
  let script: string;
  try {
    script = jxaFor(action);
  } catch (error) {
    return Promise.reject(error);
  }
  return osascript(['-l', 'JavaScript', '-e', script]);
};
