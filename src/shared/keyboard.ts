import type { Rect, Screen } from './geometry';

// A letter, a group such as 'abcde', a suggested word such as 'word:water', or one of 'space', 'delete', 'done' and 'back'.
export type KeyId = string;

export type Key = { id: KeyId; label: string; rect: Rect };

export type KeyboardLayout = { text: Rect; keys: Key[] };

export const GROUPS = ['abcde', 'fghij', 'klmno', 'pqrst', 'uvwxyz'];

export const SUGGESTION_KEY = 'word:';
export const MAX_SUGGESTIONS = 3;
// The Suggested Phrase key.
export const PHRASE_KEY = 'phrase';
// Closes the Suggested Intents without running anything.
export const CLOSE_KEY = 'close';

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
// Suggested words take a row of their own above the groups, and a Suggested Phrase one wide row above them. They
// come first, so the scan reaches them first. With neither, the layout is the 3 x 3 grid.
export function layoutKeyboard({ width, height }: Screen, group: string | null, suggestions: string[] = [], phrase?: string): KeyboardLayout {
  const shown = group === null ? suggestions.slice(0, MAX_SUGGESTIONS) : [];
  const phraseShown = group === null && phrase !== undefined && phrase !== '';
  const wordsOffset = phraseShown ? COLUMNS : 0;
  const offset = wordsOffset + (shown.length ? COLUMNS : 0);
  const rows = ROWS + (shown.length ? 1 : 0) + (phraseShown ? 1 : 0);
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
          ...(phraseShown ? [{ id: PHRASE_KEY, label: phrase, rect: cell(0, COLUMNS) }] : []),
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

// Suggested Intents stack in one column a third of the screen wide, on the side away from the target. Something else
// always takes the last of the cells, so it stays put when fresh suggestions arrive, and Close goes under it.
// With past Intents there are 6 cells from the start, since 2 past plus 3 from Claude need 5 and a column that grew
// later would move everything on screen.
export function layoutIntents({ width, height }: Screen, intents: string[], cells: 4 | 6 = 4, side: IntentsSide = 'right'): Key[] {
  // Every slot keeps its row as Claude's Intents join, so nothing moves: the Intents, then Something else in the last
  // of the cells, then Close.
  const rows = cells + 1;
  const panelWidth = Math.floor(width / 3);
  const cellHeight = (height - (rows - 1) * GAP) / rows;
  const cell = (index: number) => ({
    x: side === 'left' ? 0 : width - panelWidth,
    y: index * (cellHeight + GAP),
    width: panelWidth,
    height: cellHeight,
  });
  return [
    ...intents.map((label, i) => ({ id: `intent-${i}`, label, rect: cell(i) })),
    { id: 'something-else', label: 'Something else', rect: cell(cells - 1) },
    { id: CLOSE_KEY, label: 'Close', rect: cell(cells) },
  ];
}
