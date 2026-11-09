// How a Suggested Intent is drawn as a tile: a short label and an icon. The full intent text stays the aria-label and
// tooltip, and is what runs. Claude picks both when it suggests the intent; anything it leaves out falls back here.
export const INTENT_ICONS = [
  'screenshot',
  'branch',
  'scroll-down',
  'scroll-up',
  'click',
  'maximize',
  'minimize',
  'close',
  'play',
  'pause',
  'skip',
  'search',
  'type',
  'document',
  'open',
  'copy',
  'delete',
  'refresh',
  'sound',
  'mute',
  'send',
  'save',
  'write',
  'terminal',
  'more',
  'other',
] as const;

export type IntentIcon = (typeof INTENT_ICONS)[number];

export type IntentLook = { label: string; icon: IntentIcon };

const MAX_LABEL_WORDS = 2;

export function isIntentIcon(value: unknown): value is IntentIcon {
  return typeof value === 'string' && (INTENT_ICONS as readonly string[]).includes(value);
}

// At most two words, so the label fits one line under the icon.
export function shortLabel(text: string) {
  return text.trim().split(/\s+/).slice(0, MAX_LABEL_WORDS).join(' ');
}

// Used for past Intents from Intent History and for any answer without a look.
export function fallbackLook(text: string): IntentLook {
  return { label: shortLabel(text), icon: 'other' };
}
