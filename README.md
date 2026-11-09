# Oculus Agent

**A macOS assistant that turns gaze-based intent into fewer, simpler computer interactions.**

Built for **natHacks 2026** · Healthcare & Accessibility

## The problem

People with severe motor disabilities, including some people living with ALS or cerebral palsy, may be able to move their eyes even when using a mouse or keyboard is difficult. Existing gaze-control approaches make basic computer tasks possible, but they treat the eyes as a mouse: every click, button and text field takes a slow, precise fixation. Finding one video can take dozens of them, and that is tiring. Dedicated eye-tracking hardware also costs thousands of dollars, and an ordinary webcam is too coarse for precise pointing.

Oculus Agent explores a different model: instead of using eye movement as a replacement mouse, the user indicates **what they want to do**, and an AI agent handles the steps.

## How it works

1. **Wake.** The user looks at the Centre Box in the middle of the screen for 3 seconds. A ring fills and a chime plays, so a passing glance never wakes it.
2. **Point at what matters.** The user holds their gaze on something for 1 second: a YouTube video, an essay in Google Docs, a text box. Gaze is always treated as a rough area (a Gaze Region), never an exact point.
3. **Choose.** The overlay hides for one screenshot, and Claude suggests a few Intents for that spot, such as "Skip the ad" or "Continue the essay". They appear as large tiles next to Fixed Intents that never need Claude (Cancel, Quit, Minimize, Type, Dock). A highlight steps through the tiles, and a **Select Blink** (both eyes closed for half a second) chooses the lit one. Choosing is the user's confirmation. "Something else" asks for different suggestions.
4. **Let the agent work.** Claude does every click and keystroke in a computer-use loop: screenshot, next action, perform it, repeat. A banner shows what it's doing right now.
5. **Stop at any time.** Looking off the screen for 5 seconds stops any run, with a visible countdown. Losing the user's face counts too.

The goal is to reduce repeated gaze selections, **not** to remove user control.

## What works today

Everything below is on `main` and runs with the laptop webcam.

- **Webcam gaze tracking.** MediaPipe Face Landmarker iris tracking runs locally, with calibration and 300 ms smoothing. A blink sequence restarts calibration.
- **Suggested Intents and the agent.** Claude suggests Intents for the spot the user looked at, then runs the chosen one. Two demo flows are tested end to end: continuing an essay in Google Docs ([docs/essay-flow.md](docs/essay-flow.md)) and YouTube, including picking a related video and skipping an ad ([docs/youtube-flow.md](docs/youtube-flow.md)).
- **Fixed Intents.** Cancel, Quit (names the app it will quit), Minimize, Type and Dock show in every picker immediately. With Chrome in front, Search joins them, and a Chrome tile scans New Tab, Next Tab and Close Tab ([docs/fixed-intents.md](docs/fixed-intents.md)).
- **Gaze Keyboard.** A full-screen scanning keyboard where each letter takes two Select Blinks (a group, then a letter). It opens by looking at a text box or choosing Type. Done types the text into that box, presses Return in single-line fields such as search boxes, and sends in Messages.
- **Word and phrase suggestions.** Up to three Suggested Words finish the current word or predict the next one, and up to two Suggested Phrases offer texts the user sent before. Both learn the user's own words ([docs/word-prediction.md](docs/word-prediction.md)).
- **Icon Scan.** A 3 second look at the Dock, the menu bar or a Desktop icon scans its icons, and a Select Blink opens one. Menus scan their commands next.
- **Gaze Scan in Chrome** (optional). A 3 second look at named things in Chrome, such as a video title or the Skip Ad button, scans the elements nearby ([docs/chrome-scan.md](docs/chrome-scan.md)).
- **Learning from confirmed choices.** Gaze Correction learns the user's tracking offset, Icon Order puts their usual icons first, and Scan Pace adapts to how fast they blink ([docs/neural-layer.md](docs/neural-layer.md)). Intent History offers their past Intents for the app or site in front straight away. Only confirmed choices teach it: a stopped run never does.
- **Large View** (on by default). Bigger Dock icons, a magnified label for the highlighted icon, and scaled overlay text.
- **Time to Action.** Each run logs the seconds from waking to the chosen Intent starting, as the measure of whether Oculus got faster.

## Results: is webcam gaze good enough?

Before building on any tracker, we wrote a gaze check harness ([docs/gaze-check.md](docs/gaze-check.md), `npm run gaze-check`) and compared WebGazer with MediaPipe iris. All runs were at 1512 × 949 with one tester.

| Measure | WebGazer (3 runs) | MediaPipe still (3 runs) | MediaPipe, head moving (1 run) |
| --- | --- | --- | --- |
| Median error | 92 to 174 px | 66 to 154 px | 114 px |
| Jitter | 55 to 146 px | 20 to 29 px | 15 px |
| Corner holds at 240 px | 4 of 18 | 8 of 18 | 3 of 6 |

MediaPipe won, but most of its error is a steady offset, too large for small dwell targets. That result shaped the design: options **scan** one at a time and a blink confirms, so gaze only has to land in the right general area.

## Key design choices

### Intent, not micro-clicking

Traditional gaze control needs many separate selections. Oculus lets users express a higher-level Intent and the agent performs the intermediate steps.

### Deliberate activation

A 3 second hold with a filling ring wakes the agent, and a half-second Select Blink is long enough that natural blinks don't count. This avoids the *Midas touch* problem, where everything looked at gets activated.

### Explicit user control

Nothing runs until the user chooses a tile, and looking away always stops a run. Choices are large and readable, with Cancel and Something else always available.

### Webcam-first accessibility

Oculus runs on an ordinary laptop webcam rather than a dedicated eye tracker. Accuracy, lighting and calibration remain real limitations, which is why the interface scans instead of asking for precise pointing.

## Privacy

- Camera frames and gaze are processed on the computer. **No video leaves the machine** and none is stored.
- After the user picks a target, a screenshot of the screen goes to Anthropic's Claude to suggest and run Intents. Screenshots are only taken after the user asks for something, never streamed.
- Learning data (Gaze Correction, Intent History, the user's words and phrases) stays on the computer in `~/Library/Application Support/oculus-agent/`.

Oculus is therefore not fully local. A local-only mode is planned (#90).

## Run locally

### Requirements

- **macOS** on a Mac with a webcam. Windows and Linux aren't supported.
- **Node.js** and **npm**.
- **Google Chrome**, for the demo flows.
- **Claude access**, either:
  - **Claude Code** installed and signed in (`claude` on your PATH). This is the default backend and uses your own Claude login.
  - Or an API key from console.anthropic.com, with `OCULUS_AGENT_BACKEND=api`. Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`.
- **Xcode Command Line Tools**, only for the optional Gaze Scan in Chrome.

### Permissions

Grant these to the terminal app that runs `npm run dev`, then quit and reopen the terminal. They're all under System Settings → Privacy & Security.

- **Camera**, for gaze.
- **Screen & System Audio Recording**, for screenshots.
- **Accessibility**, for clicks and key presses.
- **Automation → System Events**, which macOS asks for the first time the agent types.

### Setup

```sh
npm install
npm run dev:gaze   # the app with real gaze from the webcam
npm run dev        # the app with a dev-only mouse stand-in for gaze
npm run gaze-check # the standalone gaze accuracy test, opens in Chrome
npm test
npm run typecheck
```

Press Cmd+Option+Q to quit, because the overlay ignores clicks.

### Try it

1. Run `npm run dev:gaze` and follow the calibration dots.
2. Look at the Centre Box until the ring fills and the chime plays.
3. Look at a YouTube video or a Google Doc for 1 second.
4. When the tiles show, blink for half a second on the one you want.
5. Look away from the screen for 5 seconds to stop.

In a dev run, Cmd+Shift+Space stands in for a Select Blink and Cmd+Shift+L toggles Look Away. With `npm run dev`, holding the mouse still stands in for gaze.

### Configuration

Timings and options live in `~/Library/Application Support/oculus-agent/config.json`. All are optional, and bad values fall back to the defaults.

```json
{
  "wakeHoldMs": 3000, "lookAwayMs": 5000, "scanStepMs": 2000, "targetHoldMs": 1000,
  "iconHoldMs": 3000, "finishedMs": 3000, "wordPrediction": true,
  "largeView": true, "uiScale": 1.25, "dockIconSize": 96,
  "neuralLayer": true, "chromeScan": false, "historyPerSite": false
}
```

- `uiScale` ranges from 1 to 2.
- `dockIconSize` ranges from 48 to 128. The Dock's original size is put back on quit.
- `"intentRanker": "neural"` ranks past Intents with a small learned ranker instead of by count and recency.

Agent settings (model, effort, step limit, backend) are environment variables, listed in [docs/agent-check.md](docs/agent-check.md).

## Architecture

```text
Webcam ── MediaPipe iris (local) ──┐
Dev mouse stand-in ────────────────┤
                                   v
                    Gaze events (docs/gaze-events.md)
                                   |
                                   v
         Session core: wake, target, picker, keyboard, run, stop
          |                        |                       |
          v                        v                       v
   Overlay (Electron)      Intent engine (Claude)   Agent loop (Claude computer use)
   Centre Box, tiles,      screenshot + Gaze Region  screenshot → action → System Events
   Gaze Keyboard, banner   → Suggested Intents       / Swift Accessibility helper
                                   |
                                   v
                 Neural Layer and Intent History (local)
```

The session core takes gaze events and timer ticks and returns overlay state and agent actions. Its tests run with no webcam, network or real clicks. The dev mouse input sends the same gaze events as the camera, so the team could build the flow before tracking worked.

**Stack:**
- Electron and TypeScript, built with electron-vite.
- MediaPipe Tasks Vision for gaze.
- The Anthropic SDK and Claude Code for the agent.
- AppleScript/JXA and a small Swift helper for macOS control.
- Vitest for tests.

## Challenges and next steps

### Challenges

- **Webcam gaze is coarse.** Median error is often over 100 px, mostly as a steady offset. We switched from dwell keys to scanning, and Gaze Correction learns the offset.
- **Gaze overshoots screen edges.** A look at the Dock can land well below the display. Near the scanned icons, gaze just past the edge counts as on them, not as Look Away.
- **The agent had to see the screen, not the overlay.** The overlay hides for each screenshot, and Claude's clicks had to land on the right Retina pixels.

### Next steps

- **Safety limits enforced in code (#12).** Today, the rule against logins, passwords and payments is an instruction to Claude only. Next, the session core blocks them and asks for confirmation before anything is sent or deleted.
- **Accessibility audit (#78).** We audited Oculus against WCAG 2.2 AA, Section 508 and EN 301 549 and filed 13 fixes (#79 to #91):
  - switch and keyboard input
  - keeping a draft when typing is interrupted
  - an adjustable Select Blink length and a one-eye option
  - errors shown on screen
  - AA contrast
  - screen reader roles
  - a local-only mode
- **Demo readiness (#15).** Launching at login and checking every flow with eyes alone on the demo laptop.
- **User testing.** Measure whether Oculus reduces effort compared with ordinary gaze navigation, with the people it's for.

This is a hackathon prototype and accessibility concept, **not a clinically validated assistive technology** or a replacement for dedicated AAC devices. It doesn't speak typed text aloud: it's for computer access, not spoken communication. Accessibility standards inform the design, but conformance hasn't been reached or evaluated yet.

## Built at natHacks 2026

Developed during the 64-hour natHacks 2026 competition at the University of Alberta. Work was split into GitHub issues and reviewed pull requests. Terms such as Gaze Region, Select Blink and Look Away are defined in [GLOSSARY.md](GLOSSARY.md).

## Credits and links

- **Team:** Edwin Shaiju David ([@esdavid1307](https://github.com/esdavid1307)), [@fawazm30](https://github.com/fawazm30), [@znafi](https://github.com/znafi), [@DimaLimanets](https://github.com/DimaLimanets), [@Mehrgarithm](https://github.com/Mehrgarithm)
- **Demo:** [Add demo video link]
- **Slides:** [Add slides link]
- **Dependencies, models and data:**
  - [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (Google), for iris and blink tracking
  - [Claude](https://www.anthropic.com/claude) by Anthropic (`claude-sonnet-5-5` by default), through the Anthropic SDK and Claude Code
  - [Electron](https://www.electronjs.org/), [electron-vite](https://electron-vite.org/), [Vite](https://vite.dev/), [Vitest](https://vitest.dev/) and TypeScript
  - The spoken-English word frequency list, from Zeke Sikelianos' SUBTLEX word frequencies package (ISC, see `src/main/words/LICENSE-subtlex`)
  - [WebGazer](https://webgazer.cs.brown.edu/), tested in the gaze check and later removed
- **Inspiration:** Stephen Hawking's predictive communication system, and the eye-gaze AAC tools people with ALS use today.
