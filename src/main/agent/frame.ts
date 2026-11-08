import type { Point, ScreenFrame } from './types';

type Bounds = { x: number; y: number; width: number; height: number };

// Keeps the display's aspect ratio, and never scales up.
export function fitScreenshot(bounds: Bounds, maxLongEdge: number): ScreenFrame {
  const scale = Math.min(1, maxLongEdge / Math.max(bounds.width, bounds.height));
  return { ...bounds, imageWidth: Math.round(bounds.width * scale), imageHeight: Math.round(bounds.height * scale) };
}

// Model pixels to screen points. Clamped, so a click on the image's edge stays on the display.
export function toScreenPoint(frame: ScreenFrame, [x, y]: [number, number]): Point {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    x: frame.x + clamp((x * frame.width) / frame.imageWidth, frame.width - 1),
    y: frame.y + clamp((y * frame.height) / frame.imageHeight, frame.height - 1),
  };
}

// Reads width and height from the IHDR chunk, to check what the model really sees.
export function pngSize(png: Buffer): { width: number; height: number } {
  const signature = '89504e470d0a1a0a';
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== signature || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Not a PNG');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
