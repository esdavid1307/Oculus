# Gaze check

A standalone WebGazer test for #5. It measures webcam gaze on the demo laptop. It doesn't touch the Electron app.

1. Run `npm run gaze-check` and open the printed `localhost` address in Chrome.
2. Allow the camera. Sit as you will for the demo and centre your face in the box.
3. Press Start and follow the dot with your eyes. Calibration covers the corners, then 15 test points follow. It takes about 2 minutes.
4. Press Copy results and paste them into a comment on #5.

Repeat a few times, ideally with more than one person and in the demo room's lighting, because one run says little.

The scores are for gaze smoothed over 300 ms, as a real gaze source must send it. Corner targets use a Gaze Region radius of 0, so they are a worst case.

The suggested verdict is "stay on WebGazer" when every 2-second hold on both corners succeeds, the 29 keys a keyboard needs fit on screen, and gaze arrives at 10 or more samples per second. Otherwise it's "try MediaPipe". If `lost` is high, fix the lighting or face position and run again before trusting the verdict.
