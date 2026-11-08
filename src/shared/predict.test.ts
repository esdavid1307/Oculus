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

describe('saved word model', () => {
  it('survives a round trip through JSON', () => {
    const predictor = createPredictor(base);
    predictor.learn('see you tomorrow');
    const restored = createPredictor(base, readWordModel(JSON.parse(JSON.stringify(predictor.model()))));
    expect(restored.suggest('see you to')).toEqual(predictor.suggest('see you to'));
  });

  it('starts fresh from anything malformed', () => {
    for (const raw of [null, 'x', { version: 2 }, { ...emptyWordModel(), ranker: { linear: [1] } }]) {
      expect(readWordModel(raw)).toEqual(emptyWordModel());
    }
  });
});
