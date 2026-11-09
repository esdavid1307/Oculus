import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAgentConfig } from './config';
import { pngSize } from './frame';
import { suggestIntents } from './intents';

// Opt-in, real model: OCULUS_EVAL_SHOTS=<dir> holds <name>.png plus <name>.json
// ({ display: {width, height}, region: {x, y, radius}, expectFirst?, expectSome?, expectNone? }, the expects being regexes).
const dir = process.env.OCULUS_EVAL_SHOTS;
const TIMEOUT_MS = 120_000;

type Case = {
  display: { width: number; height: number };
  region: { x: number; y: number; radius: number };
  expectFirst?: string;
  expectSome?: string;
  expectNone?: string;
};
type Result = { name: string; intents: string[]; pass: boolean; ms: number };

const names = dir ? readdirSync(dir).flatMap((file) => (file.endsWith('.json') && file !== 'results.json' ? [file.slice(0, -5)] : [])) : [];
const results: Result[] = [];

describe.skipIf(!dir)('intents eval (real model)', () => {
  it('finds cases', () => expect(names.length, `no <name>.json cases in ${dir}`).toBeGreaterThan(0));

  for (const name of names) {
    it(name, { timeout: TIMEOUT_MS }, async () => {
      const spec: Case = JSON.parse(readFileSync(join(dir!, `${name}.json`), 'utf8'));
      const savedTo = resolve(dir!, `${name}.png`);
      const png = readFileSync(savedTo);
      const { width: imageWidth, height: imageHeight } = pngSize(png);
      const frame = { x: 0, y: 0, ...spec.display, imageWidth, imageHeight };
      const config = readAgentConfig(process.env, 'shortcut')!;
      const started = Date.now();
      const intents = (await suggestIntents(spec.region, [], config, async () => ({ png, frame, savedTo }), console.log)).map(({ text }) => text);
      const matches = (pattern: string, text: string) => new RegExp(pattern, 'i').test(text);
      const checks = [
        !spec.expectFirst || (intents[0] !== undefined && matches(spec.expectFirst, intents[0])),
        !spec.expectSome || intents.some((intent) => matches(spec.expectSome!, intent)),
        !spec.expectNone || !intents.some((intent) => matches(spec.expectNone!, intent)),
      ];
      const pass = checks.every(Boolean);
      results.push({ name, intents, pass, ms: Date.now() - started });
      writeFileSync(join(dir!, 'results.json'), JSON.stringify(results, null, 2));
      expect(pass, `${name}: ${JSON.stringify(intents)} (first, some, none ok: ${checks})`).toBe(true);
    });
  }
});
