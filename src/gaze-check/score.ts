import { CORNER_TARGET_SIZE } from '../shared/session';

type Position = { x: number; y: number };

export type Screen = { width: number; height: number };
// What the tracker reports. It only becomes a Gaze Region once a real gaze source gives it a radius.
export type Sample = { t: number; estimate: Position | null };
// Corner targets are tested at the centre of their target.
export type Target = Position & { kind: 'wake' | 'stop' | 'key' };
export type Trial = { target: Target; samples: Sample[] };

const HOLD_MS = 2000;
const SMOOTHING_MS = 300;
// 26 letters, space, delete and done.
export const KEYS_NEEDED = 29;
// The minimum rate in docs/gaze-events.md.
const MIN_SAMPLES_PER_SECOND = 10;

const meanOf = (positions: Position[]) => ({
  x: positions.reduce((sum, { x }) => sum + x, 0) / positions.length,
  y: positions.reduce((sum, { y }) => sum + y, 0) / positions.length,
});

// A real gaze source must smooth before sending (docs/gaze-events.md), so score what it would send.
function smooth(samples: Sample[]): Sample[] {
  let recent: { t: number; estimate: Position }[] = [];
  return samples.map(({ t, estimate }) => {
    if (!estimate) {
      recent = [];
      return { t, estimate };
    }
    recent = [...recent.filter((sample) => t - sample.t <= SMOOTHING_MS), { t, estimate }];
    return { t, estimate: meanOf(recent.map((sample) => sample.estimate)) };
  });
}

const percentile = (values: number[], share: number) =>
  [...values].sort((a, b) => a - b)[Math.max(Math.ceil(values.length * share) - 1, 0)] ?? 0;

const estimatesOf = (trial: Trial) => trial.samples.flatMap(({ estimate }) => (estimate ? [estimate] : []));

// How far the gaze strayed from the target towards the middle of the screen. Past the screen edge still counts as on.
function inwardError({ x, y }: Position, target: Target) {
  return target.kind === 'wake' ? Math.max(target.x - x, y - target.y, 0) : Math.max(x - target.x, target.y - y, 0);
}

function longestHoldMs(trial: Trial) {
  let start: number | null = null;
  let longest = 0;
  for (const { t, estimate } of trial.samples) {
    if (estimate && inwardError(estimate, trial.target) <= CORNER_TARGET_SIZE / 2) {
      start ??= t;
      longest = Math.max(longest, t - start);
    } else {
      start = null;
    }
  }
  return longest;
}

function scoreCorner(trials: Trial[]) {
  const errors = trials.flatMap((trial) => estimatesOf(trial).map((estimate) => inwardError(estimate, trial.target)));
  return {
    trials: trials.length,
    hits: trials.filter((trial) => longestHoldMs(trial) >= HOLD_MS).length,
    targetSize: 2 * percentile(errors, 0.95),
  };
}

function keysThatFit(keySize: number, screen: Screen) {
  if (keySize === 0) return 0;
  const cells = Math.floor(screen.width / keySize) * Math.floor(screen.height / keySize);
  return Math.max(cells - 2 * Math.ceil(CORNER_TARGET_SIZE / keySize) ** 2, 0);
}

const sizeToHold = (offsets: Position[]) => 2 * percentile(offsets.map(({ x, y }) => Math.max(Math.abs(x), Math.abs(y))), 0.95);

function scoreKeys(trials: Trial[], screen: Screen) {
  const offsetsFrom = (trial: Trial, { x, y }: Position) =>
    estimatesOf(trial).map((estimate) => ({ x: estimate.x - x, y: estimate.y - y }));
  const offsets = trials.flatMap((trial) => offsetsFrom(trial, trial.target));
  const wobbles = trials.flatMap((trial) => offsetsFrom(trial, meanOf(estimatesOf(trial))));
  const keySize = sizeToHold(offsets);
  return {
    tracked: offsets.length > 0,
    medianError: percentile(offsets.map(({ x, y }) => Math.hypot(x, y)), 0.5),
    jitter: percentile(wobbles.map(({ x, y }) => Math.hypot(x, y)), 0.5),
    keySize,
    keysThatFit: keysThatFit(keySize, screen),
    // The key size if calibration or Gaze Correction removed every steady offset, leaving only jitter.
    steadyKeySize: sizeToHold(wobbles),
  };
}

export function scoreGazeCheck(rawTrials: Trial[], screen: Screen) {
  const trials = rawTrials.map((trial) => ({ ...trial, samples: smooth(trial.samples) }));
  const ofKind = (kind: Target['kind']) => trials.filter((trial) => trial.target.kind === kind);
  const { tracked, ...keys } = scoreKeys(ofKind('key'), screen);

  const samples = trials.flatMap((trial) => trial.samples);
  const lostCount = samples.filter(({ estimate }) => !estimate).length;
  const gaps = trials.reduce((sum, trial) => sum + Math.max(trial.samples.length - 1, 0), 0);
  const durationMs = trials.reduce((sum, { samples }) => sum + (samples.length ? samples.at(-1)!.t - samples[0].t : 0), 0);
  const samplesPerSecond = durationMs > 0 ? (gaps * 1000) / durationMs : 0;

  // The spec moves to MediaPipe only for jitter. A steady offset is a calibration problem.
  const tooJittery = keys.steadyKeySize > 0 && keysThatFit(keys.steadyKeySize, screen) < KEYS_NEEDED;
  const tooSlow = samplesPerSecond < MIN_SAMPLES_PER_SECOND;

  return {
    corners: { wake: scoreCorner(ofKind('wake')), stop: scoreCorner(ofKind('stop')) },
    keys,
    samplesPerSecond,
    lostShare: samples.length > 0 ? lostCount / samples.length : 0,
    verdict: !tracked ? 'no gaze data' : tooJittery || tooSlow ? 'try MediaPipe' : 'stay on WebGazer',
  };
}
