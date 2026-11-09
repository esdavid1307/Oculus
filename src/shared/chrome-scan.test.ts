import { describe, expect, it } from 'vitest';
import { chromeElements, MAX_CHROME_ELEMENTS, type RawElement } from './chrome-scan';

// The overlay covers a display whose top-left is at (0, 25) in screen points.
const display = { x: 0, y: 25, width: 1600, height: 1000 };
const gazeAt = { x: 480, y: 320, radius: 120 };
const raw = (role: string, name: string, x: number, y: number, width = 160, height = 90): RawElement => ({ role, name, x, y, width, height });

describe('chromeElements', () => {
  it('turns what the lookup found into Icons in overlay coordinates, nearest to the gaze first', () => {
    const found = [raw('AXLink', 'Why bridges stand', 250, 300), raw('AXLink', 'Lo-fi beats', 400, 300)];
    expect(chromeElements(found, gazeAt, display)).toEqual([
      { name: 'AXLink Lo-fi beats', label: 'Lo-fi beats', rect: { x: 400, y: 275, width: 160, height: 90 } },
      { name: 'AXLink Why bridges stand', label: 'Why bridges stand', rect: { x: 250, y: 275, width: 160, height: 90 } },
    ]);
  });

  it('keeps only elements the Gaze Region touches', () => {
    const found = [raw('AXButton', 'Skip Ad', 520, 340, 120, 40), raw('AXButton', 'Far away', 1400, 900, 80, 40)];
    expect(chromeElements(found, gazeAt, display).map(({ label }) => label)).toEqual(['Skip Ad']);
  });

  it('drops elements with no name, since the scan could only show an empty frame', () => {
    expect(chromeElements([raw('AXGroup', '  ', 420, 320)], gazeAt, display)).toEqual([]);
  });

  it('drops tiny elements and ones larger than a quarter of the screen, like the whole page', () => {
    const found = [raw('AXImage', 'dot', 470, 330, 6, 6), raw('AXWebArea', 'VideoTube', 0, 127, 1400, 813), raw('AXLink', 'Lo-fi beats', 400, 300)];
    expect(chromeElements(found, gazeAt, display).map(({ label }) => label)).toEqual(['Lo-fi beats']);
  });

  it('leaves text boxes to the Gaze Keyboard', () => {
    const found = ['AXTextField', 'AXTextArea', 'AXSearchField', 'AXComboBox'].map((role) => raw(role, 'Search', 420, 300, 300, 30));
    expect(chromeElements(found, gazeAt, display)).toEqual([]);
  });

  it('keeps one of several elements with the same bounds, such as a link and the text inside it', () => {
    const found = [raw('AXLink', 'Lo-fi beats', 400, 300), raw('AXStaticText', 'Lo-fi beats', 400, 300)];
    expect(chromeElements(found, gazeAt, display)).toHaveLength(1);
  });

  it(`never offers more than ${MAX_CHROME_ELEMENTS}, so one round of the scan stays short`, () => {
    const found = Array.from({ length: 10 }, (_, i) => raw('AXLink', `Video ${i}`, 380 + i * 4, 300 + i * 4));
    expect(chromeElements(found, gazeAt, display)).toHaveLength(MAX_CHROME_ELEMENTS);
  });

  it('cuts a long name and squeezes its white space, since names come from web pages', () => {
    const [element] = chromeElements([raw('AXLink', `  Lo-fi\n\n beats ${'x'.repeat(200)}`, 400, 300)], gazeAt, display);
    expect(element.label).toMatch(/^Lo-fi beats x+…$/);
    expect(element.label!.length).toBe(80);
  });

  it('ignores malformed entries from the helper', () => {
    const found = [{ role: 'AXLink', name: 'ok', x: 400, y: 300, width: 160, height: 90 }, { role: 'AXLink' }, null, { name: 'n', x: NaN, y: 0, width: 1, height: 1 }];
    expect(chromeElements(found as unknown as RawElement[], gazeAt, display).map(({ label }) => label)).toEqual(['ok']);
  });
});
