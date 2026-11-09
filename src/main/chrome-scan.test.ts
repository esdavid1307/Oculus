// Issue #22 test pass (2026-11-09): createChromeScan driven with a fake helper binary in place of oculus-ax, so the
// line protocol, ordering and timeouts are tested without Chrome.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChromeScan } from './chrome-scan';

const display = { x: 0, y: 0, width: 1800, height: 1169 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A helper that answers each lookup in order with one button at the point asked about. The first answer takes
// firstMs, like the first lookup on a heavy page, which also walks Chrome's tree.
function fakeHelper(firstMs: number) {
  const dir = mkdtempSync(join(tmpdir(), 'oculus-ax-fake-'));
  const binary = join(dir, 'oculus-ax');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
let queue = Promise.resolve(); let first = true;
require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const [x, y] = line.split(' ').map(Number); const delay = first ? ${firstMs} : 10; first = false;
  queue = queue.then(() => new Promise((done) => setTimeout(() => {
    process.stdout.write(JSON.stringify({ front: true, elements: [{ role: 'AXButton', name: 'At ' + x + ',' + y, x: x - 10, y: y - 10, width: 20, height: 20 }] }) + '\\n'); done();
  }, delay)));
});
`,
  );
  chmodSync(binary, 0o755);
  // A source older than the binary, so nothing is built.
  return createChromeScan({ source: join(dir, 'missing.swift'), binary, display, log: () => {} });
}

describe('createChromeScan with a fake helper', () => {
  it('turns an answer into the elements near the region asked about', async () => {
    const scan = fakeHelper(10);
    await wait(300);
    scan.look({ x: 500, y: 500, radius: 60 });
    await wait(300);
    expect(scan.elements().map(({ label }) => label)).toEqual(['At 500,500']);
    scan.stop();
  });

  it('asks at most every 300 ms, and clear() empties what was found', async () => {
    const scan = fakeHelper(10);
    await wait(300);
    scan.look({ x: 500, y: 500, radius: 60 });
    scan.look({ x: 900, y: 900, radius: 60 });
    await wait(200);
    expect(scan.elements().map(({ label }) => label)).toEqual(['At 500,500']);
    scan.clear();
    expect(scan.elements()).toEqual([]);
    scan.stop();
  });

  it('a null gaze empties what was found', async () => {
    const scan = fakeHelper(10);
    await wait(300);
    scan.look({ x: 500, y: 500, radius: 60 });
    await wait(400);
    scan.look(null);
    expect(scan.elements()).toEqual([]);
    scan.stop();
  });

  // Live, the first lookup took 699 ms on the mock page; on a heavy page it can pass REPLY_MS (1 s). The next lookup is
  // then sent while the old answer is still coming, the old answer is matched to the new region, and the new answer
  // to none.
  it('after one lookup takes longer than 1 second, the next answer still gives the elements at the new gaze', async () => {
    const scan = fakeHelper(1500);
    await wait(200);
    scan.look({ x: 300, y: 300, radius: 60 });
    await wait(1100);
    scan.look({ x: 900, y: 900, radius: 60 });
    await wait(800);
    expect(scan.elements().map(({ label }) => label)).toEqual(['At 900,900']);
    scan.stop();
  });
});
