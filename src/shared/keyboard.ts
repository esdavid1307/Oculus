import type { Rect, Screen } from './geometry';

// A letter, a group such as 'abcde', a suggested word such as 'word:water', or one of 'space', 'delete', 'done' and 'back'.
export type KeyId = string;

export type Key = { id: KeyId; label: string; rect: Rect };

export type KeyboardLayout = { text: Rect; keys: Key[] };

export const GROUPS = ['abcde', 'fghij', 'klmno', 'pqrst', 'uvwxyz'];

export const SUGGESTION_KEY = 'word:';
export const MAX_SUGGESTIONS = 3;

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
// Suggested words take a row of their own above the groups. They come first, so the scan reaches them first.
export function layoutKeyboard({ width, height }: Screen, group: string | null, suggestions: string[] = []): KeyboardLayout {
  const shown = group === null ? suggestions.slice(0, MAX_SUGGESTIONS) : [];
  const offset = shown.length ? COLUMNS : 0;
  const rows = ROWS + (shown.length ? 1 : 0);
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
          ...shown.map((word, i) => ({ id: SUGGESTION_KEY + word, label: word, rect: cell(i) })),
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
