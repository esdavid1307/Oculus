# Gaze Correction

Gaze Correction learns this user's tracking error from their confirmed selections and shifts the Gaze Region to cancel it (#16). The demo doesn't depend on it.

## What it learns from

Today the confirmed selections are Gaze Keyboard presses. Each press gives one example: the uncorrected gaze, averaged over the dwell, and the centre of the key the user chose.

Examples wait until Done confirms them. Anything the user takes back never teaches it:

- Delete drops both presses of the character it removes, the group and the letter.
- Back drops the group it backs out of.
- The Stop Gesture and recalibration drop everything not yet confirmed.

## The network

A small TensorFlow.js network runs in the main process. It takes a screen position, scaled to -1 to 1, through 16 tanh units, and outputs the shift that lands the gaze on what the user chose. The output is tanh too, so no shift can exceed 150 px on either axis.

- It starts once there are 8 examples, and keeps the last 400.
- It retrains from scratch on every example after each Done. That takes milliseconds at this size, and it can't drift.
- It learns both a steady offset and an error that changes across the screen, such as a calibration that is too narrow.

Every Gaze Region goes through it before the session hit-tests the Centre Box and keys. The Gaze Dot shows the corrected gaze, so it sits where selections land. Look Away uses the uncorrected gaze, so a learned shift can never hide or fake the Stop Gesture.

Only positions are kept, in memory. No video is stored, and nothing leaves the machine.

## Reset and off switch

- Every calibration resets it, the first included, because offsets learned under one calibration don't apply to the next. The gaze source sends a `recalibrated` event, see [gaze-events.md](gaze-events.md).
- The **Reset gaze** key on the Gaze Keyboard resets it by gaze. It takes twice the key dwell, so a passing look can't throw away what was learned.
- `"gazeCorrection": false` in `~/Library/Application Support/oculus-agent/config.json` switches it off.

## Watching it learn

`OCULUS_MOUSE_SHIFT="-100,50" npm run dev` makes the dev-only mouse input read every look 100 px left and 50 px down, like a badly calibrated webcam. Type a word with Cmd+Shift+K and press Done. The terminal logs what was learned:

```
Gaze Correction trained on 11 confirmed selections, shifting the screen centre by 101, -50 px
```

That run, typing "hello" on the demo laptop, cancelled the simulated error to within 1 px.

Known limits:

- Only Gaze Keyboard presses teach it. Suggested Intents (#9) should add their confirmed choices once they exist.
- The key centre is taken as where the user looked. Large keys make that rough, so it learns slowly from a few presses.
