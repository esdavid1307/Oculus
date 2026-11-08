import type { Rect, Screen } from './geometry';

// A letter, a group such as 'abcde', or one of 'space', 'delete', 'done' and 'back'.
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
//            Space -------  Done                   .  .  Back
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
          { id: 'space', label: 'Space', rect: cell(6, 2) },
          { id: 'done', label: 'Done', rect: cell(8) },
        ]
      : [
          ...[...group].map((letter, i) => ({ id: letter, label: letter.toUpperCase(), rect: cell(i) })),
          { id: 'back', label: 'Back', rect: cell(8) },
        ];
  return { text: { x: 0, y: 0, width, height: TEXT_HEIGHT }, keys };
}

// Suggested Intents fill a 2 x 2 grid over the whole screen. Something else always takes the last cell,
// so it stays put when fresh suggestions arrive.
export function layoutIntents({ width, height }: Screen, intents: string[]): Key[] {
  const cellWidth = (width - GAP) / 2;
  const cellHeight = (height - GAP) / 2;
  const cell = (index: number) => ({
    x: (index % 2) * (cellWidth + GAP),
    y: Math.floor(index / 2) * (cellHeight + GAP),
    width: cellWidth,
    height: cellHeight,
  });
  return [
    ...intents.map((label, i) => ({ id: `intent-${i}`, label, rect: cell(i) })),
    { id: 'something-else', label: 'Something else', rect: cell(3) },
  ];
}
