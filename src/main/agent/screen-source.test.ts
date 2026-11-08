import { describe, expect, it } from 'vitest';
import { pickScreenSource } from './screen-source';

describe('pickScreenSource', () => {
  const sources = [
    { display_id: '11', name: 'external' },
    { display_id: '22', name: 'built-in' },
  ];

  it('matches the display by id', () => {
    expect(pickScreenSource(sources, 22).name).toBe('built-in');
  });

  it('falls back to the first source when no id matches', () => {
    expect(pickScreenSource(sources, 99).name).toBe('external');
  });

  it('throws a Screen Recording hint when there are no sources', () => {
    expect(() => pickScreenSource([], 1)).toThrow(/grant Screen Recording/);
  });
});
