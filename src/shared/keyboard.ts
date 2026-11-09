import type { Rect, Screen } from './geometry';

// A letter, a group such as 'abcde', a suggested word such as 'word:water', or one of 'space', 'delete', 'done' and 'back'.
export type KeyId = string;

export type Key = { id: KeyId; label: string; rect: Rect };

export type KeyboardLayout = { text: Rect; keys: Key[] };

export const GROUPS = ['abcde', 'fghij', 'klmno', 'pqrst', 'uvwxyz'];

export const SUGGESTION_KEY = 'word:';
export const MAX_SUGGESTIONS = 3;
// The Suggested Phrase key id prefix: the chosen phrase text follows the ':'.
export const PHRASE_KEY = 'phrase:';
export const MAX_SHOWN_PHRASES = 2;
// Closes the Suggested Intents without running anything.
export const CLOSE_KEY = 'close';

// The choices the picker always offers, which run at once without Claude. Each one's key id is its name.
export type FixedIntent = 'close' | 'home' | 'minimize' | 'dock' | 'type' | 'cmd' | 'next-tab' | 'close-tab' | 'search' | 'new-tab';

// The Suggested Intents sit in a column on one side, so the rest of the screen, and the target, stay in view.
export type IntentsSide = 'left' | 'right';

const GAP = 16;
const COLUMNS = 3;
const ROWS = 3;
const TEXT_HEIGHT = 120;

// Each letter takes two steps, a group and then a letter, so no screen has more than 10 keys (#5, #7).
// The keyboard fills the whole screen. Each key sits in a cell of a 3 x 3 grid under the typed text:
//
//   groups:  ABCDE  FGHIJ   KLMNO        letters:  A  B  C
//            PQRST  UVWXYZ  Delete                 D  E  .
//            Space -------  Done                   .  .  Back
//
// Suggested Words take a row of their own above the groups, and Suggested Phrases take one wide row each above them.
// They come first, so the scan reaches them first. With none, the layout is the 3 x 3 grid.
export function layoutKeyboard({ width, height }: Screen, group: string | null, suggestions: string[] = [], phrases: string[] = []): KeyboardLayout {
  const shown = group === null ? suggestions.slice(0, MAX_SUGGESTIONS) : [];
  const phrasesShown = group === null ? phrases.slice(0, MAX_SHOWN_PHRASES) : [];
  const wordsOffset = phrasesShown.length * COLUMNS;
  const offset = wordsOffset + (shown.length ? COLUMNS : 0);
  const rows = ROWS + (shown.length ? 1 : 0) + phrasesShown.length;
  const top = TEXT_HEIGHT + GAP;
  const cellWidth = (width - (COLUMNS - 1) * GAP) / COLUMNS;
  const cellHeight = (height - top - (rows - 1) * GAP) / rows;
  const cell = (index: number, span = 1) => ({
    x: (index % COLUMNS) * (cellWidth + GAP),
    y: top + Math.floor(index / COLUMNS) * (cellHeight + GAP),
    width: span * cellWidth + (span - 1) * GAP,
    height: cellHeight,
  });

  const keys =
    group === null
      ? [
          ...phrasesShown.map((text, i) => ({ id: PHRASE_KEY + text, label: text, rect: cell(i * COLUMNS, COLUMNS) })),
          ...shown.map((word, i) => ({ id: SUGGESTION_KEY + word, label: word, rect: cell(wordsOffset + i) })),
          ...GROUPS.map((id, i) => ({ id, label: id.toUpperCase(), rect: cell(offset + i) })),
          { id: 'delete', label: 'Delete', rect: cell(offset + 5) },
          { id: 'space', label: 'Space', rect: cell(offset + 6, 2) },
          { id: 'done', label: 'Done', rect: cell(offset + 8) },
        ]
      : [
          ...[...group].map((letter, i) => ({ id: letter, label: letter.toUpperCase(), rect: cell(i) })),
          { id: 'back', label: 'Back', rect: cell(8) },
        ];
  return { text: { x: 0, y: 0, width, height: TEXT_HEIGHT }, keys };
}

// Suggested Intents sit in a grid of tiles in a panel on the side away from the target: two across in a third of the
// screen, and three across in a little more once there are more than 8 tiles, up to 3 x 4. Something else always takes
// the last of the cells, so it stays put when fresh suggestions arrive, and Close comes after it. The caller reserves
// the cells for Intents still to come, since a grid that grew later would move everything on screen.
const MAX_INTENT_TILES = 12;
const INTENT_MAX_ROWS = 4;
const INTENT_GAP = 14;
// Space between the tiles and the screen's edges.
const INTENT_MARGIN = 16;
// Tiles are at most this much taller than wide, so they stay square-ish on a tall screen.
const INTENT_MAX_ASPECT = 1.1;
// Three across stays clear of the Stop Gesture countdown in the middle of the screen.
const WIDE_PANEL = 3 / 8;

// cells is how many slots come before Close, Something else included. Every Intent gets a cell even past that, up to
// MAX_INTENT_TILES in all. The first recent of the intents are past Intents, and the Fixed Intents come after them.
export function layoutIntents(
  { width, height }: Screen,
  intents: string[],
  cells = 4,
  side: IntentsSide = 'right',
  recent = 0,
  fixed: FixedIntent[] = [],
): Key[] {
  // Every slot keeps its place as Claude's Intents join, so nothing moves: the past Intents, the Fixed Intents, Claude's
  // Intents, then Something else in the last of the cells, then Close.
  const slots = Math.min(Math.max(cells, intents.length + fixed.length + 1), MAX_INTENT_TILES - 1);
  const shown = intents.slice(0, slots - 1 - fixed.length);
  const columns = slots + 1 > 2 * INTENT_MAX_ROWS ? 3 : 2;
  const rows = Math.ceil((slots + 1) / columns);
  const panelWidth = Math.floor(columns === 2 ? width / 3 : width * WIDE_PANEL);
  const tileWidth = (panelWidth - 2 * INTENT_MARGIN - (columns - 1) * INTENT_GAP) / columns;
  const tileHeight = Math.min((height - 2 * INTENT_MARGIN - (rows - 1) * INTENT_GAP) / rows, tileWidth * INTENT_MAX_ASPECT);
  // Centred down the screen's edge, so no tile runs off it or touches it.
  const top = (height - (rows * tileHeight + (rows - 1) * INTENT_GAP)) / 2;
  const left = (side === 'left' ? 0 : width - panelWidth) + INTENT_MARGIN;
  const cell = (index: number) => ({
    x: left + (index % columns) * (tileWidth + INTENT_GAP),
    y: top + Math.floor(index / columns) * (tileHeight + INTENT_GAP),
    width: tileWidth,
    height: tileHeight,
  });
  const intent = (label: string, i: number) => ({ id: `intent-${i}`, label });
  const tiles = [
    ...shown.slice(0, recent).map(intent),
    ...fixed.map((name) => ({ id: name, label: name[0].toUpperCase() + name.slice(1) })),
    ...shown.slice(recent).map((label, i) => intent(label, recent + i)),
  ];
  return [
    ...tiles.map((tile, i) => ({ ...tile, rect: cell(i) })),
    { id: 'something-else', label: 'Something else', rect: cell(slots - 1) },
    { id: CLOSE_KEY, label: 'Close', rect: cell(slots) },
  ];
}
