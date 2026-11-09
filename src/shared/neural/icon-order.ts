// Icon Order: learns which icons this user opens, per Icon Scan source, so the scan reaches them first.
// Before it has learned anything, the order is the screen order the Icon Scan always used.
import { createRanker, rankScore, readRanker, trainRanker, type Ranker } from './net';

export type IconUse = { count: number; last: number; heat: number };

export type IconOrderModel = {
  version: 1;
  // source ('dock', 'desktop', 'menubar' or 'menu') -> icon name -> use.
  uses: Record<string, Record<string, IconUse>>;
  ranker: Ranker;
};

export const FEATURES = ['share of recent opens', 'recency-weighted opens', 'recency', 'screen order'] as const;
// Screen order alone at first, and only as a tie-breaker once opens come in.
const PRIOR = [8, 0.5, 0.3, 0.2];
const HIDDEN = 4;
const TRAINING = { learningRate: 0.05, steps: 2, priorPull: 0.05, prior: PRIOR };
// An open counts half as much after this long, so a change in habits shows within days.
const HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
const RECENCY_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_NAMES_PER_SOURCE = 300;

export const emptyIconOrder = (): IconOrderModel => ({ version: 1, uses: {}, ranker: createRanker(PRIOR, HIDDEN, 23) });

const isUse = (use: unknown): use is IconUse =>
  typeof use === 'object' && use !== null && ['count', 'last', 'heat'].every((key) => Number.isFinite((use as Record<string, unknown>)[key]));

export function readIconOrder(raw: unknown): IconOrderModel {
  const model = raw as IconOrderModel | null | undefined;
  if (model?.version !== 1 || typeof model.uses !== 'object' || model.uses === null) return emptyIconOrder();
  // A malformed use would score NaN and scramble the order, so it is dropped and the rest are kept.
  const uses = Object.fromEntries(
    Object.entries(model.uses)
      .filter(([, names]) => typeof names === 'object' && names !== null)
      .map(([source, names]) => [source, Object.fromEntries(Object.entries(names).filter(([, use]) => isUse(use)))] as const)
      .filter(([, names]) => Object.keys(names).length > 0),
  );
  return { version: 1, uses, ranker: readRanker(model.ranker, emptyIconOrder().ranker) };
}

const heatAt = (use: IconUse, now: number) => use.heat * 0.5 ** ((now - use.last) / HALF_LIFE_MS);

export function createIconOrder(model: IconOrderModel = emptyIconOrder()) {
  // names in screen order -> one feature row each.
  function features(source: string, names: string[], now: number) {
    const uses = model.uses[source] ?? {};
    const heats = names.map((name) => (uses[name] ? heatAt(uses[name], now) : 0));
    const total = heats.reduce((sum, heat) => sum + heat, 0) || 1;
    return names.map((name, i) => {
      const use = uses[name];
      return [
        heats[i] / total,
        use ? Math.log2(1 + heats[i]) / 4 : 0,
        use ? Math.exp(-(now - use.last) / RECENCY_MS) : 0,
        1 - i / Math.max(names.length - 1, 1),
      ];
    });
  }

  return {
    // The names in the order to scan them. Ties keep screen order.
    order(source: string, names: string[], now = Date.now()): string[] {
      const rows = features(source, names, now);
      return names
        .map((name, i) => ({ name, i, score: rankScore(model.ranker, rows[i]).value }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map(({ name }) => name);
    },
    // names are the icons that were scanned, in screen order, and chosen is the one opened.
    learn(source: string, names: string[], chosen: string, now = Date.now()) {
      const index = names.indexOf(chosen);
      if (index >= 0) trainRanker(model.ranker, features(source, names, now), index, TRAINING);
      const uses = (model.uses[source] ??= {});
      const use = uses[chosen];
      uses[chosen] = use ? { count: use.count + 1, last: now, heat: heatAt(use, now) + 1 } : { count: 1, last: now, heat: 1 };
      const known = Object.keys(uses);
      if (known.length > MAX_NAMES_PER_SOURCE) {
        known.sort((a, b) => heatAt(uses[a], now) - heatAt(uses[b], now));
        for (const name of known.slice(0, known.length - MAX_NAMES_PER_SOURCE)) delete uses[name];
      }
    },
    model: () => model,
  };
}

export type IconOrder = ReturnType<typeof createIconOrder>;
