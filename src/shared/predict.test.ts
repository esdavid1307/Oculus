import { describe, expect, it } from 'vitest';
import spokenEnglish from '../main/words/spoken-english.json';
import { contextOf, createPredictor, emptyWordModel, readWordModel, type BaseWords } from './predict';

const base = spokenEnglish as BaseWords;
const DAY = 24 * 60 * 60 * 1000;

describe('contextOf', () => {
  it('splits off the word being typed and the one before it', () => {
    expect(contextOf('i need wa')).toEqual({ prefix: 'wa', previous: 'need', before: ['i', 'need'] });
    expect(contextOf('i need ')).toEqual({ prefix: '', previous: 'need', before: ['i', 'need'] });
    expect(contextOf('')).toEqual({ prefix: '', previous: '', before: [] });
  });
});

describe('word prediction', () => {
  it('completes common spoken words before it has learned anything', () => {
    const suggestions = createPredictor(base).suggest('wh');
    expect(suggestions).toHaveLength(3);
    expect(suggestions).toEqual(expect.arrayContaining(['what']));
    for (const word of suggestions) expect(word.startsWith('wh')).toBe(true);
  });

  it('predicts the next word after a space', () => {
    expect(createPredictor(base).suggest('')).toEqual(expect.arrayContaining(['you']));
  });

  it('never suggests the word already typed, which Space would finish anyway', () => {
    expect(createPredictor(base).suggest('the')).not.toContain('the');
  });

  it('learns a new word from a single confirmed use', () => {
    const predictor = createPredictor(base);
    expect(predictor.suggest('my name is na')).not.toContain('nafi');
    predictor.learn('my name is nafi');
    expect(predictor.suggest('my name is na')[0]).toBe('nafi');
    expect(predictor.suggest('my name is ')[0]).toBe('nafi');
  });

  it("learns the user's own next word after a word", () => {
    const predictor = createPredictor(base);
    predictor.learn('i need water');
    predictor.learn('please bring water');
    expect(predictor.suggest('i need ')[0]).toBe('water');
  });

  it('prefers the words used recently', () => {
    const predictor = createPredictor(base);
    const now = 100 * DAY;
    predictor.learn('mango', now - 30 * DAY);
    predictor.learn('mango', now - 30 * DAY);
    predictor.learn('mangosteen', now - 60_000);
    predictor.learn('mangosteen', now - 60_000);
    expect(predictor.suggest('man', 3, now).indexOf('mangosteen')).toBeLessThan(predictor.suggest('man', 3, now).indexOf('mango'));
  });

  it('trains the neural ranker on what the user chose', () => {
    const predictor = createPredictor(base);
    const before = JSON.stringify(predictor.model().ranker);
    predictor.learn('can you open the window please');
    expect(JSON.stringify(predictor.model().ranker)).not.toBe(before);
  });

  it('learns words that are also built-in object keys, such as constructor', () => {
    const predictor = createPredictor(base);
    predictor.learn('the constructor came');
    expect(predictor.model().ranker.linear.every(Number.isFinite)).toBe(true);
    expect(predictor.suggest('the cons')[0]).toBe('constructor');
    expect(readWordModel(JSON.parse(JSON.stringify(predictor.model()))).words.constructor).toMatchObject({ count: 1 });
  });

  it('never learns from suggesting alone', () => {
    const predictor = createPredictor(base);
    predictor.suggest('hello there');
    expect(predictor.model().words).toEqual({});
  });

  it('gets better at the phrases this user says, the more they say them', () => {
    // Letters a scanning keyboard would select, word by word, when the right word can be picked from the top 3.
    const phrases = ['i need my medicine', 'please call my daughter', 'turn on the television', 'i am thirsty', 'thank you nurse'];
    const lettersToType = (predictor: ReturnType<typeof createPredictor>) =>
      phrases.reduce((total, phrase) => {
        let text = '';
        for (const word of phrase.split(' ')) {
          let typed = 0;
          while (typed < word.length && !predictor.suggest(text + word.slice(0, typed)).includes(word)) typed++;
          // Picking a suggestion is one selection, and typing the whole word ends with Space.
          total += typed < word.length ? typed + 1 : word.length + 1;
          text += word + ' ';
        }
        return total;
      }, 0);
    const predictor = createPredictor(base);
    const plain = phrases.join(' ').length + 1;
    const fresh = lettersToType(predictor);
    phrases.forEach((phrase) => predictor.learn(phrase));
    const once = lettersToType(predictor);
    expect(fresh).toBeLessThan(plain);
    expect(once).toBeLessThan(fresh / 2);
  });
});

describe('spoken English word list', () => {
  it('holds no contraction pieces, which would type a wrong word', () => {
    const words = new Set(base.map(([word]) => word));
    for (const piece of ['don', 'didn', 'isn', 're', 'll']) expect(words.has(piece)).toBe(false);
  });

  it('holds no strong swearing, which one blink would type', () => {
    for (const [word] of base) expect(word).not.toMatch(/^(fuck|motherf|shit|bitch|cunt|whore|slut)/);
  });
});

describe('saved word model', () => {
  it('survives a round trip through JSON', () => {
    const predictor = createPredictor(base);
    predictor.learn('see you tomorrow');
    const restored = createPredictor(base, readWordModel(JSON.parse(JSON.stringify(predictor.model()))));
    expect(restored.suggest('see you to')).toEqual(predictor.suggest('see you to'));
  });

  it('starts fresh from anything malformed', () => {
    for (const raw of [null, 'x', { version: 2 }, { ...emptyWordModel(), words: null }, { ...emptyWordModel(), ranker: { linear: [1] } }]) {
      expect(readWordModel(raw)).toEqual(emptyWordModel());
    }
  });
});

describe('Suggested Phrases', () => {
  const sent = (...texts: string[]) => {
    const predictor = createPredictor(base);
    texts.forEach((text, i) => predictor.learn(text, i * 1000));
    return predictor;
  };

  it('offers a submitted text once 2 letters match its start', () => {
    const predictor = sent('please call the nurse');
    expect(predictor.suggestPhrases('')).toEqual([]);
    expect(predictor.suggestPhrases('p')).toEqual([]);
    expect(predictor.suggestPhrases('pl')).toEqual(['please call the nurse']);
    expect(predictor.suggestPhrases('please c')).toEqual(['please call the nurse']);
  });

  it('matches case-insensitively', () => {
    const predictor = sent('Please call the nurse');
    expect(predictor.suggestPhrases('PL')).toEqual(['Please call the nurse']);
  });

  it('offers nothing for text that does not match, or is already the whole phrase', () => {
    const predictor = sent('please call the nurse');
    expect(predictor.suggestPhrases('pr')).toEqual([]);
    expect(predictor.suggestPhrases('please call the nurse')).toEqual([]);
  });

  it('offers up to 2 phrases, more frequent first', () => {
    const predictor = sent('i need water', 'i need a doctor', 'i need a doctor', 'i need help', 'i need help', 'i need help');
    expect(predictor.suggestPhrases('i n')).toEqual(['i need help', 'i need a doctor']);
  });

  it('caps the list at the requested limit', () => {
    const predictor = sent('i need water', 'i need a doctor', 'i need help', 'i need a lawyer');
    expect(predictor.suggestPhrases('i n', 2)).toHaveLength(2);
    expect(predictor.suggestPhrases('i n', 3)).toHaveLength(3);
  });

  it('prefers a recent phrase over an equally frequent old one', () => {
    const predictor = createPredictor(base);
    predictor.learn('i need water', 0);
    predictor.learn('i need a doctor', 30 * DAY);
    expect(predictor.suggestPhrases('i n', 2, 30 * DAY)[0]).toBe('i need a doctor');
  });

  it('never learns text with a space-free run of 16 or more characters', () => {
    const predictor = sent('my code is abcdefghijklmnop', 'hunter2hunter2hunter2');
    expect(predictor.suggestPhrases('my')).toEqual([]);
    expect(predictor.suggestPhrases('hu')).toEqual([]);
    expect(Object.keys(predictor.model().words)).toEqual([]);
    expect(sent('abcdefghijklmno long').suggestPhrases('ab')).toEqual(['abcdefghijklmno long']);
  });

  it('still loads a model file saved before phrases existed', () => {
    const { phrases: _phrases, ...old } = JSON.parse(JSON.stringify(createPredictor(base).model()));
    const predictor = createPredictor(base, readWordModel(old));
    expect(predictor.suggestPhrases('pl')).toEqual([]);
    predictor.learn('please call the nurse');
    expect(predictor.suggestPhrases('pl')).toEqual(['please call the nurse']);
  });

  it('survives a round trip through JSON and drops malformed phrases', () => {
    const predictor = sent('please call the nurse');
    const saved = JSON.parse(JSON.stringify(predictor.model()));
    saved.phrases.broken = { text: 5 };
    const restored = createPredictor(base, readWordModel(saved));
    expect(restored.suggestPhrases('pl')).toEqual(['please call the nurse']);
    expect(Object.keys(restored.model().phrases!)).toEqual(['please call the nurse']);
  });
});
