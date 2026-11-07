import { CORNER_TARGET_SIZE } from '../shared/session';

type Point = { x: number; y: number };
type Screen = { width: number; height: number };

export type Sample = { t: number; point: Point | null };
export type Target = Point & { kind: 'wake' | 'stop' | 'key' };
export type Trial = { target: Target; samples: Sample[] };

const WAKE_HOLD_MS = 2000;
const SMOOTHING_MS = 300;
// 26 letters, space, delete and done.
const KEYS_NEEDED = 29;
// The minimum rate in docs/gaze-events.md.
const MIN_SAMPLES_PER_SECOND = 10;

// A real gaze source must smooth before sending (docs/gaze-events.md), so score what it would send.
function smooth(samples: Sample[]): Sample[] {
  let window: { t: number; point: Point }[] = [];
  return samples.map(({ t, point }) => {
    if (!point) {
      window = [];
      return { t, point };
    }
    window = [...window.filter((sample) => t - sample.t <= SMOOTHING_MS), { t, point }];
    const mean = (axis: 'x' | 'y') => window.reduce((sum, sample) => sum + sample.point[axis], 0) / window.length;
    return { t, point: { x: mean('x'), y: mean('y') } };
  });
}

const percentile = (values: number[], share: number) =>
  [...values].sort((a, b) => a - b)[Math.max(Math.ceil(values.length * share) - 1, 0)] ?? 0;

const pointsOf = (trial: Trial) => trial.samples.flatMap(({ point }) => (point ? [point] : []));

// How large a corner target must be for this point to land on it. Points past the screen edge still count.
function cornerSizeNeeded({ x, y }: Point, kind: Target['kind'], screen: Screen) {
  return kind === 'wake' ? Math.max(screen.width - x, y, 0) : Math.max(x, screen.height - y, 0);
}

function longestHoldMs(trial: Trial, screen: Screen) {
  let start: number | null = null;
  let longest = 0;
  for (const { t, point } of trial.samples) {
    if (point && cornerSizeNeeded(point, trial.target.kind, screen) <= CORNER_TARGET_SIZE) {
      start ??= t;
      longest = Math.max(longest, t - start);
    } else {
      start = null;
    }
  }
  return longest;
}

function scoreCorner(trials: Trial[], screen: Screen) {
  return {
    trials: trials.length,
    hits: trials.filter((trial) => longestHoldMs(trial, screen) >= WAKE_HOLD_MS).length,
    targetSize: percentile(
      trials.flatMap((trial) => pointsOf(trial).map((point) => cornerSizeNeeded(point, trial.target.kind, screen))),
      0.95,
    ),
  };
}

function scoreKeys(trials: Trial[], screen: Screen) {
  const offsets = trials.flatMap((trial) =>
    pointsOf(trial).map(({ x, y }) => ({ x: x - trial.target.x, y: y - trial.target.y })),
  );
  const jitters = trials.flatMap((trial) => {
    const points = pointsOf(trial);
    const mean = (axis: 'x' | 'y') => points.reduce((sum, point) => sum + point[axis], 0) / points.length;
    return points.map(({ x, y }) => Math.hypot(x - mean('x'), y - mean('y')));
  });
  const keySize = 2 * percentile(offsets.map(({ x, y }) => Math.max(Math.abs(x), Math.abs(y))), 0.95);
  const cellsPerCorner = Math.ceil(CORNER_TARGET_SIZE / keySize) ** 2;
  const grid = Math.floor(screen.width / keySize) * Math.floor(screen.height / keySize);
  return {
    medianError: percentile(offsets.map(({ x, y }) => Math.hypot(x, y)), 0.5),
    jitter: percentile(jitters, 0.5),
    keySize,
    keysThatFit: keySize > 0 ? Math.max(grid - 2 * cellsPerCorner, 0) : 0,
  };
}

export function scoreGazeCheck(rawTrials: Trial[], screen: Screen) {
  const trials = rawTrials.map((trial) => ({ ...trial, samples: smooth(trial.samples) }));
  const ofKind = (kind: Target['kind']) => trials.filter((trial) => trial.target.kind === kind);
  const corners = { wake: scoreCorner(ofKind('wake'), screen), stop: scoreCorner(ofKind('stop'), screen) };
  const keys = scoreKeys(ofKind('key'), screen);

  const sampleCount = trials.reduce((sum, trial) => sum + trial.samples.length, 0);
  const lostCount = trials.reduce((sum, trial) => sum + trial.samples.filter(({ point }) => !point).length, 0);
  const seconds = trials.reduce((sum, { samples }) => sum + (samples.length ? samples.at(-1)!.t - samples[0].t : 0) / 1000, 0);
  const samplesPerSecond = seconds > 0 ? sampleCount / seconds : 0;

  const cornersHold = [corners.wake, corners.stop].every(({ hits, trials }) => trials > 0 && hits === trials);
  const goodEnough = cornersHold && keys.keysThatFit >= KEYS_NEEDED && samplesPerSecond >= MIN_SAMPLES_PER_SECOND;

  return {
    corners,
    keys,
    samplesPerSecond,
    lostShare: sampleCount > 0 ? lostCount / sampleCount : 0,
    verdict: goodEnough ? 'stay on WebGazer' : 'try MediaPipe',
  };
}
