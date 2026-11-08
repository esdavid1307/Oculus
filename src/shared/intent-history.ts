// Intent History: the Intents this user chose before that ran fine, per app and site. Pure, so the session core and
// tests can drive it without Electron.
//
// The context is a string: the frontmost app, for example "Google Chrome". Past Intents are ranked by how often and
// how recently they were used.
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
};

// An Intent used today counts for more than one from last month.
const RECENCY_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PER_CONTEXT = 40;
const MAX_CONTEXTS = 300;

// Keyed by app and typed text, so no inherited keys: a plain {} already has 'constructor'.
const table = <T>(entries: Record<string, T> = {}): Record<string, T> => Object.assign(Object.create(null), entries);

export function emptyIntentHistory(): IntentHistoryModel {
  return { version: 1, contexts: table() };
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
  const contexts = table<Record<string, HistoryEntry>>();
  for (const [context, entries] of Object.entries(model.contexts)) contexts[context] = table(entries);
  return { version: 1, contexts };
}

export function createIntentHistory(model: IntentHistoryModel = emptyIntentHistory()) {
  const heatNow = (entry: HistoryEntry, now: number) => entry.heat * fade(now - entry.last);

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
    // The best past Intents for this context, best first.
    suggest(context: string, limit = 2, now = Date.now()): string[] {
      return Object.values(model.contexts[context] ?? {})
        .map((entry) => ({ entry, score: heatNow(entry, now) }))
        .sort((a, b) => b.score - a.score || b.entry.last - a.entry.last)
        .slice(0, limit)
        .map(({ entry }) => entry.text);
    },

    // Called with an Intent whose run finished ok. Failed or stopped runs never reach it.
    learn(context: string, intent: string, now = Date.now()) {
      const text = intent.trim();
      // "Skip the ad" is offered whenever an ad plays, so remembering it would only offer it when there is no ad.
      if (context === '' || text === '' || isSkipAd(text)) return;
      const entries = (model.contexts[context] ??= table());
      const key = text.toLowerCase();
      const old = entries[key];
      entries[key] = { text, count: (old?.count ?? 0) + 1, last: now, heat: (old ? heatNow(old, now) : 0) + 1 };
      forget(context, now);
    },

    model: () => model,
  };
}

export type IntentHistory = ReturnType<typeof createIntentHistory>;
