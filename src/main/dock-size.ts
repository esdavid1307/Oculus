import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planDock, readSavedDock } from '../shared/large-view';

// Large View makes the Dock icons big while Oculus runs. The user's own size is saved to a file first, so a crash
// never loses it: the next start or quit puts it back. Magnification is left alone, since it follows the mouse.
// shortcut: runs synchronously, so quitting waits for the Dock to be put back. Each call takes well under a second.
const defaults = (...args: string[]) => execFileSync('defaults', args, { stdio: 'pipe' }).toString();

function currentSize(): number | null {
  try {
    const size = Number(defaults('read', 'com.apple.dock', 'tilesize').trim());
    return Number.isFinite(size) && size > 0 ? size : null;
  } catch {
    // The key is missing when the user never changed the size.
    return null;
  }
}

function restartDock() {
  execFileSync('killall', ['Dock'], { stdio: 'pipe' });
}

function readSaved(file: string) {
  try {
    return readSavedDock(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Ignoring ${file}:`, error);
  }
}

// Returns whether the Dock was restarted, so the caller reads its icons again.
export function applyDockSize(userData: string, enabled: boolean, size: number): boolean {
  const file = join(userData, 'dock-size.json');
  const plan = planDock(enabled, readSaved(file));
  try {
    if (plan.type === 'leave') return false;
    if (plan.type === 'restore') return restoreFrom(file, plan.tilesize);
    if (plan.saveOriginal) {
      writeFileSync(`${file}.tmp`, JSON.stringify({ tilesize: currentSize() }));
      renameSync(`${file}.tmp`, file);
    }
    defaults('write', 'com.apple.dock', 'tilesize', '-int', String(size));
    restartDock();
    return true;
  } catch (error) {
    console.warn('Could not change the Dock size:', error);
    return false;
  }
}

// On quit: puts the saved size back, if there is one.
export function restoreDock(userData: string) {
  const file = join(userData, 'dock-size.json');
  const saved = readSaved(file);
  if (saved === undefined) return;
  try {
    restoreFrom(file, saved.tilesize);
  } catch (error) {
    console.warn('Could not put the Dock size back:', error);
  }
}

function restoreFrom(file: string, tilesize: number | null) {
  if (tilesize === null) {
    try {
      defaults('delete', 'com.apple.dock', 'tilesize');
    } catch {
      // Already unset.
    }
  } else defaults('write', 'com.apple.dock', 'tilesize', '-int', String(tilesize));
  restartDock();
  rmSync(file, { force: true });
  return true;
}
