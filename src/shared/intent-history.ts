// Intent History: the Intents this user chose before that ran fine, per app and site. Pure, so the session core and
// tests can drive it without Electron.
//
// The context is a string: the frontmost app, for example "Google Chrome", or the app plus the site, for example
// "Google Chrome · youtube.com" (see historyContext). Past Intents are ranked by how often and
// how recently they were used. A small neural ranker, built like the Suggested Word ranker, can rank them instead.
import { seededRandom } from './predict';
import { isSkipAd } from './skip-ad';

export type HistoryEntry = {
  // As the user last saw it. Matching ignores case.
  text: string;
  count: number;
  last: number;
  // Uses counted so that older ones fade, as of `last`. Ranking fades it further by the time since.
  heat: number;
};

export type IntentHistoryModel = {
  version: 1;
  // context -> lowercased Intent -> entry.
  contexts: Record<string, Record<string, HistoryEntry>>;
  // The neural ranker's weights. Missing in a model saved before the ranker existed, which then starts from the prior.
  ranker: Ranker;
};

type Ranker = { linear: number[]; hidden: number[][]; hiddenBias: number[]; out: number[] };

// 'count' is the plain count and recency ranking. 'neural' is chosen with "intentRanker": "neural" in config.json.
export type RankerKind = 'count' | 'neural';

// Anything unusable falls back to the default, since the setting comes from a file the user edits.
export const parseIntentRanker = (value: unknown): RankerKind => (value === 'neural' ? 'neural' : 'count');

export const FEATURES = ['recency-weighted count', 'count', 'recency', 'share of this app\'s uses'] as const;
// Only the first weight is set, so before learning the order is the order of the recency-weighted count.
// Training starts here and is pulled back towards it.
const PRIOR = [1, 0, 0, 0];
const HIDDEN = 4;
const LEARNING_RATE = 0.3;
const STEPS_PER_EXAMPLE = 3;
const PRIOR_PULL = 0.02;

// An Intent used today counts for more than one from last month.
const RECENCY_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PER_CONTEXT = 40;
const MAX_CONTEXTS = 300;

// Keyed by app and typed text, so no inherited keys: a plain {} already has 'constructor'.
const table = <T>(entries: Record<string, T> = {}): Record<string, T> => Object.assign(Object.create(null), entries);

function freshRanker(seed = 11): Ranker {
  const random = seededRandom(seed);
  return {
    linear: [...PRIOR],
    hidden: Array.from({ length: HIDDEN }, () => FEATURES.map(() => random() * 0.6)),
    hiddenBias: Array(HIDDEN).fill(0),
    // Zero, so the hidden layer adds nothing until it has learned something.
    out: Array(HIDDEN).fill(0),
  };
}

// The history context: the app, plus ` · <domain>` for a browser whose front tab's URL could be read.
// A missing, odd or non-web URL gives the app alone, so history keeps working without the site.
export function historyContext(app: string, url?: string | null): string {
  if (!BROWSERS.includes(app) || !url) return app;
  try {
    const { protocol, hostname } = new URL(url);
    // The URL parser already lowercases the host, and an http(s) URL always has one.
    return protocol === 'https:' || protocol === 'http:' ? `${app}${SITE}${hostname.replace(/^www\./, '')}` : app;
  } catch {
    return app;
  }
}

const SITE = ' · ';

// The browsers whose front tab Oculus reads. Safari is left out: it can't tell a script whether a window is private.
export const BROWSERS = ['Google Chrome'];

export function emptyIntentHistory(): IntentHistoryModel {
  return { version: 1, contexts: table(), ranker: freshRanker() };
}

const fade = (elapsed: number) => Math.exp(-Math.max(elapsed, 0) / RECENCY_MS);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// A saved model comes from disk, so anything malformed starts fresh instead of breaking the picker.
export function readIntentHistory(raw: unknown): IntentHistoryModel {
  const model = raw as IntentHistoryModel | null | undefined;
  const isEntry = (entry: unknown): entry is HistoryEntry => {
    const e = entry as HistoryEntry | null;
    return typeof e?.text === 'string' && [e.count, e.last, e.heat].every((n) => Number.isFinite(n));
  };
  const valid =
    model?.version === 1 &&
    isObject(model.contexts) &&
    Object.values(model.contexts).every((entries) => isObject(entries) && Object.values(entries).every(isEntry));
  if (!valid) return emptyIntentHistory();
  const ranker = model.ranker;
  const sized = (list: unknown, length: number) => Array.isArray(list) && list.length === length && list.every((n) => Number.isFinite(n));
  const rankerValid =
    sized(ranker?.linear, FEATURES.length) &&
    sized(ranker?.hiddenBias, HIDDEN) &&
    sized(ranker?.out, HIDDEN) &&
    Array.isArray(ranker?.hidden) &&
    ranker.hidden.length === HIDDEN &&
    ranker.hidden.every((row) => sized(row, FEATURES.length));
  const contexts = table<Record<string, HistoryEntry>>();
  for (const [context, entries] of Object.entries(model.contexts)) contexts[context] = table(entries);
  return { version: 1, contexts, ranker: rankerValid ? ranker : freshRanker() };
}

export function createIntentHistory(model: IntentHistoryModel = emptyIntentHistory(), kind: RankerKind = 'count') {
  const heatNow = (entry: HistoryEntry, now: number) => entry.heat * fade(now - entry.last);

  function features(entry: HistoryEntry, total: number, now: number) {
    const heat = heatNow(entry, now);
    return [heat / (1 + heat), Math.log2(1 + entry.count) / 4, fade(now - entry.last), total ? entry.count / total : 0];
  }

  function score(input: number[]) {
    const { linear, hidden, hiddenBias, out } = model.ranker;
    const activations = hidden.map((row, j) => Math.tanh(row.reduce((sum, w, k) => sum + w * input[k], hiddenBias[j])));
    return {
      activations,
      value: linear.reduce((sum, w, k) => sum + w * input[k], 0) + out.reduce((sum, w, j) => sum + w * activations[j], 0),
    };
  }

  // The context's entries, best first. Both rankings break ties by the most recent use.
  function rank(context: string, now: number) {
    const entries = Object.values(model.contexts[context] ?? {});
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    return entries
      .map((entry) => {
        const input = features(entry, total, now);
        return { entry, input, score: kind === 'neural' ? score(input).value : heatNow(entry, now) };
      })
      .sort((a, b) => b.score - a.score || b.entry.last - a.entry.last);
  }

  // One listwise step: raise the confirmed Intent's share of a softmax over everything the context could have offered.
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

  function forget(context: string, now: number) {
    const entries = Object.entries(model.contexts[context]);
    if (entries.length > MAX_PER_CONTEXT) {
      entries.sort(([, a], [, b]) => heatNow(b, now) - heatNow(a, now));
      for (const [key] of entries.slice(MAX_PER_CONTEXT)) delete model.contexts[context][key];
    }
    const contexts = Object.keys(model.contexts);
    if (contexts.length > MAX_CONTEXTS) {
      const newest = (name: string) => Math.max(...Object.values(model.contexts[name]).map((entry) => entry.last));
      contexts.sort((a, b) => newest(a) - newest(b));
      for (const name of contexts.slice(0, contexts.length - MAX_CONTEXTS)) delete model.contexts[name];
    }
  }

  return {
    // The best past Intents for this context, best first. A site with too few is topped up from the app's own
    // history, which also keeps what was learned per app before history was kept per site.
    suggest(context: string, limit = 2, now = Date.now()): string[] {
      const best = rank(context, now).map(({ entry }) => entry.text);
      const at = context.indexOf(SITE);
      if (at >= 0) {
        const seen = new Set(best.map((text) => text.toLowerCase()));
        for (const { entry } of rank(context.slice(0, at), now)) if (!seen.has(entry.text.toLowerCase())) best.push(entry.text);
      }
      return best.slice(0, limit);
    },

    // Called with an Intent whose run finished ok. Failed or stopped runs never reach it.
    learn(context: string, intent: string, now = Date.now()) {
      const text = intent.trim();
      // "Skip the ad" is offered whenever an ad plays, so remembering it would only offer it when there is no ad.
      if (context === '' || text === '' || isSkipAd(text)) return;
      const entries = (model.contexts[context] ??= table());
      const key = text.toLowerCase();
      const old = entries[key];
      // Learn from what would have been shown, before counting this use. A new Intent was never on offer.
      if (kind === 'neural' && old) {
        const ranked = rank(context, now);
        trainRanker(ranked.map(({ input }) => input), ranked.findIndex(({ entry }) => entry === old));
      }
      entries[key] = { text, count: (old?.count ?? 0) + 1, last: now, heat: (old ? heatNow(old, now) : 0) + 1 };
      forget(context, now);
    },

    model: () => model,
  };
}

export type IntentHistory = ReturnType<typeof createIntentHistory>;
