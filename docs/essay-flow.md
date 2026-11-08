# Essay flow

Demo flow one (#10): the user looks at an essay in Google Docs, chooses "Continue the essay", and the Oculus Agent writes the next paragraph from what's on screen, doing every click and keystroke itself.

## The flow

1. Wake the Oculus Agent by holding the Centre Box for 3 seconds. A chime plays.
2. Hold gaze on the essay's text for 1 second. This is the target.
3. The overlay hides for one screenshot and shows "Thinking…" while Claude suggests up to 3 Suggested Intents. "Continue the essay" comes first.
4. Select Blink on it. In a dev run, press Cmd+Shift+Space.
5. The banner at the top shows "Running: Continue the essay", then what the agent is doing right now ("Looking at the screen…", "Clicking…", "Pressing cmd+down…", "Typing…"), and "Look away to stop".
6. The agent clicks in the text, moves the cursor to the end, and types one paragraph of about 80 to 120 words in the same voice. It then takes a screenshot to check.
7. The banner turns to "Done: <summary>" with a green border, or "Couldn't finish: <summary>" with an amber one, for `finishedMs` (3 seconds).

## Setup

1. Do the setup in `docs/agent-check.md` (backend, key or Claude login, three macOS permissions).
2. Sign in to Google in Chrome beforehand. The agent never signs in.
3. Open the essay in Google Docs in Chrome on the primary display, with its last lines visible.

## Before the demo: time the typing

The agent types through System Events, and every keystroke script is cut off after 10 seconds (`src/main/agent/executor.ts`). A paragraph is about 600 characters. Click into a scratch Google Doc, then run this in a terminal and switch back to the Doc within 3 seconds:

```sh
sleep 3; time osascript -e "tell application \"System Events\" to keystroke \"$(printf 'The quick brown fox jumps over the lazy dog. %.0s' {1..13})\""
```

Write down how long it took and whether any characters were dropped.

- **Over about 8 seconds:** the paragraph will be cut off, so the `type` timeout has to grow with the text.
- **Dropped characters:** type by pasting from the clipboard instead.
- **Over about 2 seconds:** a Stop during typing still lets the rest of the paragraph land (see Known limits), so consider typing in chunks.

## Stopping a run

Look away from the screen for 5 seconds. The run is aborted and the agent goes straight to sleep. In a dev run, Cmd+Shift+L toggles Look Away.

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

## Known limits

- It acts on the primary display and the frontmost Chrome window only.
- Claude reads the essay from the screenshot, so only what is on screen counts. Earlier pages that are scrolled away are not read.
- A Stop during typing ends the run, but the text already being typed still lands.
- The summary is Claude's own sentence. Check the Doc.
- Screenshots and `run.json` stay on disk and show the essay. Delete old runs from the folder above.
