// Word prediction for the Gaze Keyboard. Pure, so the session core and tests can drive it without Electron.
//
// Candidates come from a spoken-English word list and from the user's own words. A small neural ranker scores
// them. It starts from hand-set weights and learns from every confirmed word, so it suits this user within minutes.

// Most frequent first: [word, count].
export type BaseWords = [string, number][];

export type WordModel = {
  version: 1;
  // The user's own words: how often they confirmed each one, and when last.
  words: Record<string, { count: number; last: number }>;
  // previous word ('' at the start of the text) -> next word -> count.
  next: Record<string, Record<string, number>>;
  ranker: Ranker;
};

type Ranker = { linear: number[]; hidden: number[][]; hiddenBias: number[]; out: number[] };

export const FEATURES = [
  'base frequency',
  'own frequency',
  'recency',
  'follows the previous word',
  'share after the previous word',
  'letters saved',
  'already in the text',
] as const;
// What a sensible ranker does before it has learned anything. Training starts here and is pulled back towards it.
const PRIOR = [1.0, 1.2, 0.5, 3.0, 4.0, 0.15, 0.8];
const HIDDEN = 8;
const LEARNING_RATE = 0.15;
const STEPS_PER_EXAMPLE = 3;
const PRIOR_PULL = 0.02;
// A word used today counts for more than one from last week.
const RECENCY_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_OWN_WORDS = 5000;
const FROM_BASE_PER_PREFIX = 40;
const FROM_BASE_NEXT_WORD = 60;
// Each confirmed word is replayed as it was typed, from no letters up to this many, as training examples.
const REPLAYED_PREFIXES = 4;

const WORD = /^[a-z]+$/;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

export function emptyWordModel(seed = 7): WordModel {
  const random = seededRandom(seed);
  return {
    version: 1,
    words: {},
    next: {},
    ranker: {
      linear: [...PRIOR],
      hidden: Array.from({ length: HIDDEN }, () => FEATURES.map(() => random() * 0.6)),
      hiddenBias: Array(HIDDEN).fill(0),
      // Zero, so the hidden layer adds nothing until it has learned something.
      out: Array(HIDDEN).fill(0),
    },
  };
}

// A saved model comes from disk, so anything malformed starts fresh instead of breaking the keyboard.
export function readWordModel(raw: unknown): WordModel {
  const model = raw as WordModel | null | undefined;
  const ranker = model?.ranker;
  const sized = (list: unknown, length: number) => Array.isArray(list) && list.length === length && list.every((n) => Number.isFinite(n));
  const valid =
    model?.version === 1 &&
    typeof model.words === 'object' &&
    typeof model.next === 'object' &&
    sized(ranker?.linear, FEATURES.length) &&
    sized(ranker?.hiddenBias, HIDDEN) &&
    sized(ranker?.out, HIDDEN) &&
    Array.isArray(ranker?.hidden) &&
    ranker.hidden.length === HIDDEN &&
    ranker.hidden.every((row) => sized(row, FEATURES.length));
  return valid ? model : emptyWordModel();
}

// The word being typed and the one before it. After a space the word being typed is '', which predicts the next word.
export function contextOf(text: string) {
  const words = text.toLowerCase().split(' ');
  const prefix = words.pop() ?? '';
  const before = words.filter(Boolean);
  return { prefix, previous: before.at(-1) ?? '', before };
}

export function createPredictor(baseWords: BaseWords, model: WordModel = emptyWordModel()) {
  const baseCount = new Map(baseWords.map(([word, count]) => [word, count]));
  const topBase = baseWords.slice(0, FROM_BASE_NEXT_WORD).map(([word]) => word);
  // Alphabetical, so the words with a prefix are one contiguous run found by binary search.
  const alphabetical = baseWords.map(([word]) => word).sort();

  function baseWithPrefix(prefix: string) {
    let low = 0;
    let high = alphabetical.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (alphabetical[middle] < prefix) low = middle + 1;
      else high = middle;
    }
    const run: string[] = [];
    for (let i = low; i < alphabetical.length && alphabetical[i].startsWith(prefix); i++) run.push(alphabetical[i]);
    return run.sort((a, b) => baseCount.get(b)! - baseCount.get(a)!).slice(0, FROM_BASE_PER_PREFIX);
  }

  function candidates(prefix: string, previous: string) {
    const found = new Set<string>();
    if (prefix === '') {
      topBase.forEach((word) => found.add(word));
      Object.keys(model.next[previous] ?? {}).forEach((word) => found.add(word));
      Object.entries(model.words)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 30)
        .forEach(([word]) => found.add(word));
    } else {
      baseWithPrefix(prefix).forEach((word) => found.add(word));
      for (const word of Object.keys(model.words)) if (word.startsWith(prefix)) found.add(word);
    }
    // Suggesting what is already typed saves nothing: Space does the same. Nobody means the same word twice in a row.
    found.delete(prefix);
    found.delete(previous);
    return [...found];
  }

  function features(word: string, prefix: string, previous: string, before: string[], now: number) {
    const own = model.words[word];
    const after = model.next[previous] ?? {};
    const afterTotal = Object.values(after).reduce((sum, n) => sum + n, 0);
    return [
      Math.log10(1 + (baseCount.get(word) ?? 0)) / 7,
      Math.log2(1 + (own?.count ?? 0)) / 4,
      own ? Math.exp(-(now - own.last) / RECENCY_MS) : 0,
      Math.log2(1 + (after[word] ?? 0)) / 3,
      afterTotal ? (after[word] ?? 0) / afterTotal : 0,
      (word.length - prefix.length) / 8,
      // A name typed earlier in the text is likely again, but only once the user starts it: "my" isn't the next word after "my".
      prefix !== '' && before.includes(word) ? 1 : 0,
    ];
  }

  function score(input: number[]) {
    const { linear, hidden, hiddenBias, out } = model.ranker;
    const activations = hidden.map((row, j) => Math.tanh(row.reduce((sum, w, k) => sum + w * input[k], hiddenBias[j])));
    return {
      activations,
      value: linear.reduce((sum, w, k) => sum + w * input[k], 0) + out.reduce((sum, w, j) => sum + w * activations[j], 0),
    };
  }

  // One listwise step: raise the chosen word's share of a softmax over every candidate.
  function trainRanker(inputs: number[][], chosen: number) {
    const { ranker } = model;
    for (let step = 0; step < STEPS_PER_EXAMPLE; step++) {
      const scored = inputs.map(score);
      const top = Math.max(...scored.map(({ value }) => value));
      const exps = scored.map(({ value }) => Math.exp(value - top));
      const total = exps.reduce((sum, n) => sum + n, 0);
      inputs.forEach((input, i) => {
        const gradient = exps[i] / total - (i === chosen ? 1 : 0);
        const { activations } = scored[i];
        for (let j = 0; j < HIDDEN; j++) {
          const back = gradient * ranker.out[j] * (1 - activations[j] ** 2);
          ranker.out[j] -= LEARNING_RATE * gradient * activations[j];
          ranker.hiddenBias[j] -= LEARNING_RATE * back;
          for (let k = 0; k < input.length; k++) ranker.hidden[j][k] -= LEARNING_RATE * back * input[k];
        }
        for (let k = 0; k < input.length; k++) ranker.linear[k] -= LEARNING_RATE * gradient * input[k];
      });
      for (let k = 0; k < ranker.linear.length; k++) ranker.linear[k] -= PRIOR_PULL * (ranker.linear[k] - PRIOR[k]);
    }
  }

  function rank(prefix: string, previous: string, before: string[], now: number) {
    return candidates(prefix, previous)
      .map((word) => ({ word, input: features(word, prefix, previous, before, now) }))
      .map((candidate) => ({ ...candidate, score: score(candidate.input).value }))
      .sort((a, b) => b.score - a.score);
  }

  function forget() {
    const words = Object.entries(model.words);
    if (words.length <= MAX_OWN_WORDS) return;
    words.sort(([, a], [, b]) => a.count - b.count || a.last - b.last);
    for (const [word] of words.slice(0, words.length - MAX_OWN_WORDS)) delete model.words[word];
  }

  return {
    suggest(text: string, limit = 3, now = Date.now()): string[] {
      const { prefix, previous, before } = contextOf(text);
      if (!WORD.test(prefix) && prefix !== '') return [];
      return rank(prefix, previous, before, now)
        .slice(0, limit)
        .map(({ word }) => word);
    },

    // Called with text the user confirmed with Done. Stopped or discarded text never reaches it.
    learn(text: string, now = Date.now()) {
      const words = text.toLowerCase().split(/\s+/).filter((word) => WORD.test(word));
      words.forEach((word, i) => {
        const previous = words[i - 1] ?? '';
        const before = words.slice(0, i);
        // Replay the word as it was typed, before counting it, so the ranker learns from what it would have shown.
        for (let typed = 0; typed < Math.min(word.length, REPLAYED_PREFIXES); typed++) {
          const prefix = word.slice(0, typed);
          const ranked = rank(prefix, previous, before, now);
          const chosen = ranked.findIndex((candidate) => candidate.word === word);
          if (chosen >= 0) trainRanker(ranked.map(({ input }) => input), chosen);
        }
        const own = model.words[word] ?? { count: 0, last: now };
        model.words[word] = { count: own.count + 1, last: now };
        model.next[previous] ??= {};
        model.next[previous][word] = (model.next[previous][word] ?? 0) + 1;
      });
      forget();
    },

    model: () => model,
  };
}

export type Predictor = ReturnType<typeof createPredictor>;
