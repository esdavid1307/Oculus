import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { renameSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { GazeRegion } from '../shared/gaze';
import type { Rect } from '../shared/geometry';
import { chromeElements, type RawElement } from '../shared/chrome-scan';
import type { Icon } from '../shared/session';

const LOG = '[chrome-scan]';
// A lookup that hasn't answered by then is given up, so one hung lookup can't stop the next.
const REPLY_MS = 1000;
// At most one lookup this often: each one asks Chrome about 17 points, and the 3 second hold doesn't need more.
const LOOK_MS = 300;

const mtime = (file: string) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

// Gaze Scan in Chrome (#22): runs scripts/oculus-ax.swift, compiled on first use and again whenever the source is newer,
// and asks it for the Chrome elements around the gaze. elements() is what the session scans.
// shortcut: compiles from the repo with swiftc (Xcode Command Line Tools), so it is dev-only like the hands script.
// Ship a built helper to package the app.
export function createChromeScan({ source, binary, display, log = console.log }: { source: string; binary: string; display: Rect; log?: (line: string) => void }) {
  let helper: ChildProcessWithoutNullStreams | null = null;
  let found: Icon[] = [];
  // The lookup in flight: the region it was for and when it was sent. Lookups are answered in order.
  let inFlight: { region: GazeRegion; at: number } | null = null;
  let lastLook = 0;
  let stopped = false;

  function run() {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    helper = child;
    createInterface({ input: child.stdout }).on('line', (line) => {
      const region = inFlight?.region;
      inFlight = null;
      try {
        const reply = JSON.parse(line) as { front?: boolean; elements?: RawElement[] };
        found = reply.front && region && Array.isArray(reply.elements) ? chromeElements(reply.elements, region, display) : [];
      } catch {
        found = [];
      }
    });
    child.stderr.on('data', (chunk) => log(`${LOG} ${String(chunk).trim()}`));
    // A helper that died mid-write closes the pipe. The exit handler below reports it.
    child.stdin.on('error', () => {});
    child.on('error', (error) => log(`${LOG} could not start the helper: ${error.message}`));
    child.on('exit', (code) => {
      if (helper === child) helper = null;
      inFlight = null;
      found = [];
      if (!stopped) log(`${LOG} helper exited (${code}), so Chrome elements are not scanned until the next start`);
    });
  }

  if (mtime(binary) >= mtime(source) && mtime(binary) > 0) run();
  else {
    log(`${LOG} building the Accessibility helper`);
    // Built beside it and renamed, so a build cut short never leaves a half binary that the next start would run.
    execFile('xcrun', ['swiftc', '-O', source, '-o', `${binary}.tmp`], (error, _stdout, stderr) => {
      if (error) return log(`${LOG} could not build ${source}, is Xcode or its Command Line Tools installed? ${String(stderr).trim() || error.message}`);
      renameSync(`${binary}.tmp`, binary);
      if (!stopped) run();
    });
  }

  return {
    elements: () => found,
    // Asks about the latest gaze, unless a lookup is still going. region is in overlay coordinates.
    look(region: GazeRegion | null) {
      const now = Date.now();
      if (now - lastLook < LOOK_MS || (inFlight && now - inFlight.at < REPLY_MS)) return;
      lastLook = now;
      if (!helper || !region) {
        found = [];
        return;
      }
      inFlight = { region, at: now };
      helper.stdin.write(`${region.x + display.x} ${region.y + display.y} ${region.radius}\n`);
    },
    clear() {
      found = [];
    },
    stop() {
      stopped = true;
      helper?.stdin.end();
      helper?.kill();
    },
  };
}
