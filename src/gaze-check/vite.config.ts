import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

// WebGazer's face model is served from node_modules, so nothing is fetched from a CDN.
export default defineConfig({ root, publicDir: join(root, '../../node_modules/webgazer/dist/mediapipe') });
