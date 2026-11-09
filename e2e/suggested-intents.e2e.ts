import { expect, FAKE_INTENTS, test, TIMINGS } from './oculus';

test('looking at the Centre Box wakes the agent', async ({ oculus }) => {
  await expect(oculus.page.locator('#wake')).toBeVisible();
  await oculus.look(oculus.centre);
  await oculus.expectPhase('waiting-for-target');
});

test('looking off the screen before the wake hold ends wakes nothing', async ({ oculus }) => {
  await oculus.look(oculus.centre);
  await oculus.page.waitForTimeout(200);
  await oculus.look(null);
  await oculus.page.waitForTimeout(1000);
  await expect(oculus.phase()).not.toHaveAttribute('data-phase', 'waiting-for-target');
});

test('holding on a target shows Thinking, then the Suggested Intents and Something else', async ({ oculus }) => {
  await oculus.look(oculus.centre);
  await oculus.expectPhase('waiting-for-target');
  await oculus.look(oculus.target);
  await oculus.expectPhase('thinking');
  await expect(oculus.page.locator('#status')).toContainText('Thinking');
  await oculus.expectPhase('choosing');
  for (const [i, intent] of FAKE_INTENTS.entries()) await expect(oculus.key(`intent-${i}`)).toContainText(intent);
  await expect(oculus.key('something-else')).toBeVisible();
});

test('the choices fill the screen in a 2 x 2 grid, Something else last', async ({ oculus }) => {
  await oculus.openIntents();
  // Layout positions, not bounding boxes: the lit key is drawn lifted, and keys animate in.
  const at = (id: string) => oculus.key(id).evaluate((key: HTMLElement) => ({ x: key.offsetLeft, y: key.offsetTop }));
  const [first, second, third, last] = await Promise.all(['intent-0', 'intent-1', 'intent-2', 'something-else'].map(at));
  expect(first.y).toBe(second.y);
  expect(first.x).toBeLessThan(second.x);
  expect(third.y).toBeGreaterThan(first.y);
  expect(last.x).toBeGreaterThan(third.x);
  expect(last.y).toBe(third.y);
});

test('the scan steps through the choices', async ({ oculus }) => {
  await oculus.openIntents();
  await expect(oculus.key('intent-0')).toHaveClass(/highlighted/);
  await expect(oculus.key('intent-1')).toHaveClass(/highlighted/, { timeout: 3000 });
  await expect(oculus.key('intent-0')).not.toHaveClass(/highlighted/);
});

test('the step bar fills over the scan step from config.json, not a guess', async ({ oculus }) => {
  await oculus.openIntents();
  const duration = await oculus.key('intent-0').evaluate((key) =>
    key.getAnimations({ subtree: true }).find((animation) => (animation.effect as KeyframeEffect | null)?.pseudoElement === '::after')?.effect?.getTiming().duration,
  );
  expect(duration).toBe(TIMINGS.scanStepMs);
});

test('Something else asks Claude again', async ({ oculus }) => {
  await oculus.openIntents();
  await oculus.choose('something-else');
  await oculus.expectPhase('thinking');
  await oculus.expectPhase('choosing');
  await expect(oculus.key('something-else')).toBeVisible();
});

test('looking away while choosing puts the agent back to sleep without running anything', async ({ oculus }) => {
  await oculus.openIntents();
  await oculus.look(null);
  await oculus.expectPhase('idle');
  await expect(oculus.page.locator('#status')).toBeHidden();
});

test('choosing an intent runs it and reports Done', async ({ oculus }) => {
  await oculus.openIntents();
  await oculus.choose('intent-1');
  await oculus.expectPhase('running');
  await expect(oculus.page.locator('#status')).toContainText(FAKE_INTENTS[1]);
  await oculus.expectPhase('finished');
  await expect(oculus.page.locator('#status')).toContainText('Done');
  await oculus.expectPhase('idle');
});

test('looking away during a run stops it', async ({ oculus }) => {
  await oculus.openIntents();
  await oculus.choose('intent-0');
  await oculus.expectPhase('running');
  await oculus.look(null);
  // The Stop Gesture: off the screen for lookAwayMs. A stopped run goes straight back to sleep.
  await oculus.expectPhase('idle');
});

test.describe('when Claude has nothing to suggest', () => {
  test.use({ env: { OCULUS_FAKE_INTENTS: '[]' } });

  test('says so and still offers Something else', async ({ oculus }) => {
    await oculus.openIntents();
    await expect(oculus.page.locator('#no-intents')).toBeVisible();
    await expect(oculus.key('something-else')).toBeVisible();
  });
});
