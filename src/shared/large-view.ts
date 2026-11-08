import type { Rect, Screen } from './geometry';

// Large View makes everything outside the Gaze Keyboard big enough to see and hit with a webcam's gaze, which is far
// less precise than eye-tracking hardware (Feit et al., CHI 2017). WCAG 2.5.5 asks for 44 px at least.
export type LargeView = { enabled: boolean; uiScale: number; dockIconSize: number };

const DEFAULTS: LargeView = { enabled: true, uiScale: 1.25, dockIconSize: 96 };
const UI_SCALE_RANGE = [1, 2] as const;
// macOS caps the Dock icon size at 128, and its own default is about 48.
const DOCK_ICON_RANGE = [48, 128] as const;

// The smallest highlight frame, before scaling. Menu bar items are only about 22 high.
export const MIN_TARGET = 96;

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(Math.max(value, min), max);

// The settings come from a file the user edits, so anything unusable falls back to its default.
export function readLargeView(settings: unknown): LargeView {
  const raw = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<string, unknown>;
  const number = (key: string, range: readonly [number, number], fallback: number) => {
    const value = raw[key];
    return typeof value === 'number' && Number.isFinite(value) ? clamp(value, range) : fallback;
  };
  return {
    enabled: raw.largeView !== false,
    uiScale: number('uiScale', UI_SCALE_RANGE, DEFAULTS.uiScale),
    dockIconSize: Math.round(number('dockIconSize', DOCK_ICON_RANGE, DEFAULTS.dockIconSize)),
  };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

// frame is the icon's highlight grown to a size that is easy to see. panel is where its name is shown large, on the
// side of the screen away from the icon, so it never covers it. Icons sit on the edges: the Dock at the bottom or a
// side, the menu bar at the top, Desktop icons at the right.
export function magnify(icon: Rect, { width, height }: Screen, uiScale: number): { frame: Rect; panel: Rect } {
  const min = Math.min(MIN_TARGET * uiScale, width, height);
  const frameWidth = Math.min(Math.max(icon.width, min), width);
  const frameHeight = Math.min(Math.max(icon.height, min), height);
  const c = centre(icon);
  const frame = {
    x: Math.min(Math.max(c.x - frameWidth / 2, 0), width - frameWidth),
    y: Math.min(Math.max(c.y - frameHeight / 2, 0), height - frameHeight),
    width: frameWidth,
    height: frameHeight,
  };

  const panelWidth = width * 0.6;
  const panelHeight = height * 0.25;
  const middle = (width - panelWidth) / 2;
  const at = (x: number, y: number): Rect => ({ x, y, width: panelWidth, height: panelHeight });
  // Near the middle first, then pushed to the edges for an icon that is in the middle itself.
  const candidates = [at(middle, height * 0.55), at(middle, height * 0.2), at(middle, height - panelHeight), at(middle, 0), at(0, height * 0.375), at(width - panelWidth, height * 0.375)];
  const away = (r: Rect) => Math.hypot(centre(r).x - c.x, centre(r).y - c.y);
  const clear = candidates.filter((candidate) => !overlaps(candidate, frame));
  // The clear spot furthest from the icon is the one on the other side of the screen.
  const panel = (clear.length > 0 ? clear : candidates).reduce((best, next) => (away(next) > away(best) ? next : best));
  return { frame, panel };
}

// What to do about the Dock's icon size at launch, given whether Large View is on and what an earlier run saved.
// saved is the user's own size, or null if they never set one. undefined means nothing is saved.
export type DockPlan = { type: 'grow'; saveOriginal: boolean } | { type: 'restore'; tilesize: number | null } | { type: 'leave' };

export function planDock(enabled: boolean, saved: { tilesize: number | null } | undefined): DockPlan {
  // A saved size is never overwritten: after a crash the Dock is still large, and reading it again would lose the original.
  if (enabled) return { type: 'grow', saveOriginal: saved === undefined };
  return saved === undefined ? { type: 'leave' } : { type: 'restore', tilesize: saved.tilesize };
}

// dock-size.json comes off disk, so anything that isn't a size or null counts as nothing saved.
export function readSavedDock(raw: unknown): { tilesize: number | null } | undefined {
  const tilesize = (raw as { tilesize?: unknown } | null | undefined)?.tilesize;
  if (tilesize === null) return { tilesize: null };
  return typeof tilesize === 'number' && Number.isFinite(tilesize) && tilesize > 0 ? { tilesize } : undefined;
}
