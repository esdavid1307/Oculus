import { describe, expect, it } from 'vitest';
import { createIntentHistory, emptyIntentHistory, readIntentHistory } from './intent-history';

const DAY = 24 * 60 * 60 * 1000;

describe('Intent History', () => {
  it('knows nothing before it has learned anything', () => {
    expect(createIntentHistory().suggest('Google Chrome')).toEqual([]);
  });

  it('ranks Intents used more often first', () => {
    const history = createIntentHistory();
    history.learn('Notes', 'Open the list', 1000);
    history.learn('Notes', 'Pause', 2000);
    history.learn('Notes', 'Pause', 3000);
    expect(history.suggest('Notes', 2, 3000)).toEqual(['Pause', 'Open the list']);
  });

  it('ranks a recent Intent above an old one used the same number of times', () => {
    const history = createIntentHistory();
    history.learn('Notes', 'Old habit', 0);
    history.learn('Notes', 'New habit', 30 * DAY);
    expect(history.suggest('Notes', 2, 31 * DAY)).toEqual(['New habit', 'Old habit']);
  });

  it('lets a lot of use beat a single recent use', () => {
    const history = createIntentHistory();
    for (let day = 0; day < 6; day++) history.learn('Notes', 'Usual', day * DAY);
    history.learn('Notes', 'Once', 6 * DAY);
    expect(history.suggest('Notes', 1, 7 * DAY)).toEqual(['Usual']);
  });

  it('offers at most 2 by default', () => {
    const history = createIntentHistory();
    for (const intent of ['a', 'b', 'c']) history.learn('Notes', intent, 1);
    expect(history.suggest('Notes')).toHaveLength(2);
  });

  it('keeps contexts separate, including an app on its own', () => {
    const history = createIntentHistory();
    history.learn('Google Chrome', 'Pause', 1);
    history.learn('Mail', 'Reply', 1);
    expect(history.suggest('Google Chrome')).toEqual(['Pause']);
    expect(history.suggest('Mail')).toEqual(['Reply']);
    expect(history.suggest('Google Chrome · youtube.com')).toEqual([]);
  });

  it('counts the same Intent in a different case as one', () => {
    const history = createIntentHistory();
    history.learn('Notes', 'Pause', 1);
    history.learn('Notes', 'pause', 2);
    expect(history.suggest('Notes', 5, 2)).toEqual(['pause']);
  });

  it('never learns skipping an ad', () => {
    const history = createIntentHistory();
    history.learn('Google Chrome', 'Skip the ad', 1);
    history.learn('Google Chrome', 'Skip ads', 1);
    expect(history.suggest('Google Chrome')).toEqual([]);
  });

  it('ignores an empty Intent or context', () => {
    const history = createIntentHistory();
    history.learn('Notes', '  ', 1);
    history.learn('', 'Pause', 1);
    expect(history.suggest('Notes')).toEqual([]);
    expect(history.suggest('')).toEqual([]);
  });

  it('round-trips through save and read', () => {
    const history = createIntentHistory();
    history.learn('Notes', 'Pause', 1000);
    history.learn('Notes', 'Pause', 2000);
    const reloaded = createIntentHistory(readIntentHistory(JSON.parse(JSON.stringify(history.model()))));
    expect(reloaded.suggest('Notes', 2, 2000)).toEqual(['Pause']);
    reloaded.learn('Notes', 'Mute', 3000);
    expect(reloaded.suggest('Notes', 2, 3000)).toHaveLength(2);
  });

  it('reads damaged data as empty', () => {
    for (const bad of [null, undefined, 'text', 7, [], {}, { version: 2, contexts: {} }, { version: 1 }, { version: 1, contexts: { a: { b: { text: 1 } } } }]) {
      expect(readIntentHistory(bad)).toEqual(emptyIntentHistory());
    }
  });

  it('is not poisoned by an Intent called constructor', () => {
    const history = createIntentHistory();
    history.learn('constructor', 'constructor', 1);
    expect(history.suggest('__proto__')).toEqual([]);
    expect(history.suggest('constructor', 2, 1)).toEqual(['constructor']);
  });
});
