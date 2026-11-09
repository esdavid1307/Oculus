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
// Choices that run at once as key presses, without Claude. Each one's key id is its name. Cmd is Chrome-only and opens
// the Chrome Commands, Next Tab and Close Tab.
export type FixedIntent = 'close' | 'home' | 'minimize' | 'cmd' | 'next-tab' | 'close-tab';
// Closes the Suggested Intents without running anything.
export const CLOSE_KEY = 'close' satisfies FixedIntent;

// Close is "Cancel" on screen, since Claude often offers to close the window, which is a different thing.
const FIXED_LABELS: Record<FixedIntent, string> = { close: 'Cancel', home: 'Home', minimize: 'Minimize', cmd: 'Cmd', 'next-tab': 'Next Tab', 'close-tab': 'Close Tab' };

// The Suggested Intents sit in a column on one side, so the rest of the screen, and the target, stay in view.
export type IntentsSide = 'left' | 'right';

// What the picker holds, in scan order: the first fixedAt of the intents, then the Fixed Intents, then the rest of the
// intents, and Something else last. cells is how many tiles it keeps room for, Something else included, so the Intents
// still to come fill empty cells instead of growing the grid.
export type Picker = { intents: string[]; fixed: FixedIntent[]; fixedAt: number; cells: number; side: IntentsSide };

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
// the last of the cells, so it stays put when fresh suggestions arrive. The caller reserves the cells for Intents still
// to come, since a grid that grew later would move everything on screen.
const MAX_INTENT_TILES = 12;
const INTENT_MAX_ROWS = 4;
const INTENT_GAP = 14;
// Space between the tiles and the screen's edges.
const INTENT_MARGIN = 16;
// Tiles are at most this much taller than wide, so they stay square-ish on a tall screen.
const INTENT_MAX_ASPECT = 1.1;
// Three across stays clear of the Stop Gesture countdown in the middle of the screen.
const WIDE_PANEL = 3 / 8;

// Every tile gets a cell even past cells, up to MAX_INTENT_TILES in all. Past that the last intents are left out.
export function layoutIntents({ width, height }: Screen, { intents, fixed, fixedAt, cells, side }: Picker): Key[] {
  // Every tile keeps its place as Claude's Intents join, so nothing moves, with Something else in the last of the cells.
  const slots = Math.min(Math.max(cells, intents.length + fixed.length + 1), MAX_INTENT_TILES);
  const shown = intents.slice(0, Math.max(slots - 1 - fixed.length, fixedAt));
  const tiles = [
    ...shown.slice(0, fixedAt).map((label, i) => ({ id: `intent-${i}`, label })),
    ...fixed.map((name) => ({ id: name, label: FIXED_LABELS[name] })),
    ...shown.slice(fixedAt).map((label, i) => ({ id: `intent-${fixedAt + i}`, label })),
  ];
  const columns = slots > 2 * INTENT_MAX_ROWS ? 3 : 2;
  const rows = Math.ceil(slots / columns);
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
  return [...tiles.map((tile, i) => ({ ...tile, rect: cell(i) })), { id: 'something-else', label: 'Something else', rect: cell(slots - 1) }];
}
