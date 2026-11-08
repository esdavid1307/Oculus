// Centre Box is 50 vmin × 50 vmin, centred on screen.
export const CENTRE_BOX_VMIN = 0.5;

type Position = { x: number; y: number };

export type Screen = { width: number; height: number };
// What the tracker reports. It only becomes a Gaze Region once a real gaze source gives it a radius.
export type Sample = { t: number; estimate: Position | null; eyesClosed?: boolean };
export type Target = Position & { kind: 'centre' | 'key' };
export type Trial = { target: Target; samples: Sample[] };

// The Start Gesture, as wakeHoldMs in session.ts.
const HOLD_MS = 3000;
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
export function smoother() {
  let recent: { t: number; estimate: Position }[] = [];
  return ({ t, estimate }: Sample): Sample => {
    if (!estimate) {
      recent = [];
      return { t, estimate };
    }
    recent = [...recent.filter((sample) => t - sample.t <= SMOOTHING_MS), { t, estimate }];
    return { t, estimate: meanOf(recent.map((sample) => sample.estimate)) };
  };
}

const smooth = (samples: Sample[]) => samples.map(smoother());

const percentile = (values: number[], share: number) =>
  [...values].sort((a, b) => a - b)[Math.max(Math.ceil(values.length * share) - 1, 0)] ?? 0;

const estimatesOf = (trial: Trial) => trial.samples.flatMap(({ estimate }) => (estimate ? [estimate] : []));

const chebyshev = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function longestHoldMs(trial: Trial, halfPx: number) {
  let start: number | null = null;
  let longest = 0;
  for (const { t, estimate } of trial.samples) {
    if (estimate && chebyshev(estimate, trial.target) <= halfPx) {
      start ??= t;
      longest = Math.max(longest, t - start);
    } else {
      start = null;
    }
  }
  return longest;
}

function scoreCentre(trials: Trial[], halfPx: number) {
  const errors = trials.flatMap((trial) => estimatesOf(trial).map((estimate) => chebyshev(estimate, trial.target)));
  return {
    trials: trials.length,
    hits: trials.filter((trial) => longestHoldMs(trial, halfPx) >= HOLD_MS).length,
    targetSize: 2 * percentile(errors, 0.95),
  };
}

function keysThatFit(keySize: number, screen: Screen) {
  if (keySize === 0) return 0;
  return Math.floor(screen.width / keySize) * Math.floor(screen.height / keySize);
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

// Where each target's gaze landed on average, which shows whether the error is a shift or a curve.
function scoreTargets(trials: Trial[]) {
  const targets = [...new Map(trials.map(({ target }) => [`${target.kind} ${target.x} ${target.y}`, target])).values()];
  return targets.map((target) => {
    const estimates = trials
      .filter((trial) => trial.target.kind === target.kind && trial.target.x === target.x && trial.target.y === target.y)
      .flatMap(estimatesOf);
    if (estimates.length === 0) return { ...target, offset: null };
    const { x, y } = meanOf(estimates);
    return { ...target, offset: { x: x - target.x, y: y - target.y } };
  });
}

export function scoreGazeCheck(rawTrials: Trial[], screen: Screen) {
  const trials = rawTrials.map((trial) => ({ ...trial, samples: smooth(trial.samples) }));
  const ofKind = (kind: Target['kind']) => trials.filter((trial) => trial.target.kind === kind);
  const { tracked, ...keys } = scoreKeys(ofKind('key'), screen);

  const centreBoxHalfPx = (Math.min(screen.width, screen.height) * CENTRE_BOX_VMIN) / 2;

  const samples = trials.flatMap((trial) => trial.samples);
  const lostCount = samples.filter(({ estimate }) => !estimate).length;
  const gaps = trials.reduce((sum, trial) => sum + Math.max(trial.samples.length - 1, 0), 0);
  const durationMs = trials.reduce((sum, { samples }) => sum + (samples.length ? samples.at(-1)!.t - samples[0].t : 0), 0);
  const samplesPerSecond = durationMs > 0 ? (gaps * 1000) / durationMs : 0;

  // Only jitter and rate rule a tracker out. A steady offset is a calibration problem.
  const tooJittery = keys.steadyKeySize > 0 && keysThatFit(keys.steadyKeySize, screen) < KEYS_NEEDED;
  const tooSlow = samplesPerSecond < MIN_SAMPLES_PER_SECOND;

  return {
    centre: scoreCentre(ofKind('centre'), centreBoxHalfPx),
    keys,
    targets: scoreTargets(trials),
    samplesPerSecond,
    lostShare: samples.length > 0 ? lostCount / samples.length : 0,
    verdict: !tracked
      ? 'no gaze data'
      : tooJittery || tooSlow
        ? 'too jittery or slow for a full keyboard'
        : 'steady enough for a full keyboard',
  };
}
