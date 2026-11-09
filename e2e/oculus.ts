import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Short timings, so a whole flow takes a few seconds. They go in config.json in the test's own user-data folder.
export const TIMINGS = { wakeHoldMs: 500, targetHoldMs: 300, scanStepMs: 700, lookAwayMs: 800, iconHoldMs: 3000, finishedMs: 800 };
export const FAKE_INTENTS = ['Open the first result', 'Scroll down', 'Copy the link'];

type Point = { x: number; y: number };

// Drives the overlay the way the camera does: a stream of gaze samples and Select Blinks sent from the page.
export class Oculus {
  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    readonly screen: { width: number; height: number },
  ) {}

  get centre(): Point {
    return { x: this.screen.width / 2, y: this.screen.height / 2 };
  }

  // Somewhere on the left, well off the Centre Box, so the Suggested Intents panel goes on the right.
  get target(): Point {
    return { x: this.screen.width * 0.15, y: this.screen.height * 0.3 };
  }

  // Where the gaze stream points from now on. null is no gaze, as when the camera loses the face.
  async look(at: Point | null) {
    await this.page.evaluate((region) => ((window as unknown as E2EWindow).__e2eGaze = region), at && { ...at, radius: 60 });
  }

  async select() {
    await this.page.evaluate(() => (window as unknown as E2EWindow).overlay.sendGaze({ type: 'select', t: Date.now() }));
  }

  phase() {
    return this.page.locator('html');
  }

  async expectPhase(phase: string) {
    await expect(this.phase()).toHaveAttribute('data-phase', phase);
  }

  key(id: string) {
    return this.page.locator(`.key[data-key="${id}"]`);
  }

  // Waits for the scan to light the key, then blinks.
  async choose(id: string) {
    await expect(this.key(id)).toHaveClass(/highlighted/, { timeout: 10_000 });
    await this.select();
  }

  // Wakes the agent on the Centre Box, then holds on the target until Claude's (stubbed) answer is up.
  async openIntents() {
    await this.look(this.centre);
    await this.expectPhase('waiting-for-target');
    await this.look(this.target);
    await this.expectPhase('choosing');
  }
}

type E2EWindow = { __e2eGaze: unknown; overlay: { sendGaze(input: unknown): void } };

export const test = base.extend<{ oculus: Oculus; env: Record<string, string> }>({
  env: [{}, { option: true }],
  oculus: async ({ env }, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'oculus-e2e-'));
    writeFileSync(join(userData, 'config.json'), JSON.stringify({ ...TIMINGS, largeView: false }));
    const app = await electron.launch({
      args: [resolve(__dirname, '..')],
      env: {
        ...process.env,
        OCULUS_GAZE: 'test',
        OCULUS_USER_DATA: userData,
        OCULUS_FAKE_INTENTS: JSON.stringify(FAKE_INTENTS),
        // Long enough for the tests to see Thinking before the answer lands.
        OCULUS_FAKE_INTENTS_MS: '1000',
        OCULUS_FAKE_RUN_MS: '1500',
        // The renderer is loaded from the build, never the dev server.
        ELECTRON_RENDERER_URL: '',
        ...env,
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // A sample every 33 ms, like the camera, pointing wherever look() last said.
    await page.evaluate(() => {
      const w = window as unknown as E2EWindow;
      w.__e2eGaze = null;
      setInterval(() => w.overlay.sendGaze({ type: 'gaze', t: Date.now(), region: w.__e2eGaze }), 33);
    });
    const screen = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await use(new Oculus(app, page, screen));
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  },
});

export { expect };
