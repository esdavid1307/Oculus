import { describe, expect, it } from 'vitest';
import { intentsPrompt, parseIntents } from './intents';

describe('intentsPrompt', () => {
  // A 1600 x 1000 display, sent to the model as a 1280 x 800 screenshot.
  const frame = { x: 0, y: 0, width: 1600, height: 1000, imageWidth: 1280, imageHeight: 800 };

  it('gives the Gaze Region in screenshot pixels, so it lines up with the image the model sees', () => {
    const prompt = intentsPrompt({ x: 800, y: 250, radius: 120 }, frame, []);
    expect(prompt).toContain('(640, 200)');
    expect(prompt).toContain('within about 96 pixels');
    expect(prompt).toContain('1280 x 800');
    expect(prompt).not.toContain('turned down');
  });

  it('asks for different suggestions than the ones turned down with Something else', () => {
    const prompt = intentsPrompt({ x: 800, y: 250, radius: 120 }, frame, ['Skip the ad', 'Pause']);
    expect(prompt).toContain('They turned down ["Skip the ad","Pause"], so suggest different ones.');
  });
});

describe('parseIntents', () => {
  it('reads the intents from the JSON reply', () => {
    expect(parseIntents('{"intents": ["Skip the ad", "Pause the video"]}')).toEqual(['Skip the ad', 'Pause the video']);
  });

  it('keeps at most 3, dropping blanks and anything that is not text', () => {
    expect(parseIntents('{"intents": ["  Mute ", "", 4, "Pause", "Like", "Share"]}')).toEqual(['Mute', 'Pause', 'Like']);
  });

  it('finds the JSON inside a reply with words around it', () => {
    expect(parseIntents('Here you go:\n```json\n{"intents": ["Open the first result"]}\n```')).toEqual(['Open the first result']);
  });

  it('gives no intents for a reply it cannot read, so the user still gets Something else', () => {
    expect(parseIntents('Sorry, I cannot see the screen.')).toEqual([]);
    expect(parseIntents('{"intents": "Skip the ad"}')).toEqual([]);
  });
});
