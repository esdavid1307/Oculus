# Gaze check

A standalone webcam gaze test for #5. It measures the MediaPipe iris tracker on the demo laptop. The Electron app uses the same tracker and calibration, as described under [Real gaze in the app](#real-gaze-in-the-app).

WebGazer was compared first and removed once MediaPipe won. Its results are on #5, and its code is in git history at `a3902c7`.

1. Run `npm run gaze-check` and open the printed `localhost` address in Chrome.
2. Allow the camera. Sit as you will for the demo and centre your face in the box.
3. Press Start and follow the dot with your eyes. Calibration covers the corners, then 15 test points follow. It takes about 90 seconds.
4. Press Copy results and paste them into a comment on #5.

Repeat a few times, ideally with more than one person and in the demo room's lighting, because one run says little.

The scores are for gaze smoothed over 300 ms, as a real gaze source must send it. Corner targets use a Gaze Region radius of 0, so they are a worst case.

The tracker uses every frame of the calibration dwell.

The page's Content-Security-Policy blocks all network access beyond `localhost`, because MediaPipe otherwise posts usage logs to Google. The face model `src/gaze-check/face_landmarker.task` is stored in the repo, because it isn't part of the npm package.

The suggested verdict ignores steady offsets. It's "too jittery or slow for a full keyboard" when jitter alone stops the 29 keys a keyboard needs from fitting on screen, or gaze arrives at under 10 samples per second. Otherwise it's "steady enough for a full keyboard", even if corner holds failed: then read the corner lines, because the target may need to grow or calibration may need redoing. If `lost` is high, fix the lighting or face position and run again before trusting the verdict.

"Steady" doesn't mean "accurate": a tracker that ignores your eyes and always reports the screen centre is perfectly steady. Always read the verdict alongside the median error.

Key counts leave no room for showing the typed text, so treat them as an upper limit.

The report ends with each target's mean offset. If every target is off by about the same amount, the error is a shift. If the offset changes steadily across the screen, the mapping is curved, which is the case for adding quadratic terms.

Samples per second counts camera frames.

## Watching gaze live

Add `?view=free` to the address to see what the tracker does. This mode skips the test points and gives no report.

1. Press Start and follow the dot through calibration, which takes about 25 seconds.
2. Do the Start Gesture: look at the centre box for 3 seconds. It comes after calibration because there's no gaze position before that.
3. Look around. The Gaze Dot shows the tracker's estimate, smoothed over 300 ms. The heat map draws the raw samples and is for testing only. Your camera preview returns to the top left corner so you can check you're in frame.
4. Do the Recalibrate Gesture at any point after calibration: blink 4 times within 3 seconds. This calibrates again from scratch and clears the map.
5. Press Esc, or Look Away for 5 seconds, to end. The map stays on the page. Losing your face counts as looking away.

Use `view=dot` for the same flow without the heat map, which is closer to what a real user would see.

Known limits:

- `view=dot` still shows the camera preview.
- Look Away only counts after the Start Gesture. If you leave at the start box, the camera stays on until you press Esc.

## Real gaze in the app

Run `npm run dev:gaze`. `npm run dev` stays on the dev-only mouse input, and a packaged app always uses the camera.

1. The overlay shows your camera preview for 5 seconds so you can get in frame.
2. Follow the dot through calibration, which takes about 22 seconds. Calibration covers the corners.
3. Do the Start Gesture: look at the centre box for 3 seconds. The ring fills, a chime plays, and the box goes away.
4. The Gaze Dot shows where the tracker thinks you're looking.
5. Look Away for 5 seconds to stop the agent. Losing your face counts. The centre box returns, so you can start again with your eyes alone.
6. Do the Recalibrate Gesture at any time after calibration: blink 4 times within 3 seconds. Recalibrating also stops the agent.

The Recalibrate Gesture stays inside the gaze source, so blinks never reach the session core and the `GazeEvent` format doesn't change. It's the only eyes-only way out of a bad calibration, because it doesn't depend on where the tracker thinks you're looking.

The Gaze Region radius is a fixed 120 px, around the 66 to 154 px median error of the MediaPipe runs for #5. The overlay's Content-Security-Policy blocks MediaPipe's usage logs, as the gaze check's does, so keep it if you change that page.

Known limits:

- If no face is in frame during calibration, the Gaze Dot never appears and the centre box can't be reached until the user recalibrates.
- The Gaze Dot is on the overlay, so it will appear in the agent's screenshots.
- The mouse input can't Look Away, because the cursor stays on screen. Restart `npm run dev` to get back to idle.

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
