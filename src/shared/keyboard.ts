import { CORNER_TARGET_SIZE, type Rect, type Screen } from './geometry';

// 'a' to 'z', plus the three action keys.
export type KeyId = string;

export type Key = { id: KeyId; label: string; rect: Rect };

export type KeyboardLayout = { text: Rect; keys: Key[] };

const GAP = 16;
const COLUMNS = 7;
const ROWS = 4;
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];

// The Gaze Keyboard fills the screen around the two corner targets, which stay uncovered:
//
//   +--------+---------------------+------+
//   | typed text                   | wake |
//   +--------+----------------------------+
//   | Done   |                            |
//   +--------+  A to Z and Space          |
//   | Delete |  (7 x 4 grid)              |
//   +--------+                            |
//   | stop   |                            |
//   +--------+----------------------------+
//
// Done sits away from the stop corner, so a look at Stop can't land on Done.
// shortcut: key size comes from the screen alone. Switch to the smallest usable key size from #5 once it's recorded.
export function layoutKeyboard({ width, height }: Screen): KeyboardLayout {
  const corner = CORNER_TARGET_SIZE;
  const top = corner + GAP;

  const sideHeight = (height - corner - GAP - top - GAP) / 2;
  const side = (row: number) => ({ x: 0, y: top + row * (sideHeight + GAP), width: corner, height: sideHeight });

  const gridX = corner + GAP;
  const cellWidth = (width - gridX - (COLUMNS - 1) * GAP) / COLUMNS;
  const cellHeight = (height - top - (ROWS - 1) * GAP) / ROWS;
  const cell = (index: number, span = 1) => ({
    x: gridX + (index % COLUMNS) * (cellWidth + GAP),
    y: top + Math.floor(index / COLUMNS) * (cellHeight + GAP),
    width: span * cellWidth + (span - 1) * GAP,
    height: cellHeight,
  });

  return {
    text: { x: 0, y: 0, width: width - corner - GAP, height: corner },
    keys: [
      ...LETTERS.map((letter, i) => ({ id: letter, label: letter.toUpperCase(), rect: cell(i) })),
      { id: 'space', label: 'Space', rect: cell(LETTERS.length, 2) },
      { id: 'done', label: 'Done', rect: side(0) },
      { id: 'delete', label: 'Delete', rect: side(1) },
    ],
  };
}
