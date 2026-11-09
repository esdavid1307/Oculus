import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { GazeRegion } from '../shared/gaze';
import type { Position, Screen } from '../shared/geometry';
import { createNeuralLayer, readNeuralLayer, type LearningSignal } from '../shared/neural/layer';
import { isSkipAd } from '../shared/skip-ad';

// The uncorrected gaze for this long back, so a confirmed hold can be matched to where the tracker really put it.
const RAW_GAZE_MS = 30_000;
// A run that clicked further than this from where the user looked was about something else, so it teaches nothing.
const CLICK_NEAR_PX = 2.5;
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
  let lastStep = layer.scanStepMs();
  let lastActive = false;

  const save = () => {
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

  const rawGaze = (from: number, to: number): Position | null => {
    const inside = raw.filter(({ t }) => t >= from && t <= to);
    if (inside.length === 0) return null;
    return { x: inside.reduce((sum, { x }) => sum + x, 0) / inside.length, y: inside.reduce((sum, { y }) => sum + y, 0) / inside.length };
  };

  function learn(signal: LearningSignal) {
    if (!enabled) return;
    layer.learn(signal, rawGaze);
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
      if (region) raw.push({ t, x: region.x, y: region.y });
      raw = raw.filter((sample) => t - sample.t <= RAW_GAZE_MS);
    },
    correct: (region: GazeRegion | null) => (enabled && region ? layer.correct(region) : region),
    orderIcons: (source: string, names: string[]) => (enabled ? layer.orderIcons(source, names) : names),
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
      if (lastActive) log(`${LOG} gaze correction reset by recalibrating`);
      lastActive = false;
    },
  };
}
