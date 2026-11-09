import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { GazeRegion } from '../shared/gaze';
import type { Position, Screen } from '../shared/geometry';
import { createNeuralLayer, readNeuralLayer, type LearningSignal } from '../shared/neural/layer';
import { isSkipAd } from '../shared/skip-ad';

// The uncorrected gaze for this long back, so a confirmed hold can be matched to where the tracker really put it.
const RAW_GAZE_MS = 30_000;
// A run that clicked further than this from where the user looked was about something else, so it teaches nothing.
const CLICK_NEAR_PX = 2.5;
// How long to coalesce saves: every typed character and every opened icon writes the model, so a run of inputs would
// rewrite neural-layer.json dozens of times a second without this. 2 s is short enough that a crash loses little.
const SAVE_DEBOUNCE_MS = 2000;
const LOG = '[neural]';

// The Neural Layer as the main process uses it: saved to one file, fed by the session's learn actions, and told about
// the uncorrected gaze. Off with "neuralLayer": false in config.json, which leaves every feature as it was.
export function createMainNeuralLayer({ file, screen, scanStepMs, enabled, log = console.log }: {
  file: string;
  screen: Screen;
  scanStepMs: number;
  enabled: boolean;
  log?: (line: string) => void;
}) {
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`${LOG} starting fresh, ignoring ${file}: ${String(error)}`);
  }
  const layer = createNeuralLayer({ screen, scanStepMs, model: readNeuralLayer(saved) });
  let raw: { t: number; x: number; y: number }[] = [];
  // Snapshots of where the uncorrected gaze was over a hold window, taken at hold time and kept until the learn
  // signal arrives. Keyed by the (from, to) time window so session-emitted gaze signals can look them up without a
  // new argument. Without this, a long-running Intent (or a slow typist) sees its raw samples evicted from the ring
  // buffer before the hold is confirmed, and the Gaze Correction label would be dropped for a null lookup.
  const snapshots = new Map<string, Position>();
  const snapshotKey = (from: number, to: number) => `${from}:${to}`;
  // How many pending snapshots to keep. One per Intent run plus one per text-box hold is at most a handful at a
  // time; the cap stops a silent leak on a path that never confirms.
  const MAX_SNAPSHOTS = 64;
  let lastStep = layer.scanStepMs();
  let lastActive = false;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveDirty = false;
  const doSave = () => {
    saveDirty = false;
    try {
      // Write then rename, so a crash mid-write never leaves a half file that would start the layer fresh. The temp
      // name is per process, so a second copy of the app saving at the same moment can't rename it away.
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(layer.model()));
      renameSync(temp, file);
    } catch (error) {
      log(`${LOG} could not save: ${String(error)}`);
    }
  };
  // Coalesces repeated save requests: during normal typing or icon scanning there are tens of learn signals per
  // minute, each of which would otherwise rewrite the JSON file. One save at most every SAVE_DEBOUNCE_MS is enough.
  const save = () => {
    saveDirty = true;
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      doSave();
    }, SAVE_DEBOUNCE_MS);
  };
  const flush = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (saveDirty) doSave();
  };

  const rawGaze = (from: number, to: number): Position | null => {
    const inside = raw.filter(({ t }) => t >= from && t <= to);
    if (inside.length === 0) return null;
    // Weighted average favouring samples near the end of the hold: a long drift across the Centre Box pulls an
    // arithmetic mean away from where the user settled, so samples closer to `to` count more. Linear ramp from 1 (at
    // the start) to 2 (at the end) keeps every sample contributing, so a brief late glance can't dominate the label.
    const span = Math.max(to - from, 1);
    let sumX = 0, sumY = 0, sumW = 0;
    for (const { t, x, y } of inside) {
      const weight = 1 + (t - from) / span;
      sumX += x * weight;
      sumY += y * weight;
      sumW += weight;
    }
    return { x: sumX / sumW, y: sumY / sumW };
  };

  // Prefers the snapshot taken at hold time over a lookup now, so a hold confirmed long after it ended still has its
  // gaze label.
  const lookupGaze = (from: number, to: number): Position | null => {
    const key = snapshotKey(from, to);
    const saved = snapshots.get(key);
    if (saved) {
      snapshots.delete(key);
      return saved;
    }
    return rawGaze(from, to);
  };

  function learn(signal: LearningSignal) {
    if (!enabled) return;
    layer.learn(signal, lookupGaze);
    const { gaze, scanStepMs: step, paceSamples } = layer.stats();
    if (signal.kind === 'gaze' && gaze.active !== lastActive) {
      lastActive = gaze.active;
      const { before, after } = gaze.heldOutErrorPx;
      log(`${LOG} gaze correction ${gaze.active ? 'on' : 'off'}: ${gaze.examples} selections, held-out error ${Math.round(before)} -> ${Math.round(after)} px`);
    }
    if (step !== lastStep) {
      log(`${LOG} scan step ${lastStep} -> ${step} ms from ${paceSamples} presses`);
      lastStep = step;
    }
    // Gaze Correction is kept in memory only, since every calibration starts it again.
    if (signal.kind !== 'gaze') save();
  }

  return {
    enabled,
    // Every uncorrected Gaze Region the tracker sends, before it is corrected.
    seen(t: number, region: GazeRegion | null) {
      if (!enabled) return;
      if (region) raw.push({ t, x: region.x, y: region.y });
      raw = raw.filter((sample) => t - sample.t <= RAW_GAZE_MS);
    },
    correct: (region: GazeRegion | null) => (enabled && region ? layer.correct(region) : region),
    orderIcons: (source: string, names: string[]) => (enabled ? layer.orderIcons(source, names) : names.map((_, i) => i)),
    scanPace: () => (enabled ? layer.scanStepMs() : scanStepMs),
    learn,
    // A run that went well clicked what the user meant, which is the best label Gaze Correction gets. Skipping an ad
    // clicks the Skip button wherever the user looked, so it says nothing about the gaze.
    runSucceeded(intent: string, region: GazeRegion, held: { from: number; to: number }, click: Position | undefined, origin: Position) {
      if (!click || isSkipAd(intent)) return;
      const target = { x: click.x - origin.x, y: click.y - origin.y };
      if (Math.hypot(target.x - region.x, target.y - region.y) > region.radius * CLICK_NEAR_PX) return;
      learn({ kind: 'gaze', ...held, target, weight: 1 });
    },
    recalibrated() {
      layer.recalibrated();
      raw = [];
      snapshots.clear();
      if (lastActive) log(`${LOG} gaze correction reset by recalibrating`);
      lastActive = false;
    },
    // Resolves the uncorrected gaze over a hold window right now, while the samples are still in the ring buffer, and
    // stores the result for the matching learn call later. Called at hold-time (focus-text-box, run-intent) so a long
    // gap between hold and confirmation can't evict the samples.
    snapshotHold(from: number, to: number) {
      if (!enabled) return;
      const at = rawGaze(from, to);
      if (!at) return;
      snapshots.set(snapshotKey(from, to), at);
      // The oldest pending snapshot is dropped if too many pile up, so a path that never confirms can't leak memory.
      if (snapshots.size > MAX_SNAPSHOTS) {
        const first = snapshots.keys().next().value;
        if (first !== undefined) snapshots.delete(first);
      }
    },
    // Writes any pending model state right now. Call on app quit so the debounced tail isn't lost.
    flush,
  };
}
