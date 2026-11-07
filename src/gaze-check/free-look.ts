const BLINKS_TO_RECALIBRATE = 4;
// Four deliberate blinks fit easily, and natural blinks rarely come this fast.
const BLINK_WINDOW_MS = 3000;

// True once the condition has held without a break for the whole duration.
export function holdTimer(durationMs: number) {
  let since: number | null = null;
  return (t: number, holding: boolean) => {
    since = holding ? (since ?? t) : null;
    return since !== null && t - since >= durationMs;
  };
}

// True on the blink that completes the run, then starts counting again.
export function blinkCounter() {
  let wasClosed = false;
  let blinks: number[] = [];
  return (t: number, eyesClosed: boolean) => {
    if (eyesClosed && !wasClosed) blinks = [...blinks.filter((blink) => t - blink <= BLINK_WINDOW_MS), t];
    wasClosed = eyesClosed;
    if (blinks.length < BLINKS_TO_RECALIBRATE) return false;
    blinks = [];
    return true;
  };
}
