# YouTube flow

The first full Intent flow (#14): the user looks at a video on YouTube, picks what to do with it, and the Oculus Agent does it in Chrome.

## The flow

1. Wake the Oculus Agent by holding the Centre Box for 3 seconds. A chime plays.
2. Hold gaze on a video thumbnail for 1 second. This is the target.
3. The overlay hides for one screenshot and shows "Thinking…" while Claude suggests up to 3 Suggested Intents, such as "Open this video".
4. The Intents scan like the Gaze Keyboard. Select Blink on the one you want. In a dev run, press Cmd+Shift+Space.
5. The Oculus Agent runs the Intent in Chrome. The overlay shrinks to a banner at the top, "Running: <Intent>", what the agent is doing right now (such as "Clicking…"), and "Look away to stop", so you can watch the page change underneath.
6. The banner turns to "Done: <summary>" with a green border, or "Couldn't finish: <summary>" with an amber one. It stays for `finishedMs` (3 seconds), then the agent sleeps.

If a video ad is on screen when the screenshot is taken (a Skip button, an "Ad" or "Sponsored" badge, or an ad countdown), "Skip the ad" is offered first, wherever the user was looking. Choosing it clicks Skip, waiting up to 10 seconds for a countdown. Nothing depends on an ad: with none on screen the offer never appears, and opening a video works the same.

## Setup

1. Do the setup in `docs/agent-check.md` (backend, key or Claude login, three macOS permissions).
2. Sign in to YouTube in Chrome beforehand. The agent never logs in. Without a login, anything that needs an account (Like, Subscribe, Save) fails.
3. Open Chrome on the primary display, on the YouTube page you want to act on.

## Stopping a run

Look away from the screen for 5 seconds (the Stop Gesture). The run is aborted and the agent goes straight to sleep, with no "Done" banner.

The mouse can't leave a single display, so in a dev run press Cmd+Shift+L to toggle Look Away on and off. The terminal logs `[dev] look away on` or `off`.

## What to look for in the log

- `[intent-run] start …` when a run begins.
- `[intent-run] stop request=N` when the Stop Gesture reaches the run.
- `[intent-run] done request=N ok=… stopped=… ms=… backend=… intent="…" summary="…"` when it ends. A run that hits the 90 second limit ends with `summary="Timed out after 90 s"`.
- `[intent-run] screenshots and run.json in <dir>` after it ends.
- `[agent-check] action N <name> <input> ok` for each action on the Claude Code backend, or `error: Stopped by the user` for one refused after a stop.
- `Another run is going` on the banner means a run, or an agent check from Cmd+Shift+A, was still in progress.

Each run saves to `~/Library/Application Support/oculus-agent/intent-runs/<timestamp>/`: the screenshots Claude saw and a `run.json` with the result and config.

## Results on the demo laptop

Fill in after each run on the demo laptop.

| Date | Intent | Backend, model | Run | Outcome |
|---|---|---|---|---|
| 2026-11-07 | Open this video | claude-code, claude-sonnet-5-5 | 7.4 s | Looked at a recommended video on a signed-in YouTube watch page. Suggestions in 4.9 s: "Open this video", "Open a related video", "Scroll down for more videos". The agent clicked that thumbnail and Chrome opened it. "Skip the ad" wasn't offered, though a Sponsored card was on the page. |
| 2026-11-07 | Open this video, stopped | claude-code, claude-sonnet-5-5 | 2.5 s | Look Away (Cmd+Shift+L, `lookAwayMs` 1500) right after the run started. `stopped=true`, no actions ran, no `claude` or hands process was left and the URL didn't change. |
| 2026-11-07 | Skip the ad | claude-code, claude-sonnet-5-5 | 7.8 s | No live ad showed, so this used `scripts/youtube-ad-mock.html`. Looking at a sidebar card, not the player, still gave "Skip the ad" first. The agent clicked Skip Ad and the "Done:" banner showed. |

macOS 26.6.2, 1470 x 956, dev mouse input with Cmd+Shift+Space for the Select Blink.

## Known limits

- It acts on the primary display and the frontmost Chrome window only.
- The agent never signs in. A signed-out YouTube may show a consent or login wall, and the run then ends as "Couldn't finish".
- An unskippable ad, or a countdown longer than 10 seconds, ends the run as "Couldn't finish".
- One run at a time. Choosing an Intent while an agent check is running ends at once with "Another run is going".
- The summary is Claude's own one-line description of what it did. It can be wrong, so check the page.
- Stopping kills Claude Code at once (SIGTERM, then SIGKILL after 2 seconds) and the hands refuse every further action. On the API backend it cancels the model call and runs no further action. A click or key press already under way still lands.
- Screenshots and `run.json` stay on disk and may show anything on the screen. Delete old runs from the folder above.
