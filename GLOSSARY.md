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
The on-screen keyboard that pops up so the user can fill in text by gaze.
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

**Start Gesture**:
The deliberate look at the centre box that wakes the agent. It replaced the corner Wake Gesture.
_Avoid_: Trigger, activation, Wake Gesture

**Recalibrate Gesture**:
The run of quick, deliberate blinks that restarts calibration.
_Avoid_: Reset, blink command

**Look Away**:
Gaze staying off the screen long enough to stop the agent. Losing the user's face counts. It replaced the corner Stop Gesture.
_Avoid_: Cancel, abort, Stop Gesture
