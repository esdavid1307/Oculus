# Essay flow

Demo flow one (#10): the user looks at an essay in Google Docs, chooses "Continue the essay", and the Oculus Agent writes the next paragraph from what's on screen, doing every click and keystroke itself.

## The flow

1. Wake the Oculus Agent by holding the Centre Box for 3 seconds. A chime plays.
2. Hold gaze on the essay's text for 1 second. This is the target.
3. The overlay hides for one screenshot and shows "Thinking…" while Claude suggests up to 3 Suggested Intents. "Continue the essay" comes first.
4. Select Blink on it. In a dev run, press Cmd+Shift+Space.
5. The banner at the top shows "Running: Continue the essay", then what the agent is doing right now ("Looking at the screen…", "Clicking…", "Pressing cmd+down…", "Typing…", and "Thinking…" while Claude decides the next step), and "Look away to stop".
6. The agent clicks just after the last word on screen (not where the user looked, which may be a margin), moves the text caret to the end, and types one paragraph of about 80 to 120 words in the same voice. It then takes a screenshot to check.
7. The banner turns to "Done: <summary>" with a green border, or "Couldn't finish: <summary>" with an amber one, for `finishedMs` (3 seconds).

## Setup

1. Do the setup in `docs/agent-check.md` (backend, key or Claude login, three macOS permissions).
2. Sign in to Google in Chrome beforehand. The agent never signs in.
3. Open the essay in Google Docs in Chrome on the primary display, with its last lines visible.

## How the agent types

Plain text (letters, digits, ASCII punctuation, spaces) is typed with System Events keystrokes. On 2026-11-08 a 585-character paragraph took 0.3 s in Chrome with nothing dropped, so the 10-second cutoff in `src/main/agent/executor.ts` is far away.

Text with a new line or any other character (é, ñ, curly quotes, an em dash) is pasted instead, because keystrokes drop new lines and garble accented letters on some keyboard layouts. The paste puts the user's clipboard back half a second later.

To time it on the demo laptop, click into a scratch Google Doc, then run this in a terminal and switch back to the Doc within 3 seconds:

```sh
sleep 3; time osascript -e "tell application \"System Events\" to keystroke \"$(printf 'The quick brown fox jumps over the lazy dog. %.0s' {1..13})\""
```

Over about 8 seconds, or with dropped characters, means the `type` timeout or the paste rule needs another look.

## Stopping a run

Look away from the screen for 5 seconds (the Stop Gesture). The run stops and the agent goes straight to sleep. In a dev run, Cmd+Shift+L toggles Look Away.

## What to look for in the log

The same lines as `docs/youtube-flow.md`: `[intent-run] start …`, one `[agent-check] action …` line per step, `[intent-run] done … ok=… summary="…"`, and the run folder under `~/Library/Application Support/oculus-agent/intent-runs/`.

An API backend run that is still acting at its last step ends as `Couldn't finish: Ran out of steps`. It never ends as Done.

## Checking the suggestions without a run

Save a screenshot of the Doc as `essay.png` in a folder, and next to it `essay.json`:

```json
{ "display": { "width": 1470, "height": 956 }, "region": { "x": 700, "y": 500, "radius": 120 }, "expectFirst": "continue" }
```

`display` is the screen size in points, and `region` is where the user looked. Then run `OCULUS_EVAL_SHOTS=<folder> npx vitest run src/main/agent/intents.eval.test.ts`. This calls the real model.

## Results on the demo laptop

Fill in after each run on the demo laptop.

| Date | Backend, model | Typing time (600 chars) | Run | Outcome |
|---|---|---|---|---|
| 2026-11-08 | claude-code, claude-sonnet-5-5 | 0.3 s (Chrome) | Dev laptop, a local essay page in Chrome, not yet Google Docs | Done in 12.8 s, 90 words added at the end, nothing else changed. The Stop Gesture (Look Away) worked. |
| 2026-11-08 | claude-code, claude-sonnet-5-5 | 0.3 s (Chrome) | Same page, after the fixes. Text started with a new line, so it was pasted | Done in 12.9 s as its own paragraph, clipboard put back. Looking at the margin beside the essay: Done in 10.9 s, clicked after the last word. "Summarize the essay": no clicks or typing, essay unchanged. |

## Known limits

- It acts on the primary display and the frontmost Chrome window only.
- Claude reads the essay from the screenshot, so only what is on screen counts. Earlier pages that are scrolled away are not read.
- A Stop Gesture during typing ends the run, but the text already being typed still lands. Typing takes well under a second.
- Something the user copies in the half second of a paste is lost when the clipboard is put back.
- The summary is Claude's own sentence. Check the Doc. In one run before the fixes, the agent clicked the margin, typed nothing, and still said Done.
- Screenshots and `run.json` stay on disk and show the essay. Delete old runs from the folder above.
