# Fixed Intents

Close, Home and Minimize (#64) Type (#66) and Dock (#65) show in every picker, the moment a target is picked, without waiting for Claude.

## The order

1. Up to 2 Intents from Intent History.
2. A suggested "Skip the ad", if Claude offers one. It goes ahead of the Fixed Intents and takes the highlight, which starts its step again.
3. Close (shown as Cancel, since Claude often offers to close the window), Home, Minimize, Type and Dock, then Cmd when Chrome is in front, which opens a scan of Next Tab, Close Tab and Close.
4. Claude's other Suggested Intents, joining after them. The highlight doesn't move when they do, and "Finding more…" shows in the first empty cell until they arrive.
5. Something else, always last. It opens the picker again at once with the Fixed Intents, while Claude thinks of different ones.

Cells are kept for everything that can still come, so tiles never move once shown.

## How it works

| Part | What it does |
|---|---|
| `src/shared/session.ts` | Owns the picker. It opens on the past Intents answer, which main now always sends (empty if there are none), or on Claude's, whichever comes first. Choosing Dock does what a completed Dock hold does: `show-dock`, then an Icon Scan of the Dock in Icon Order. It waits for `dock-shown` to start the scan, as a menu bar item waits for `menu-opened`, so a hidden Dock is scanned where it shows; after 2 s without an answer it scans the Dock as last read. Choosing Home or Minimize sends a `fixed-intent` action and goes back to idle, like Close, since the gaze resting on the panel would otherwise pick a new target. Only the Select Blink's `learn` for Scan Pace goes out: no `run-intent`, so nothing teaches Intent History or Gaze Correction. |
| `src/shared/keyboard.ts` | `layoutIntents` puts the Fixed Intents after the first `fixedAt` Intents. |
| `src/main/index.ts` | Performs `fixed-intent` as key presses through the same CGEvent path as the agent's, with no Claude call. After `show-dock` it reads the Dock again and sends `dock-shown`. |
| `src/main/agent/intents.ts` | Tells Claude the Desktop, Minimize and the Dock are already offered, so it doesn't suggest them. |

## The keys

- **Home** is Cmd and the Mission Control key (key code 160, which is F3 on Apple keyboards), macOS's Show Desktop. The Dock only acts on it with the Fn flag set, as a real keyboard sends it. The F3 key code (99) with Cmd does nothing, and F11, the Show Desktop setting in Keyboard Shortcuts, can be turned off or changed, so neither is used.
- **Minimize** is Cmd+M, the Minimize command of the app in front. With no window it does nothing.

Both are pressed into the app in front. The overlay never takes focus, so it doesn't get them.

## Results

The hand check posts the exact events main builds (`jxaFor` from `src/main/agent/jxa.ts`) at a throwaway TextEdit document in front, and reads where the windows are from `CGWindowListCopyWindowInfo`.

| Date | Machine | Keys | Finding |
|---|---|---|---|
| 2026-11-09 | Dev laptop, macOS 26.6.2 | Cmd+M | The TextEdit window went into the Dock (off screen, same frame). Pressed again with TextEdit in front and no window, nothing on screen changed. |
| 2026-11-09 | Dev laptop, same | Cmd+F3 (key code 99), with and without Fn; F11 without Fn | Nothing happened. TextEdit, Finder and Discord stayed where they were. |
| 2026-11-09 | Dev laptop, same | Cmd+Mission Control (key code 160, Fn flag) | The Desktop showed: every window moved off the top and left edges. Pressing it again put each one back where it was. Fn+F11 did the same. Without the Fn flag, key code 160 didn't show the Desktop: the view moved to Cursor's full-screen Space. |

## Limits

- **Home toggles.** Choosing Home while the Desktop is already showing brings the windows back.
- **Dock waits for the Dock.** Between choosing Dock and the scan starting (main shows the Dock and reads it again, about a second) the picker is gone and nothing can be chosen. Not checked by hand yet.
- **Minimize acts on the window in front**, which isn't always the one under the target. A Desktop icon or the Dock can't be minimized.
- **Not checked on the demo laptop** (an M5 MacBook Pro). Add a row above when it is.
