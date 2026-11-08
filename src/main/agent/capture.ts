import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { desktopCapturer, type BrowserWindow, type Display } from 'electron';
import { fitScreenshot, pngSize } from './frame';
import { pickScreenSource, SCREEN_RECORDING_HINT } from './screen-source';
import { MODEL_MAX_LONG_EDGE, OVERLAY_HIDE_SETTLE_MS, type Capture } from './types';

type CaptureOptions = { overlay: BrowserWindow; display: Display; saveDir: string | null; hideOverlay: boolean };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Opacity 0 keeps the window's level and click-through intact, unlike hide() and showInactive().
// Fallback if the overlay still shows at opacity 0: overlay.hide(), capture, overlay.showInactive(), then
// re-apply setAlwaysOnTop(true, 'screen-saver') and setIgnoreMouseEvents(true).
export function createCapture({ overlay, display, saveDir, hideOverlay }: CaptureOptions): Capture {
  const frame = fitScreenshot(display.bounds, MODEL_MAX_LONG_EDGE);
  let count = 0;

  return async () => {
    if (hideOverlay) {
      overlay.setOpacity(0);
      await sleep(OVERLAY_HIDE_SETTLE_MS);
    }
    let image;
    try {
      // Denied Screen Recording makes getSources reject ("Failed to get sources.") instead of returning nothing.
      const sources = await desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: frame.imageWidth, height: frame.imageHeight } })
        // The rejection isn't always an Error, so its message can be missing.
        .catch((error: unknown) => {
          throw new Error(`${SCREEN_RECORDING_HINT} (${error instanceof Error ? error.message : String(error)})`);
        });
      image = pickScreenSource(sources, display.id).thumbnail;
    } finally {
      if (hideOverlay) overlay.setOpacity(1);
    }
    if (image.isEmpty()) throw new Error(SCREEN_RECORDING_HINT);

    let png = image.toPNG();
    let size = pngSize(png);
    if (size.width !== frame.imageWidth || size.height !== frame.imageHeight) {
      png = image.resize({ width: frame.imageWidth, height: frame.imageHeight, quality: 'best' }).toPNG();
      size = pngSize(png);
    }
    if (size.width !== frame.imageWidth || size.height !== frame.imageHeight) {
      throw new Error(`Screenshot is ${size.width}x${size.height}, expected ${frame.imageWidth}x${frame.imageHeight}`);
    }

    count += 1;
    let savedTo: string | null = null;
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
      savedTo = join(saveDir, `shot-${count}.png`);
      writeFileSync(savedTo, png);
    }
    return { png, frame, savedTo };
  };
}
