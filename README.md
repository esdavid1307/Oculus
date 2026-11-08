# Oculus

### Giving a voice to those who cannot speak.

Oculus is an AI-powered, eye-controlled communication system designed for people with limited mobility or speech impairments, including individuals living with ALS, cerebral palsy, or other conditions affecting their ability to communicate.

Inspired by Stephen Hawking's predictive communication system, Oculus allows users to type, construct sentences, and speak using only their eyes and a standard webcam.

**No expensive eye-tracking hardware. No physical keyboard. Just your eyes.**

## The Problem

For individuals with severe mobility impairments, something as simple as asking for water or expressing a thought can be extremely difficult.

Traditional assistive communication devices can cost thousands of dollars and often require specialized hardware.

Stephen Hawking used a predictive keyboard controlled by a cheek-muscle sensor to communicate. His system reduced the number of characters he needed to enter by predicting words as he typed.

Oculus builds on this idea by replacing physical input with webcam-based eye tracking and using AI to help users communicate more efficiently.

## Our Solution

Oculus transforms an ordinary laptop into an eye-controlled communication device.

Using computer vision, the system estimates where a user is looking on the screen. Users can select letters, words, or entire phrases by maintaining their gaze on an option.

Instead of typing every letter, an AI-powered prediction engine suggests words and complete sentences based on what the user has already entered.

Once the user confirms a message, the application converts it into audible speech.

## Key Features

### 👁️ Webcam Eye Tracking
- Track eye gaze using a standard webcam.
- Calibrate gaze estimates to screen coordinates.
- Navigate the interface without a mouse or keyboard.
- Smooth gaze predictions to reduce accidental selections.

### ⌨️ Eye-Controlled Keyboard
- Select letters by looking at them.
- Customizable dwell time for selection.
- Large, accessible keyboard targets.
- Visual feedback showing selection progress.

### 🧠 AI-Powered Predictive Typing
- Predict words from partial input.
- Suggest complete sentences based on conversation context.
- Reduce the number of selections needed to communicate.
- Allow users to accept, reject, or edit suggestions.

### 🔊 Text-to-Speech
- Convert completed messages into spoken audio.
- Support customizable voices and speech speed.
- Speak only messages explicitly confirmed by the user.

### 💬 Quick Communication
Provide immediate access to common phrases, including:
- "Yes"
- "No"
- "I need help"
- "I need water"
- "I'm in pain"
- "Thank you"

### 🔒 Privacy-First Design
- Process webcam data locally wherever possible.
- Avoid storing or uploading raw video.
- Support offline communication through local prediction and speech synthesis.

## How It Works

**1. Webcam Tracking**

The user's webcam captures facial landmarks and eye movements. A gaze-estimation model estimates where the user is looking on the screen.

**2. Calibration**

The user looks at several points across the display to improve gaze accuracy.

**3. Gaze-Based Selection**

The user looks at an on-screen key or phrase. Holding their gaze for a configurable duration triggers a selection.

**4. Predictive Text**

As the user enters text, the prediction engine suggests possible words and sentences.

For example:

User selects: `I wou`

Predictions:
- I would like
- I would prefer
- I would like some water

The user can select an entire suggestion instead of entering every character.

**5. Speech Generation**

Once the user confirms the sentence, Oculus reads it aloud through text-to-speech.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | React, TypeScript |
| Styling | Tailwind CSS |
| Eye tracking | MediaPipe iris |
| Facial landmarks | MediaPipe Face Landmarker |
| Computer vision | TensorFlow.js / MediaPipe |
| Predictive text | Local autocomplete / LLM API |
| Text-to-speech | Web Speech API |
| Platform | Web browser |

*These are the proposed technologies for the initial implementation.*

## System Architecture

```text
              Webcam
                 |
                 v
        Eye Gaze Detection
                 |
                 v
         Gaze Calibration
                 |
                 v
       Screen Coordinate Mapping
                 |
                 v
        Dwell-Time Selection
                 |
                 v
      Eye-Controlled Keyboard
                 |
                 v
        Predictive Text Engine
                 |
                 v
        User Confirmation
                 |
                 v
         Text-to-Speech
                 |
                 v
           Spoken Audio
```

## Development Roadmap

### Phase 1 — Eye Tracking
- [ ] Set up browser-based webcam tracking.
- [ ] Implement gaze calibration.
- [ ] Display a real-time estimated Gaze Dot.
- [ ] Implement smoothing and dwell-based selection.

### Phase 2 — Communication Interface
- [ ] Build an accessible on-screen keyboard.
- [ ] Add letter and word selection.
- [ ] Implement delete, space, and clear controls.
- [ ] Add text-to-speech functionality.

### Phase 3 — AI Prediction
- [ ] Implement next-word prediction.
- [ ] Generate suggested sentence completions.
- [ ] Add gaze-based prediction selection.
- [ ] Optimize predictions to minimize user effort.

### Phase 4 — Accessibility & Optimization
- [ ] Add adjustable dwell times.
- [ ] Support personalized vocabulary and phrases.
- [ ] Improve tracking under different lighting conditions.
- [ ] Add offline functionality.
- [ ] Evaluate accuracy, communication speed, and usability.

## Development

```sh
npm install
npm run dev        # overlay with the dev-only mouse input
npm run dev:gaze   # overlay with real gaze from the webcam
OCULUS_AGENT_CHECK="<goal>" npm run dev  # one Claude computer-use run in Chrome, see docs/agent-check.md
npm test
npm run typecheck
```

Hold the mouse on the centre box to perform the Start Gesture. Press Cmd+Option+Q to quit, because the overlay ignores clicks.

After the chime, move off the Centre Box, then hold the mouse still on something for 1 second to pick it as the target. Something under the Centre Box needs that move off first, so staying on the box after waking picks nothing. The overlay hides for a moment while it takes a screenshot, then shows "Thinking…" while Claude suggests up to 3 Suggested Intents for that spot. They scan like the Gaze Keyboard: press Cmd+Shift+Space (or do a Select Blink) on the one you want, or on Something else for different suggestions, which tells Claude what you turned down. Choosing one runs it on whatever is on screen, and the overlay shows a banner while it runs and the result after. Look away for 5 seconds to stop a run, or press Cmd+Shift+L in a dev run to toggle Look Away with the mouse. See `docs/youtube-flow.md` and, for continuing an essay in Google Docs, `docs/essay-flow.md`. Suggestions use the same backend and settings as the agent check (`OCULUS_AGENT_BACKEND`, see `docs/agent-check.md`), and the terminal needs the Screen Recording permission. If anything fails, the overlay says there are no suggestions, only Something else is shown, and the log says why.

Press Cmd+Shift+K to open the Gaze Keyboard. This shortcut is dev-only until #13 opens the keyboard from a text box. Click a text box in another app first. The keyboard scans: the highlight steps through the keys, one every 2 seconds. Press Cmd+Shift+Space when it's on the key you want, first a letter group and then a letter. With the camera (`npm run dev:gaze`), a Select Blink does the same: close both eyes for half a second. Done types the text into that box with System Events, so the terminal running `npm run dev` needs the Accessibility permission (System Settings → Privacy & Security → Accessibility). If typing fails, the text is left on the clipboard.

Once awake, look at the Dock, anywhere along the menu bar, or at a Desktop icon that no window covers, for 3 seconds to stick to it. Opening a menu from the menu bar scans its commands next. The highlight then steps through its icons, one every 2 seconds, and a Select Blink (or Cmd+Shift+Space) opens the highlighted one. The agent stays awake afterwards. If the app in front hides the Dock, looking down brings it up with macOS's Ctrl+F3 (Move focus to the Dock) shortcut, which must stay on in Keyboard Shortcuts.

Timings live in `~/Library/Application Support/oculus-agent/config.json`. All are optional:

```json
{ "wakeHoldMs": 3000, "lookAwayMs": 5000, "scanStepMs": 2000, "targetHoldMs": 1000, "iconHoldMs": 3000, "finishedMs": 3000, "wordPrediction": true }
```

Large View is on by default. It makes the Dock icons big while Oculus runs (`dockIconSize`, 48 to 128, default 96), shows the highlighted icon's name in a large panel during an Icon Scan, and scales the overlay's own text, Gaze Dot and outlines (`uiScale`, 1 to 2, default 1.25). Set `"largeView": false` to turn it all off. Bad values fall back to the defaults. The Dock's original size is saved to `dock-size.json` next to `config.json` and put back on quit, or on the next start after a crash. Dock magnification is left alone.

```json
{ "largeView": true, "uiScale": 1.25, "dockIconSize": 96 }
```

The Gaze Keyboard suggests words and learns the user's own words and phrases from text confirmed with Done, see `docs/word-prediction.md`.

## Hackathon Demo

Our goal is to demonstrate hands-free communication using only a standard laptop webcam.

A user will:

1. Calibrate their eye tracking.
2. Navigate the keyboard without moving their hands.
3. Select a few letters or words using eye gaze.
4. Choose an AI-predicted sentence.
5. Have Oculus speak the message aloud.

We will also compare traditional gaze-based letter-by-letter typing against AI-assisted predictive typing to measure reductions in selections and communication time.

## Challenges

Webcam-based eye tracking is less precise than specialized eye-tracking hardware. Accuracy can vary depending on lighting, camera placement, glasses, and individual eye movement.

To address these challenges, Oculus will focus on large selection targets, calibration, gaze smoothing, and predictive text that minimizes the number of required selections.

Oculus is an experimental assistive communication project and is not currently a validated replacement for dedicated AAC devices.

## Our Vision

Communication should not depend on someone's ability to move their hands or speak.

Our long-term goal is to make assistive communication more affordable, accessible, and intelligent through software that runs on devices people already own.

**Your eyes. Your words. Your voice.**

---

Built for natHacks 2026 — Healthcare & Accessibility.
