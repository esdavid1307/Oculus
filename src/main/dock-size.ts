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

// System Events resizes the running Dock in place, so it never disappears the way a killall Dock restart does.
// Its dock size runs 0 to 1 over tilesize 16 to 128. The Dock truncates it through a float32, so a quarter tile up
// keeps 59 at 59 instead of drifting a size smaller every run.
function resizeDock(tilesize: number) {
  const size = (tilesize - 16 + 0.25) / 112;
  execFileSync('osascript', ['-e', `tell application "System Events" to set dock size of dock preferences to ${size}`], { stdio: 'pipe' });
}

function readSaved(file: string) {
  try {
    return readSavedDock(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Ignoring ${file}:`, error);
  }
}

// What the Dock shows while tilesize is unset.
const MACOS_DEFAULT_TILESIZE = 64;

// Returns whether the Dock was resized, so the caller reads its icons again.
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
    resizeDock(size);
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
  resizeDock(tilesize ?? MACOS_DEFAULT_TILESIZE);
  // Resizing writes the key, so a size the user never set is unset again.
  if (tilesize === null) defaults('delete', 'com.apple.dock', 'tilesize');
  rmSync(file, { force: true });
  return true;
}
