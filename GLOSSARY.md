# Oculus Agent

A desktop assistant that lets non-verbal people with severe motor disabilities get things done on a computer by looking at what they want, while an AI agent carries out the steps.

## Language

**Oculus Agent**:
The product: gaze expresses the goal and an on-screen AI agent performs the work.
_Avoid_: GazeAgent, Oculus (on its own)

**Intent**:
A goal the user wants done, such as skipping an ad, stated as one outcome and not as individual clicks.
_Avoid_: Command, task, action

**Suggested Intent**:
One of a few Intents the agent offers for the user to choose between; choosing one is the user's confirmation.
_Avoid_: Prediction, guess

**Time to Action**:
The seconds from the Start Gesture finishing waking the agent (or from the last icon opened, when the agent stayed awake after it) to the Select Blink that chose the Intent. It counts waiting for Claude and scanning the picker. It is only logged (`[intent-run] time-to-action=...`), never shown on screen.
_Avoid_: Latency, response time

**Intent History**:
The Intents this user chose before that ran ok, kept per app on this machine, and per site in Chrome when `"historyPerSite": true` is set (never for Incognito windows). Up to 2 of the usual ones for the app in front show, a site's own first and then the app's, at once when a target is picked, and Claude's Suggested Intents are added after them without moving anything. "Skip the ad" is never kept. Ranked by count and recency, or by an optional small neural ranker (`"intentRanker": "neural"` in config.json).
_Avoid_: Memory, favourites

**Gaze Keyboard**:
The on-screen keyboard that pops up so the user can fill in text. It scans, highlighting one key at a time, and a Select Blink presses the highlighted key.
_Avoid_: Virtual keyboard, typing mode

**Text Box**:
A text field, text area or search box the user can look at as the target after waking, which opens the Gaze Keyboard directly instead of going through Suggested Intents. The typed text lands in it.
_Avoid_: Input, form field

**Suggested Word**:
One of up to three words the Gaze Keyboard offers, scanned first (after the Suggested Phrases, when there are any), to finish the word being typed or to follow the last one. Choosing it types the whole word, and confirmed words teach the predictor.
_Avoid_: Prediction, autocomplete, autofill

**Gaze Region**:
The area of the screen the user is probably looking at, always treated as an area and never as an exact point.
_Avoid_: Gaze point, cursor

**Gaze Correction**:
The personal adjustment learned from a user's confirmed selections that makes their Gaze Region more accurate. Part of the Neural Layer. It is only used once it has been shown to help, and starts again after every calibration.
_Avoid_: Adaptation, personalization, training

**Gaze Dot**:
The on-screen marker showing the user the centre of their Gaze Region.
_Avoid_: Cursor, pointer

**Centre Box**:
The large box in the middle of the screen, shown only while the agent is asleep, that the user looks at to wake it.
_Avoid_: Start Box, Wake target, corner target

**Select Blink**:
Both eyes closed for half a second, which presses the highlighted key or opens the highlighted icon. Natural blinks are too short to count.
_Avoid_: Click, wink

**Gaze Scan**:
How the user chooses one of several options without pointing at it. The highlight steps through the options in an order that stays fixed for the whole scan, one every 2 seconds by default (`scanStepMs`, or the learned Scan Pace), back to the first after the last, and a Select Blink chooses the highlighted one. Gaze only decides which set gets scanned, by holding on a target, near the Dock, the menu bar or a Desktop icon, or for 3 seconds on named elements in Chrome when `"chromeScan": true` is set, and never which option in it is chosen, so an inaccurate Gaze Region can't pick the wrong one. The Gaze Keyboard, the Suggested Intents, Icon Scan and the Chrome elements all scan this way. A Chrome element is never opened: choosing one asks for Suggested Intents about it. Each press on the Gaze Keyboard starts again from its first key. Icons are put in Icon Order and Chrome elements nearest the gaze first, fixed when their scan starts, and Suggested Intents that arrive later join the end without moving the highlight. The Stop Gesture ends a scan without choosing anything, and so does Close among the Suggested Intents.
_Avoid_: Gaze Snap, snapping, auto-scan, cycling

**Icon Scan**:
Looking near the macOS Dock, anywhere along the menu bar (with Chrome in front, only with the gaze centre on it or past the top edge, so the tabs and address bar just under it keep their 1 second hold), or near any Desktop icon that no window covers, for 3 seconds while the agent is awake sticks to it. The highlight then steps through all of its icons, and a Select Blink opens the highlighted one. A menu bar item that opens a menu starts a second scan over its commands. The agent stays awake afterwards.
_Avoid_: Dock Scan, Dock snap, dock mode

**Icon Order**:
The order an Icon Scan steps through, learned from the icons this user opens so the usual ones come first. Screen order until it has learned anything. Part of the Neural Layer.
_Avoid_: Favourites, icon ranking

**Scan Pace**:
The scan step learned from how fast this user presses once their key is highlighted, between 900 ms and 1.5 times the default. Part of the Neural Layer. It never changes a `scanStepMs` the user set in config.json.
_Avoid_: Scan speed, auto-speed

**Start Gesture**:
The deliberate look at the Centre Box that wakes the agent. It replaced the corner Wake Gesture.
_Avoid_: Trigger, activation, Wake Gesture

**Recalibrate Gesture**:
The run of quick, deliberate blinks that restarts calibration.
_Avoid_: Reset, blink command

**Stop Gesture**:
Gaze off the screen for 5 seconds, which stops the agent. Losing the user's face counts. A countdown ("Stopping in 3…") shows while it runs, and recalibrating counts as a Stop at once, discarding any typed text.
_Avoid_: Cancel, abort

**Look Away**:
Gaze staying off the screen. Held for 5 seconds, it's the Stop Gesture. Only ever means off the screen. During an Icon Scan, gaze just past the edge next to the scanned icons counts as on them, not as Look Away. Not during a scan of Chrome elements, which never sit on the edge.
_Avoid_: Look away (for leaving a key)

**Move Off**:
Gaze leaving a target, such as the Centre Box, while staying on the screen, which restarts that hold.
_Avoid_: Look away

**Large View**:
The mode, on by default, that makes what Oculus does not draw itself big enough to see: a larger Dock, the Icon Magnifier, and a UI Scale on the overlay's own text, Gaze Dot and outlines. Turned off with `"largeView": false`.
_Avoid_: Zoom, accessibility mode

**Icon Magnifier**:
The large panel shown during an Icon Scan with the name of the highlighted icon, on the side of the screen away from it. The highlight frame around a small Dock or Desktop icon is grown to a minimum size; the frame around a menu bar item, a menu command or a Chrome element fits the item's bounds plus a small padding, so the user can see exactly which one is highlighted.
_Avoid_: Tooltip, zoom

**Suggested Phrase**:
An earlier-submitted text the Gaze Keyboard offers, in a wide key scanned before the Suggested Words, once 2 or more typed letters match its start. Up to two are shown at a time, ranked by how often and how recently they were sent. Choosing one replaces everything typed so far.
_Avoid_: Autocomplete, saved message

**Neural Layer**:
Where every choice the user confirms goes to teach Oculus about them: Gaze Correction, Icon Order and Scan Pace. Off with `"neuralLayer": false` in config.json. See `docs/neural-layer.md`.
_Avoid_: AI layer, learning mode, personalization
