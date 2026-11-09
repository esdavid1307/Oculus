# Neural Layer

The Neural Layer is where every confirmed choice teaches Oculus about this user. It runs on the device, learns in milliseconds, and changes nothing until it has evidence (#16).

It adds three learners to the two that already existed:

| Learner | Learns from | Changes | Model |
|---|---|---|---|
| **Gaze Correction** | A text box confirmed by Done, a Suggested Intent that ran well, and the Start Gesture | Shifts every Gaze Region, and the Gaze Dot, onto where the user looks | Regression net, 2 → 12 tanh → 2 |
| **Icon Order** | Each icon opened from an Icon Scan | The order the Icon Scan reaches icons | Neural ranker over 4 features |
| **Scan Pace** | Each Select Blink, and each press that Back or Delete takes back | The scan step of every scan | Reaction-time quantile, deliberately not a net |
| Suggested Words | Text confirmed with Done | Word suggestions | Neural ranker (`src/shared/predict.ts`) |
| Intent History | Intents that ran ok | Past Intents offered first | Count, or neural with `"intentRanker": "neural"` |

The networks are in `src/shared/neural/net.ts`. They're plain TypeScript, deterministic for a seed, and need no native code or GPU.

## Where the labels come from

The session reports a `learn` action whenever the user confirms something. Nothing the user takes back teaches the layer.

- **Select Blink:** how long the chosen key had been highlighted. Back right after a letter group, or Delete right after a letter, marks the press before as a step late.
- **Icon opened:** every icon of that scan, in screen order, and the one opened.
- **Gaze:**
  - **A text box** the user looked at teaches its centre, but only once Done confirms text typed into it. The Stop Gesture throws the label away. Weight 1.
  - **A Suggested Intent that ran ok** teaches where the agent first clicked. "Skip the ad" is left out, since its Skip button is wherever it is. So is a click more than 2.5 Gaze Region radii from where the user looked. Weight 1.
  - **The Start Gesture** teaches the middle of the Centre Box. The box is large, so this counts a quarter. Weight 0.25.

The session sees corrected gaze, so the main process keeps the last 30 s of uncorrected gaze and pairs each gaze label with where the tracker really put it.

## Safety

- **Gaze Correction switches itself on only when it helps.** After each new label it trains on the older ones and checks the newest quarter. It turns on only if that cuts their error by at least 10%. With no steady error to learn, it stays off.
- **Every shift is capped** at 200 px.
- **Look Away is never corrected.** The Stop Gesture uses the uncorrected gaze, so no learned shift can hide it or fake it.
- **Recalibrating resets Gaze Correction.** Icon Order and Scan Pace are about the user, not the calibration, so they stay.
- **Scan Pace changes the step only when the gain is real:** at least 10% faster. It never goes below 900 ms or above half again the user's own step. A new step only starts with the next scan, never under a lit key.
- **Icon Order keeps screen order** until the user has opened something. Screen order then breaks ties.
- **Switching off:** `"neuralLayer": false` in `~/Library/Application Support/oculus-agent/config.json` turns the three learners off. Every feature then works as before.
- **Privacy:** what's learned is saved to `neural-layer.json` in the same folder. That's icon names, reaction times and ranker weights. Gaze Correction is kept in memory only. No video, text or screenshots are stored, and nothing leaves the machine. Delete the file to start fresh.

## Results

`npm run eval:neural` runs simulated users with fixed seeds and writes `out/neural-eval.json`. The tests fail if a learner stops beating doing nothing.

**Gaze Correction.** The simulated tracker is shifted (−80, +55) px, scaled 0.9 × 1.08, and adds 25 px of noise per hold. Measured on 300 unseen targets, averaged over 5 users:

| Confirmed selections | Median error | Hits on a 240 px target |
|---|---|---|
| 0 | 104 px | 63% |
| 6 | 53 px | 92% |
| 10 | 35 px | 100% |
| 40 | 32 px | 100% |

With an accurate tracker it stays off, and the error stays at 26 px.

**Icon Order.** 20 Dock icons are used Zipf-style, a few a lot, in no relation to where they sit. Scan steps before the wanted icon, averaged over 8 users:

| After opens | Screen order | Learned | Ideal |
|---|---|---|---|
| 10 | 10.2 | 5.6 | 4.5 |
| 100 | 9.6 | 4.7 | 4.1 |
| 10 to 60 after the user's favourites change | 8.0 | 6.1 (plain counts: 6.6) | 4.5 |

That's about 5 scan steps fewer per icon, about 10 s at the default 2 s step. The ranker matches plain counting when habits are steady, and follows a change faster.

**Scan Pace.** One selection in a 10-key scan. A press slower than the step lands on the next key and costs a Back and a second go. Averaged over 3 users each:

| Median reaction | Step | Seconds per selection | Late presses |
|---|---|---|---|
| 450 ms | 2000 → 1184 ms | 8.59 → 5.12 (−40%) | 0% → 0.3% |
| 600 ms | 2000 → 1424 ms | 8.75 → 6.39 (−27%) | 0% → 0.7% |
| 900 ms | 2000 → 1840 ms | 9.18 → 8.81 (−4%) | 1.0% → 0.8% |

**Cost.** Correcting a Gaze Region takes about 1.4 µs. Retraining Gaze Correction after a label takes at most about 80 ms, since it keeps the newest 120 labels. Ranking and pacing take well under 1 ms.

**Live, in the app on the demo laptop** (dev mouse input with `OCULUS_MOUSE_SHIFT="-100,60"`, so every look reads 117 px off):

- **Gaze Correction:** after 6 Start Gestures it switched itself on, and the held-out error fell from 117 px to 14 px.
- **Scan Pace:** 16 quick Select Blinks took the step from 2000 to 1715 ms, eased in a little at a time.
- **Icon Order:** opening Finder from an Icon Scan of the Dock was saved to `neural-layer.json`.

## Watching it learn

`OCULUS_MOUSE_SHIFT="-100,60" npm run dev` makes the dev mouse input read off like a badly calibrated webcam. The terminal logs `[neural]` lines:

```
[neural] gaze correction on: <n> selections, held-out error <before> -> <after> px
[neural] scan step <old> -> <new> ms from <n> presses
```

Known limits:

- The results are simulations. With real users they need checking on the demo laptop, with the camera.
- Scan Pace treats every Back or Delete as a late press, including a real change of mind. That only makes it slower, never faster.
- Icon Order reorders an Icon Scan, so the highlight no longer moves left to right. The Icon Magnifier names what is lit.
