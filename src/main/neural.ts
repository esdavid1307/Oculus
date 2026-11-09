import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { GazeRegion } from '../shared/gaze';
import type { Position, Screen } from '../shared/geometry';
import { createNeuralLayer, readNeuralLayer, type LearningSignal } from '../shared/neural/layer';
import { isSkipAd } from '../shared/skip-ad';

// The uncorrected gaze for this long back, so a confirmed hold can be matched to where the tracker really put it. The
// strongest labels (a run that went well, Done on a typed text box) come well after the hold: typing a few words with
// the scanning keyboard, or a run of several steps, takes minutes, not seconds.
const RAW_GAZE_MS = 5 * 60_000;
// Saving rewrites the whole model, so presses close together share one write.
const SAVE_DELAY_MS = 2000;
// A run that clicked further than this from where the user looked was about something else, so it teaches nothing.
const CLICK_NEAR_PX = 2.5;
const LOG = '[neural]';

// The Neural Layer as the main process uses it: saved to one file, fed by the session's learn actions, and told about
// the uncorrected gaze. Off with "neuralLayer": false in config.json, which leaves every feature as it was.
// scanStepSet is true when config.json sets "scanStepMs": that step is the user's choice, so Scan Pace leaves it alone.
export function createMainNeuralLayer({ file, screen, scanStepMs, enabled, scanStepSet = false, log = console.log }: {
  file: string;
  screen: Screen;
  scanStepMs: number;
  enabled: boolean;
  scanStepSet?: boolean;
  log?: (line: string) => void;
}) {
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`${LOG} starting fresh, ignoring ${file}: ${String(error)}`);
  }
  const layer = createNeuralLayer({ screen, scanStepMs, model: readNeuralLayer(saved) });
  // In time order, oldest first, so old samples are dropped from the front.
  let raw: { t: number; x: number; y: number }[] = [];
  let lastStep = layer.scanStepMs();
  let lastActive = false;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
      // Write then rename, so a crash mid-write never leaves a half file that would start the layer fresh.
      writeFileSync(`${file}.tmp`, JSON.stringify(layer.model()));
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      log(`${LOG} could not save: ${String(error)}`);
    }
  };

  const rawGaze = (from: number, to: number): Position | null => {
    const inside = raw.filter(({ t }) => t >= from && t <= to);
    if (inside.length === 0) return null;
    return { x: inside.reduce((sum, { x }) => sum + x, 0) / inside.length, y: inside.reduce((sum, { y }) => sum + y, 0) / inside.length };
  };

  const saveSoon = () => (saveTimer ??= setTimeout(save, SAVE_DELAY_MS));

  // Gaze examples retrain Gaze Correction, which takes tens of milliseconds, so they're learned after the input that
  // sent them has been handled, and several at once share one turn. The raw gaze is read now, while it's still kept.
  let pendingGaze: { signal: LearningSignal; at: Position | null }[] = [];
  const learnPendingGaze = () => {
    const batch = pendingGaze;
    pendingGaze = [];
    for (const { signal, at } of batch) {
      layer.learn(signal, () => at);
      afterLearning(signal);
    }
  };

  function learn(signal: LearningSignal) {
    if (!enabled || (scanStepSet && signal.kind === 'select')) return;
    if (signal.kind === 'gaze') {
      if (pendingGaze.length === 0) setImmediate(learnPendingGaze);
      pendingGaze.push({ signal, at: rawGaze(signal.from, signal.to) });
      return;
    }
    layer.learn(signal, rawGaze);
    afterLearning(signal);
  }

  function afterLearning(signal: LearningSignal) {
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
    if (signal.kind !== 'gaze') saveSoon();
  }

  return {
    enabled,
    // Every uncorrected Gaze Region the tracker sends, before it is corrected.
    seen(t: number, region: GazeRegion | null) {
      if (region) raw.push({ t, x: region.x, y: region.y });
      let expired = 0;
      while (expired < raw.length && t - raw[expired].t > RAW_GAZE_MS) expired++;
      if (expired > 0) raw.splice(0, expired);
    },
    correct: (region: GazeRegion | null) => (enabled && region ? layer.correct(region) : region),
    orderIcons: (source: string, names: string[]) => (enabled ? layer.orderIcons(source, names) : names),
    scanPace: () => (enabled && !scanStepSet ? layer.scanStepMs() : scanStepMs),
    learn,
    stats: () => layer.stats(),
    // A run that went well clicked what the user meant, which is the best label Gaze Correction gets. Skipping an ad
    // clicks the Skip button wherever the user looked, so it says nothing about the gaze.
    runSucceeded(intent: string, region: GazeRegion, held: { from: number; to: number }, click: Position | undefined, origin: Position) {
      if (!click || isSkipAd(intent)) return;
      const target = { x: click.x - origin.x, y: click.y - origin.y };
      if (Math.hypot(target.x - region.x, target.y - region.y) > region.radius * CLICK_NEAR_PX) return;
      learn({ kind: 'gaze', ...held, target, weight: 1 });
    },
    // Writes a save that's still waiting, so quitting never loses the last presses.
    flush() {
      if (saveTimer !== undefined) save();
    },
    recalibrated() {
      layer.recalibrated();
      raw = [];
      pendingGaze = [];
      if (lastActive) log(`${LOG} gaze correction reset by recalibrating`);
      lastActive = false;
    },
  };
}
