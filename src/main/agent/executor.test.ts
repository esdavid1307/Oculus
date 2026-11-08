import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { typeScript } from './executor';

const KEYSTROKE_LINE = /keystroke \(item \d+ of argv\)/g;
const PASTE = 'keystroke "v" using command down';

describe('typeScript', () => {
  it('types plain text with keystrokes, leaving the clipboard alone', () => {
    const { script, args } = typeScript('The end.');
    expect(args).toEqual(['The end.']);
    expect(script.join('\n').match(KEYSTROKE_LINE)).toHaveLength(1);
    expect(script.join('\n')).not.toContain('clipboard');
  });

  // keystroke drops "\n", and Google Docs adds a paragraph after a pasted line break, so new lines are Return presses.
  it('presses Return between lines, and pastes only the lines keystroke would garble', () => {
    const { script, args } = typeScript('\nTrees are naïve.\r\nThe end.');
    expect(args).toEqual(['', 'Trees are naïve.', 'The end.']);
    const text = script.join('\n');
    expect(text.match(/key code 36/g)).toHaveLength(2);
    expect(text).toContain('set the clipboard to (item 2 of argv)');
    expect(text.split(PASTE)).toHaveLength(2);
    expect(text).toContain('keystroke (item 3 of argv)');
    expect(text).not.toContain('item 1 of argv');
    // The user's clipboard is saved first and put back last.
    expect(text.indexOf('set saved to the clipboard')).toBeLessThan(text.indexOf(PASTE));
    expect(text.lastIndexOf('set the clipboard to saved')).toBeGreaterThan(text.lastIndexOf(PASTE));
  });

  it.runIf(process.platform === 'darwin').each(['The end.', '\nTrees are naïve.\nThe end.'])('compiles with osacompile: %j', (text) => {
    const dir = mkdtempSync(join(tmpdir(), 'type-'));
    try {
      execFileSync('osacompile', ['-o', join(dir, 'x.scpt'), ...typeScript(text).script.flatMap((line) => ['-e', line])], { stdio: 'pipe' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
