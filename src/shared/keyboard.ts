import type { Rect, Screen } from './geometry';

// A letter, a group such as 'abcde', or one of 'space', 'delete', 'reset', 'done' and 'back'.
export type KeyId = string;

export type Key = { id: KeyId; label: string; rect: Rect };

export type KeyboardLayout = { text: Rect; keys: Key[] };

export const GROUPS = ['abcde', 'fghij', 'klmno', 'pqrst', 'uvwxyz'];

const GAP = 16;
const COLUMNS = 3;
const ROWS = 3;
const TEXT_HEIGHT = 120;

// Each letter takes two steps, a group and then a letter, so no screen has more than 10 keys (#5, #7).
// The keyboard fills the whole screen. Each key sits in a cell of a 3 x 3 grid under the typed text:
//
//   groups:  ABCDE  FGHIJ   KLMNO        letters:  A  B  C
//            PQRST  UVWXYZ  Delete                 D  E  .
//            Space  Reset   Done                   .  .  Back
//
// Reset clears Gaze Correction, see docs/gaze-correction.md.
export function layoutKeyboard({ width, height }: Screen, group: string | null): KeyboardLayout {
  const top = TEXT_HEIGHT + GAP;
  const cellWidth = (width - (COLUMNS - 1) * GAP) / COLUMNS;
  const cellHeight = (height - top - (ROWS - 1) * GAP) / ROWS;
  const cell = (index: number, span = 1) => ({
    x: (index % COLUMNS) * (cellWidth + GAP),
    y: top + Math.floor(index / COLUMNS) * (cellHeight + GAP),
    width: span * cellWidth + (span - 1) * GAP,
    height: cellHeight,
  });

  const keys =
    group === null
      ? [
          ...GROUPS.map((id, i) => ({ id, label: id.toUpperCase(), rect: cell(i) })),
          { id: 'delete', label: 'Delete', rect: cell(5) },
          { id: 'space', label: 'Space', rect: cell(6) },
          { id: 'reset', label: 'Reset gaze', rect: cell(7) },
          { id: 'done', label: 'Done', rect: cell(8) },
        ]
      : [
          ...[...group].map((letter, i) => ({ id: letter, label: letter.toUpperCase(), rect: cell(i) })),
          { id: 'back', label: 'Back', rect: cell(8) },
        ];
  return { text: { x: 0, y: 0, width, height: TEXT_HEIGHT }, keys };
}
