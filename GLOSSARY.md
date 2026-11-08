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

**Gaze Keyboard**:
The on-screen keyboard that pops up so the user can fill in text. It scans, highlighting one key at a time, and a Select Blink presses the highlighted key.
_Avoid_: Virtual keyboard, typing mode

**Gaze Region**:
The area of the screen the user is probably looking at, always treated as an area and never as an exact point.
_Avoid_: Gaze point, cursor

**Gaze Correction**:
The personal adjustment learned from a user's confirmed selections that makes their Gaze Region more accurate.
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

**Icon Scan**:
Looking near the macOS Dock, anywhere along the menu bar, or near any Desktop icon that no window covers, for 3 seconds while the agent is awake sticks to it. The highlight then steps through all of its icons, and a Select Blink opens the highlighted one. A menu bar item that opens a menu starts a second scan over its commands. The agent stays awake afterwards.
_Avoid_: Dock Scan, Dock snap, dock mode

**Start Gesture**:
The deliberate look at the Centre Box that wakes the agent. It replaced the corner Wake Gesture.
_Avoid_: Trigger, activation, Wake Gesture

**Recalibrate Gesture**:
The run of quick, deliberate blinks that restarts calibration.
_Avoid_: Reset, blink command

**Stop Gesture**:
Gaze off the screen for 5 seconds, which stops the agent. Losing the user's face counts.
_Avoid_: Cancel, abort

**Look Away**:
Gaze staying off the screen. Held for 5 seconds, it's the Stop Gesture. Only ever means off the screen. During an Icon Scan, gaze just past the edge next to the scanned icons counts as on them, not as Look Away.
_Avoid_: Look away (for leaving a key)

**Move Off**:
Gaze leaving a target, such as the Centre Box, while staying on the screen, which restarts that hold.
_Avoid_: Look away
