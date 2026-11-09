import { defineConfig } from '@playwright/test';

// End-to-end tests launch the built Electron app in test mode (OCULUS_GAZE=test). The overlay is one full-screen window,
// so the tests run one at a time.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
});
