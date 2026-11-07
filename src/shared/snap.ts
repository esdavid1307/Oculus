import { offScreen, type GazeRegion } from './gaze';
import { contains, type Rect, type Screen } from './geometry';

const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// How far a point is outside the rect, 0 inside it.
function distancePast({ x, y, width, height }: Rect, px: number, py: number) {
  return Math.hypot(Math.max(x - px, 0, px - x - width), Math.max(y - py, 0, py - y - height));
}

// Gaze Snap: holds the element under the Gaze Region until its centre stays far enough past the edge for long enough.
// Elements are matched by bounds, so an identical element on a redrawn screen keeps the snap.
export function createGazeSnap(screen: Screen, { releasePx, releaseMs }: { releasePx: number; releaseMs: number }) {
  const maxArea = (screen.width * screen.height) / 4;
  let snapped: Rect | undefined;
  let pastSince: number | null = null;
  return (t: number, region: GazeRegion | null, elements: Rect[]): Rect | undefined => {
    const held = snapped;
    snapped = held && elements.find((rect) => same(rect, held));
    if (region === null || offScreen(region, screen)) snapped = undefined;
    else if (snapped && distancePast(snapped, region.x, region.y) > releasePx) {
      pastSince ??= t;
      if (t - pastSince >= releaseMs) snapped = undefined;
    } else pastSince = null;
    if (snapped === undefined && region !== null) {
      pastSince = null;
      snapped = elements.find((rect) => rect.width * rect.height <= maxArea && contains(rect, region.x, region.y));
    }
    return snapped;
  };
}
