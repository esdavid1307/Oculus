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

**Wake Gesture**:
The deliberate look at the top-right corner that tells the agent the user wants something.
_Avoid_: Trigger, activation

**Stop Gesture**:
The deliberate look at the bottom-left corner that halts the agent.
_Avoid_: Cancel, abort
