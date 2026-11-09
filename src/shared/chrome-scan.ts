// Gaze Scan in Chrome (#22): what the Accessibility lookup found around the gaze, made into the Icons a scan steps
// through. Pure, so it is tested without Chrome. The lookup itself is scripts/oculus-ax.swift.
import type { GazeRegion } from './gaze';
import type { Rect } from './geometry';
import type { Icon } from './session';

// One element as the helper reports it: its AX role, a name a person can read, and its frame in screen points.
export type RawElement = { role: string; name: string; x: number; y: number; width: number; height: number };

// Six steps of 2 seconds: one round of the scan stays under 12 seconds.
export const MAX_CHROME_ELEMENTS = 6;
const MAX_NAME_CHARS = 80;
// Smaller than this can't be seen in its highlight.
const MIN_SIDE = 8;
// Text boxes open the Gaze Keyboard with the 1 second hold instead (#13).
const TEXT_ROLES = new Set(['AXTextField', 'AXTextArea', 'AXSearchField', 'AXComboBox']);

const distance = ({ x, y }: GazeRegion, rect: Rect) =>
  Math.hypot(Math.max(rect.x - x, 0, x - (rect.x + rect.width)), Math.max(rect.y - y, 0, y - (rect.y + rect.height)));

const cut = (name: string) => {
  const squeezed = name.replace(/\s+/g, ' ').trim();
  return squeezed.length > MAX_NAME_CHARS ? `${squeezed.slice(0, MAX_NAME_CHARS - 1)}…` : squeezed;
};

const usable = (element: unknown): element is RawElement => {
  const e = element as RawElement | null;
  return typeof e?.role === 'string' && typeof e.name === 'string' && [e.x, e.y, e.width, e.height].every(Number.isFinite);
};

// region is the Gaze Region in overlay coordinates, display the overlay's bounds in screen points.
export function chromeElements(found: RawElement[], region: GazeRegion, display: Rect): Icon[] {
  const quarter = (display.width * display.height) / 4;
  const seen = new Set<string>();
  return found
    .filter(usable)
    .flatMap(({ role, name, x, y, width, height }) => {
      const label = cut(name);
      const rect = { x: x - display.x, y: y - display.y, width, height };
      const key = [rect.x, rect.y, width, height].map(Math.round).join();
      if (label === '' || TEXT_ROLES.has(role) || width < MIN_SIDE || height < MIN_SIDE || width * height > quarter) return [];
      if (distance(region, rect) > region.radius || seen.has(key)) return [];
      seen.add(key);
      return [{ name: `${role} ${label}`, label, rect }];
    })
    .sort((a, b) => distance(region, a.rect) - distance(region, b.rect))
    .slice(0, MAX_CHROME_ELEMENTS);
}
