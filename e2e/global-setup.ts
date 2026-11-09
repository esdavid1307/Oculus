import { execSync } from 'node:child_process';

// The tests launch out/main/index.js, so build it first. Skip with E2E_SKIP_BUILD=1 when it's already current.
export default function globalSetup() {
  if (process.env.E2E_SKIP_BUILD) return;
  execSync('npx electron-vite build', { stdio: 'inherit' });
}
