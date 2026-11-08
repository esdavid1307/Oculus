import { describe, expect, it } from 'vitest';
import { createIntentHistory, emptyIntentHistory, historyContext, parseIntentRanker, readIntentHistory } from './intent-history';

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

describe('neural ranker', () => {
  const neural = () => createIntentHistory(emptyIntentHistory(), 'neural');

  it('is chosen only by "neural", and anything else falls back to count and recency', () => {
    expect(parseIntentRanker('neural')).toBe('neural');
    for (const other of [undefined, null, 'count', 'Neural', 7, true, {}]) expect(parseIntentRanker(other)).toBe('count');
  });

  it('orders Intents like count and recency before it has learned anything', () => {
    const plain = createIntentHistory();
    const learned = neural();
    const uses: [string, number][] = [['a', 0], ['a', DAY], ['b', 2 * DAY], ['c', 3 * DAY], ['c', 4 * DAY], ['c', 5 * DAY], ['d', 40 * DAY], ['e', 41 * DAY], ['e', 41.5 * DAY]];
    // Replayed into the model directly, so the neural one never trains.
    for (const [intent, at] of uses) {
      plain.learn('Notes', intent, at);
      createIntentHistory(learned.model(), 'count').learn('Notes', intent, at);
    }
    expect(learned.suggest('Notes', 5, 45 * DAY)).toEqual(plain.suggest('Notes', 5, 45 * DAY));
  });

  it('raises a repeatedly confirmed Intent to the top, sooner than counting would', () => {
    const history = neural();
    const plain = createIntentHistory();
    for (const h of [history, plain]) {
      for (let i = 0; i < 4; i++) h.learn('Notes', 'Old favourite', i * DAY);
      h.learn('Notes', 'New habit', 30 * DAY);
    }
    expect(history.suggest('Notes', 1, 30 * DAY)).toEqual(['New habit']);
    let neuralAt = 0;
    let plainAt = 0;
    for (let i = 1; i <= 12; i++) {
      history.learn('Notes', 'New habit', 30 * DAY + i);
      plain.learn('Notes', 'New habit', 30 * DAY + i);
      if (!neuralAt && history.suggest('Notes', 1, 31 * DAY)[0] === 'New habit') neuralAt = i;
      if (!plainAt && plain.suggest('Notes', 1, 31 * DAY)[0] === 'New habit') plainAt = i;
    }
    expect(neuralAt).toBeGreaterThan(0);
    expect(neuralAt).toBeLessThanOrEqual(plainAt);
  });

  it('round-trips its weights through save and read', () => {
    const history = neural();
    for (let i = 0; i < 5; i++) {
      history.learn('Notes', 'a', i);
      history.learn('Notes', 'b', 10 + i);
    }
    const saved = JSON.parse(JSON.stringify(history.model()));
    expect(saved.ranker.linear).not.toEqual(emptyIntentHistory().ranker.linear);
    expect(readIntentHistory(saved).ranker).toEqual(history.model().ranker);
  });

  it('still loads a model saved without weights, starting from the prior', () => {
    const history = createIntentHistory();
    history.learn('Notes', 'Pause', 1000);
    const { ranker, ...old } = JSON.parse(JSON.stringify(history.model()));
    const loaded = readIntentHistory(old);
    expect(loaded.ranker).toEqual(emptyIntentHistory().ranker);
    expect(createIntentHistory(loaded, 'neural').suggest('Notes', 2, 1000)).toEqual(['Pause']);
  });

  it('does not train on the default ranking, so a switch later starts from the prior', () => {
    const history = createIntentHistory();
    for (let i = 0; i < 5; i++) history.learn('Notes', 'a', i);
    expect(history.model().ranker).toEqual(emptyIntentHistory().ranker);
  });
});

describe('historyContext', () => {
  it('is the app plus the domain in a browser', () => {
    expect(historyContext('Google Chrome', 'https://www.youtube.com/watch?v=1')).toBe('Google Chrome · youtube.com');
    expect(historyContext('Safari', 'https://mail.google.com/mail/u/0/#inbox')).toBe('Safari · mail.google.com');
    expect(historyContext('Safari', 'http://Example.com:8080/x')).toBe('Safari · example.com');
  });

  it('is the app alone when the site can not be read', () => {
    for (const url of [undefined, null, '', 'not a url', 'chrome://newtab/', 'file:///Users/a/b.html', 'about:blank']) {
      expect(historyContext('Google Chrome', url)).toBe('Google Chrome');
    }
  });

  it('is the app alone outside Chrome and Safari', () => {
    expect(historyContext('Mail', 'https://www.youtube.com')).toBe('Mail');
  });

  it('keeps app plus site and the app alone as separate histories', () => {
    const history = createIntentHistory();
    history.learn(historyContext('Google Chrome', 'https://youtube.com/watch'), 'Pause', 1);
    history.learn(historyContext('Google Chrome', 'https://mail.google.com'), 'Reply', 1);
    history.learn(historyContext('Google Chrome', null), 'Scroll down', 1);
    expect(history.suggest(historyContext('Google Chrome', 'https://www.youtube.com/'))).toEqual(['Pause']);
    expect(history.suggest(historyContext('Google Chrome', 'https://mail.google.com/x'))).toEqual(['Reply']);
    expect(history.suggest(historyContext('Google Chrome', null))).toEqual(['Scroll down']);
    expect(history.suggest(historyContext('Google Chrome', 'https://example.com'))).toEqual([]);
  });
});
