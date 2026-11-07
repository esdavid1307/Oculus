export type Screen = { width: number; height: number };

export type Rect = { x: number; y: number; width: number; height: number };

export function contains(rect: Rect, x: number, y: number) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
