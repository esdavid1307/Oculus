# Gaze check

A standalone webcam gaze test for #5. It measures WebGazer or a MediaPipe iris tracker on the demo laptop. It doesn't touch the Electron app.

1. Run `npm run gaze-check` and open the printed `localhost` address in Chrome. That tests WebGazer. Add `?tracker=mediapipe` to the address to test the MediaPipe iris tracker.
2. Allow the camera. Sit as you will for the demo and centre your face in the box.
3. Press Start and follow the dot with your eyes. Calibration covers the corners, then 15 test points follow. It takes about 90 seconds.
4. Press Copy results and paste them into a comment on #5.

Repeat a few times, ideally with more than one person and in the demo room's lighting, because one run says little.

To see what a tracker does, add `view=free` to the address, such as `?tracker=mediapipe&view=free`. After calibration, your camera preview returns to the top left corner and a live dot shows the tracker's estimate, smoothed over 300 ms like a cursor. The heat map draws the raw samples. Look at the centre box for 3 seconds to start the heat map. Blink 4 times within 3 seconds to recalibrate, which clears the map (MediaPipe only, because WebGazer has no blink signal). Press Esc, or look off screen for 5 seconds, to freeze the map. Losing your face counts as off screen. This mode skips the test points and gives no report. Use `view=cursor` instead for the same flow with only the dot, which is what a real user would see.

The scores are for gaze smoothed over 300 ms, as a real gaze source must send it. Corner targets use a Gaze Region radius of 0, so they are a worst case.

Both trackers use the same calibration points, test targets and scoring. WebGazer gets 3 calibration samples per point, because it keeps only its last 50. The MediaPipe tracker uses every frame of the dwell.

The page's Content-Security-Policy blocks all network access beyond `localhost`, because MediaPipe otherwise posts usage logs to Google. The face model `src/gaze-check/face_landmarker.task` is stored in the repo, because it isn't part of the npm package.

The suggested verdict ignores steady offsets. It's "too jittery or slow for a full keyboard" when jitter alone stops the 29 keys a keyboard needs from fitting on screen, or gaze arrives at under 10 samples per second. Otherwise it's "steady enough for a full keyboard", even if corner holds failed: then read the corner lines, because the target may need to grow or calibration may need redoing. If `lost` is high, fix the lighting or face position and run again before trusting the verdict.

"Steady" doesn't mean "accurate": a tracker that ignores your eyes and always reports the screen centre is perfectly steady. Always read the verdict alongside the median error.

Key counts leave no room for showing the typed text, so treat them as an upper limit.

The report ends with each target's mean offset. If every target is off by about the same amount, the error is a shift. If the offset changes steadily across the screen, the mapping is curved, which is the case for adding quadratic terms.

Samples per second counts camera frames for the MediaPipe tracker. For WebGazer it follows its own prediction loop, so don't compare the two.

## MediaPipe test

Use the same laptop, tester, lighting and sitting position as the WebGazer runs.

1. Run 3 sessions with the head kept still.
2. Run 1 extra session with natural small head movement. Calibrating with a still head gives the regression little to learn about head pose, so this shows whether movement breaks it.
3. Paste the reports into a comment on #5.

## Decision rule

The target is a key of about 189 px, so that 29 keys fit at 1512 x 949. WebGazer managed 4 of 18 corner holds at 240 px.

- **Adopt MediaPipe** if the smallest usable key, including steady offset, reaches the target on most runs and corner holds are clearly better than 4 of 18.
- **Qualified pass** if only the key size with steady offset removed reaches the target, and the median error shows the gaze still follows the dots. The remaining error is then a calibration or Gaze Correction problem.
- **Otherwise** the webcam can't support a full keyboard. Record that and design for larger targets, such as grouped letters or Suggested Intents.

#5 allows a half-day test at most, and #8 is blocked on it. If time runs out, record what was measured instead of continuing to tune.
