# Fixed Intents

Close, Quit (#93), Minimize (#64), Type (#66) and Dock (#65) show in every picker, the moment a target is picked, without waiting for Claude.

## The order

1. Up to 2 Intents from Intent History.
2. A suggested "Skip the ad", if Claude offers one. It goes ahead of the Fixed Intents and takes the highlight, which starts its step again.
3. Close (shown as Cancel, since Claude often offers to close the window), Quit, Minimize, Type and Dock, then Cmd when Chrome is in front, which opens a scan of Search, Next Tab, New Tab, Close Tab and Close (#67, #68).
4. Claude's other Suggested Intents, joining after them. The highlight doesn't move when they do, and "Finding more…" shows in the first empty cell until they arrive.
5. Something else, always last. It opens the picker again at once with the Fixed Intents, while Claude thinks of different ones.

Cells are kept for everything that can still come, so tiles never move once shown.

## How it works

| Part | What it does |
|---|---|
| `src/shared/session.ts` | Owns the picker. It opens on the past Intents answer, which main now always sends (empty if there are none), or on Claude's, whichever comes first. Choosing Dock does what a completed Dock hold does: `show-dock`, then an Icon Scan of the Dock in Icon Order. It waits for `dock-shown` to start the scan, as a menu bar item waits for `menu-opened`, so a hidden Dock is scanned where it shows; after 2 s without an answer it scans the Dock as last read. Quit shows as "Quit <App>" with the front app's name, read once from `frontApp` as the picker opens, and is left out when the front app is Finder (which macOS starts again at once) or unknown. Choosing Quit or Minimize sends a `fixed-intent` action, Quit's naming the app, and goes back to idle, like Close, since the gaze resting on the panel would otherwise pick a new target. Only the Select Blink's `learn` for Scan Pace goes out: no `run-intent`, so nothing teaches Intent History or Gaze Correction. |
| `src/shared/keyboard.ts` | `layoutIntents` puts the Fixed Intents after the first `fixedAt` Intents. |
| `src/main/index.ts` | Gives the session `frontApp`, the first menu bar item's process, from the menu bar read it already makes. Quits the app through scripting, and performs the other `fixed-intent`s as key presses, with no Claude call. After `show-dock` it reads the Dock again and sends `dock-shown`. |
| `src/main/agent/intents.ts` | Tells Claude Quit, Minimize and the Dock are already offered, so it doesn't suggest them. |

## The keys

- **Quit** is not a key press. One osascript checks the app named is still the process in front, then tells it to quit by its bundle id, the way the Dock's Quit does, ignoring the reply. So the app's own "Save changes?" or "Quit while downloading?" prompt stays up for the user, and Chrome's "Hold ⌘Q to quit" warning, which only watches the keyboard, never comes up. If another app is in front by then, nothing is quit and `[fixed-intent] skipped: …` is logged.
- **Minimize** is Cmd+M, the Minimize command of the app in front, pressed through the same CGEvent path as the agent's. With no window it does nothing. The overlay never takes focus, so it doesn't get it.

The Chrome Commands are pressed through System Events, and only while Chrome is still in front:

- **Search** is Cmd+L, which selects the address bar, and **New Tab** is Cmd+T, which opens a tab with the focus in its address bar. Both then open the Gaze Keyboard, and Done types the text and presses Return, whatever field the focus reads as, since Chrome doesn't tell Accessibility which field it is.
  A target hold on the address bar opens the Gaze Keyboard on it as a Text Box, and Done searches the same way: the page read says the page doesn't have the focus (#95), so Done goes by the Text Box. Opened with Type, on no Text Box, an unfocused page never gets Return.
- **Next Tab** is Ctrl+Tab and **Close Tab** is Cmd+W.

## Results

The hand check posts the exact events main builds (`jxaFor` from `src/main/agent/jxa.ts`) at a throwaway TextEdit document in front, and reads where the windows are from `CGWindowListCopyWindowInfo`.

| Date | Machine | Keys | Finding |
|---|---|---|---|
| 2026-11-09 | Dev laptop, macOS 26.6.2 | Cmd+M | The TextEdit window went into the Dock (off screen, same frame). Pressed again with TextEdit in front and no window, nothing on screen changed. |
| 2026-11-09 | Dev laptop, same | Quit, with iTerm2 in front and another app named | Nothing was quit. The script answered `skipped: iTerm2 is in front, not NoSuchApp`. |

## Limits

- **Quit not checked by hand yet** with TextEdit and an unsaved document (the save prompt should show) or with Chrome (it should quit with no hold). Add a row above for each.
- **Dock waits for the Dock.** Between choosing Dock and the scan starting (main shows the Dock and reads it again, about a second) the picker is gone and nothing can be chosen. Not checked by hand yet.
- **Minimize acts on the window in front**, which isn't always the one under the target. A Desktop icon or the Dock can't be minimized.
- **Not checked on the demo laptop** (an M5 MacBook Pro). Add a row above when it is.
