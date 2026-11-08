# Agent check

A check for #6: can Claude, called from the Electron app, perform one real action on the demo laptop? Each run takes a screenshot, asks Claude for the next computer use action, performs it through macOS, and repeats until Claude is done. By default the goal is to click Chrome's address bar, type `example.com` and press Return.

It proves three things at once: the screenshot shows the screen without the overlay, Claude's coordinates land on the right pixel, and the keystrokes reach Chrome. The gaze flow is not involved. The Intent flow replaces this entry point later.

## Setup

1. Run `cp .env.example .env` and put your key after `ANTHROPIC_API_KEY=`. The key comes from console.anthropic.com. It is separate from a Claude subscription, which doesn't include API access.
2. Grant three permissions to the terminal app that runs `npm run dev` (Terminal, iTerm, Ghostty or VS Code), not to Electron. macOS attributes a child process to the terminal that started it. All are under System Settings → Privacy & Security.
   - Screen & System Audio Recording, for screenshots.
   - Accessibility, for clicks and key presses.
   - Automation → System Events. macOS asks the first time the agent types.
3. Quit and reopen the terminal after granting, because macOS only applies a permission to new processes.
4. Open Google Chrome with a window on the primary display.

The startup log lists which permissions macOS reports as granted.

## Run

There are two triggers.

- **Env:** `OCULUS_AGENT_CHECK="<goal>" npm run dev` runs once, 1 second after the overlay loads so the Centre Box is drawn, then quits with exit code 0 if the action reached the OS and 1 if not. Add `OCULUS_AGENT_KEEP_OPEN=1` to stay open.
- **Shortcut:** press Cmd+Shift+A in a dev run. It uses `OCULUS_AGENT_CHECK` or the default goal, and never quits. It is dev-only until the Intent flow exists. A run in progress blocks a second one.

Settings are read from `.env` or the shell. The shell wins.

| Variable | Default | Meaning |
|---|---|---|
| `OCULUS_AGENT_CHECK` | none | The goal. Required for the env trigger. |
| `OCULUS_AGENT_BACKEND` | `claude-code` | `claude-code` runs Claude Code in the background on your own Claude login. `api` calls the Claude API and needs `ANTHROPIC_API_KEY`. |
| `OCULUS_AGENT_KEEP_OPEN` | off | `1` keeps the app open after an env run. |
| `OCULUS_AGENT_MODEL` | `claude-sonnet-5-5` | The model. |
| `OCULUS_AGENT_EFFORT` | `low` | `low`, `medium`, `high`, `xhigh` or `max`. Anything else is ignored. |
| `OCULUS_AGENT_MAX_STEPS` | `5` | Most model calls in a run. At most 20. |
| `OCULUS_AGENT_SHOW_OVERLAY` | off | `1` leaves the overlay in the screenshots. |

## What you see

Every line starts with `[agent-check]`. A run logs the permissions, then for each step the model call (milliseconds, tokens, stop reason), each action with its screen point, and the final text from Claude. The last line is `screenshots and run.json in <dir>`.

Each run saves to `~/Library/Application Support/oculus-agent/agent-check/<timestamp>/`:

- `shot-N.png` is exactly the image sent to the model on step N.
- `run.json` has the result (calls, actions, final text, error) and the config.

If `ANTHROPIC_API_KEY` is missing, the run logs `ANTHROPIC_API_KEY missing: copy .env.example to .env` and fails without calling anything. If Accessibility is missing, it fails the same way with `Accessibility is not granted to the app running npm`.

## How the overlay stays out of the shots

The overlay is always on top, so a plain screenshot would show it and Claude might aim at it. Before each capture the overlay's opacity goes to 0 for about 150 ms, then returns.

`setContentProtection` is not used. ScreenCaptureKit on macOS 15 and later ignores `NSWindowSharingNone`, so it wouldn't hide the overlay, and it would also hide the overlay from the team's demo recordings.

The overlay stays visible during the model call and the clicks. Clicks go through it because it ignores mouse events.

Set `OCULUS_AGENT_SHOW_OVERLAY=1` as a negative control. The overlay then stays in the shots, so compare `shot-1.png` with and without it to see why hiding matters.

## The Claude Code backend

By default the run needs no API key. The Oculus Agent starts `claude -p` in the background, never shown to the user, and it uses the Claude login of whoever runs `npm run dev`.

1. The Oculus Agent takes the first screenshot, with the overlay hidden, and passes its path in the prompt.
2. Claude Code can only touch the computer through `scripts/oculus-hands.mjs`, which takes the computer use action names: `node scripts/oculus-hands.mjs left_click '{"coordinate":[600,85]}'`.
3. The script forwards each action to the Oculus Agent on a localhost port with a random token. The Agent hides the overlay for screenshots and performs input through the same Accessibility-checked executor as the API backend.
4. Claude Code is allowed only that script and `Read`, which it uses to look at the screenshots. Web, file-writing and agent tools are denied, and your own settings, plugins, hooks and MCP servers are left out.

The log gets one `[agent-check] claude code run: <N> ms` line for the whole run, not one per model call. A dry run against a fake hands server took about 11 s for click, type, Return and a check screenshot, 7.3 s of it model time.

## Model choice

`claude-sonnet-5-5` at `low` effort, because latency matters more than depth for one step of a click or a key press. It uses the GA `computer_toolset_20260801` tool, which needs no beta header and no display size. Screenshots are scaled so the longest edge is at most 1280 px, to keep each call fast. Override the model or effort to compare.

## Results on the demo laptop

Fill in after each run on the demo laptop. The Claude Code backend times the whole run, not each model call.

| Date | Backend, model | Run (model time) | Outcome |
|---|---|---|---|
| 2026-11-07 | claude-code, claude-sonnet-5-5 | 13.7 s (5.9 s) | Address bar, `example.com`, Return. Chrome went from wikipedia.org to example.com. Both shots had no overlay. |
| 2026-11-07 | claude-code, claude-sonnet-5-5 | 4.1 s (2.8 s) | Negative control with `OCULUS_AGENT_SHOW_OVERLAY=1`. Claude described the Centre Box, so hiding is what keeps it out. |
| 2026-11-07 | claude-code, claude-sonnet-5-5 | 10.3 s (5.7 s) | Clicked Wikipedia's search box at (678, 647), inside the Centre Box, through the overlay. Chrome opened the Eye tracking article. |

macOS 26.6.2, 1470 x 956 display, screenshots at 1280 x 832. Run from the VS Code terminal with Accessibility and Screen & System Audio Recording granted to VS Code.

## Known limits

- It acts on the primary display only.
- The goal runs in whatever Chrome window is frontmost. The run brings Chrome to the front first, but doesn't open a window if there is none.
- Without Accessibility, macOS drops clicks and key presses without any error. So the run checks Accessibility before the first model call, and every click or key script checks it again, and fails with a pointer to this page. Typing goes through System Events, which also needs the Automation permission.
- A run can't be cancelled other than by `OCULUS_AGENT_MAX_STEPS` or Ctrl+C in the terminal.
- The Gaze Dot is part of the overlay, so it is hidden from the shots too, and Claude can't see where the user is looking.
- Screenshots and `run.json` stay on disk, and they may show anything on the screen. Delete old runs from the folder above.
- The key is sent to the Anthropic API from the main process only. It is never given to the overlay page.
