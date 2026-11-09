// Scan Pace: learns how fast this user presses once their key is highlighted, and sets the scan step to just cover
// it. Most of a scan is waiting on keys the user doesn't want, so every step saved counts on every key passed.
//
// Not a neural net on purpose: a few dozen reaction times are best summarised by a high quantile, and a quantile
// can't be thrown off the way a small net can.

export type ScanPaceModel = {
  version: 1;
  // Recent reaction times in ms: from the key lighting up to the Select Blink that chose it.
  reactions: number[];
  // The step in use, eased towards the target so the scan never lurches.
  stepMs: number | null;
};

export const MIN_STEP_MS = 900;
// Only once there's enough to go on.
export const MIN_SAMPLES = 12;
const WINDOW = 60;
// The step covers nearly all of this user's presses, with room to spare for a slow moment.
const QUANTILE = 0.95;
const MARGIN_MS = 350;
// Faster only when it saves at least a tenth of the step.
const MIN_GAIN = 0.9;
// How much of the way to the target the step moves after each press.
const EASE = 0.25;

export const emptyScanPace = (): ScanPaceModel => ({ version: 1, reactions: [], stepMs: null });

export function readScanPace(raw: unknown): ScanPaceModel {
  const model = raw as ScanPaceModel | null | undefined;
  const ok =
    model?.version === 1 &&
    Array.isArray(model.reactions) &&
    model.reactions.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
    (model.stepMs === null || (typeof model.stepMs === 'number' && Number.isFinite(model.stepMs)));
  return ok ? model : emptyScanPace();
}

const quantile = (values: number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

// base is the step the user set, or the default. Learning never makes the scan slower than half again of it.
export function createScanPace(base: number, model: ScanPaceModel = emptyScanPace()) {
  const maxStep = base * 1.5;
  let last: { offsetMs: number; stepMs: number } | null = null;

  function update() {
    if (model.reactions.length < MIN_SAMPLES) return;
    let target = Math.min(Math.max(quantile(model.reactions, QUANTILE) + MARGIN_MS, MIN_STEP_MS), maxStep);
    // A small speed-up isn't worth its rare late presses, so the user's own step stays unless the gain is real.
    // Slower than it is still allowed, for a user it's too fast for.
    if (target > base * MIN_GAIN && target <= base) target = base;
    const current = model.stepMs ?? base;
    model.stepMs = Math.round(current + (target - current) * EASE);
  }

  const remember = (reaction: number) => {
    model.reactions = [...model.reactions, reaction].slice(-WINDOW);
  };

  return {
    stepMs: () => Math.min(model.stepMs ?? base, maxStep),
    // offsetMs is how long the pressed key had been highlighted. undoes is true for a press that takes the last one
    // back, such as Back right after a letter group: that one landed a step late, so the user needed longer. A second
    // undo in a row has no late press to rewrite, so it's remembered as an ordinary reaction time, not re-interpreted.
    select(offsetMs: number, stepMs: number, undoes: boolean) {
      if (undoes && last) {
        // The press meant the key before, so the user took a whole step more than the offset that was recorded.
        model.reactions = model.reactions.slice(0, -1);
        remember(last.stepMs + last.offsetMs);
        // The undo itself was pressed on time.
        remember(offsetMs);
        last = null;
      } else {
        remember(offsetMs);
        // Only non-undoing presses can later be reinterpreted as mis-timed. Clearing last after an undo too keeps a
        // second undo in a row (a common Delete-Delete pattern) from rewriting the first undo's reaction.
        last = undoes ? null : { offsetMs, stepMs };
      }
      update();
    },
    model: () => model,
  };
}

export type ScanPace = ReturnType<typeof createScanPace>;
