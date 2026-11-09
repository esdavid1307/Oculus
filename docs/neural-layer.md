# Neural Layer

The Neural Layer is where every choice the user confirms goes to teach Oculus about them. It adds three learners: Gaze Correction, Icon Order and Scan Pace. Suggested Words (`docs/word-prediction.md`) and Intent History learn in their own modules.

The pure part is `src/shared/neural/`, with no dependencies. `src/main/neural.ts` connects it to the session, saves it, and logs what it learns under `[neural]`.

It's on by default. `"neuralLayer": false` in config.json turns it off and leaves every feature as it was.

## What teaches it

The session sends a `learn` action whenever the user confirms something:

| Signal | When | Teaches |
|---|---|---|
| `select` | A Select Blink during a scan, with how long the key had been lit. A press that takes the one before back, such as Back right after a letter group, marks that one as late. | Scan Pace |
| `icon-opened` | An icon opened from an Icon Scan, with every icon of that scan. | Icon Order |
| `gaze` | Where the user looked, and what they turned out to mean. | Gaze Correction |

The `gaze` signal comes from three places:

- **Done in a Text Box:** the box the user looked at is the one they typed into. Full weight.
- **A run that went well:** the agent's first click is what the user meant, if it's within 2.5 Gaze Region radii of where they looked. Skipping an ad clicks the Skip button wherever the user looked, so it teaches nothing.
- **Waking:** the user held their gaze on the Centre Box. The box is large, so this counts for a quarter.

Only confirmations teach it. A stopped run or text closed by the Stop Gesture never does.

## Gaze Correction

A small net (2 inputs, 12 tanh units, 2 outputs) learns the shift from where the tracker put the gaze to where the user meant. The correction is applied to every Gaze Region before the session sees it, so the hit-testing, the Stop Gesture and everything else use the corrected gaze.

- It waits for 6 confirmed selections, and keeps the newest 120.
- Before it's used, it's checked on the newest quarter of them, held out from training. It must cut that error by at least 10%, or the gaze is left alone. That keeps it from making good tracking worse.
- No shift is ever larger than 200 px.
- It's kept in memory only. Recalibrating starts it again, since the old error means nothing after a new calibration.

## Icon Order

Learns which icons this user opens, per source (Dock, Desktop, menu bar, menu), so the Icon Scan reaches them first. A tiny ranker scores each icon on four features: its share of recent opens, opens weighted by recency, how recently it was opened, and its screen order.

It starts from screen order, the order the Icon Scan always used, and opens count half as much after 3 days, so a change in habits shows within days. Saved in `neural-layer.json` in the app's user data folder.

## Scan Pace

Learns how fast this user presses once their key is lit, and sets the scan step to just cover it. Most of a scan is waiting on keys the user doesn't want, so every millisecond saved counts on every key passed.

This one isn't a net on purpose. A few dozen reaction times are best summarised by a high quantile, which a small net can't beat and could get wrong.

- It waits for 12 presses and keeps the newest 60.
- The target step is the 95th percentile reaction plus 350 ms, never under 900 ms and never over 1.5 times the base step.
- It only speeds up when that saves at least a tenth of the step. It can slow down for a user the step is too fast for.
- The step eases a quarter of the way to the target after each press, and only changes when a scan starts again, never under a lit key.

A `"scanStepMs"` set in config.json is the user's own choice, so Scan Pace leaves it alone. It only adapts the default step.

## Results

`src/shared/neural/eval.test.ts` measures each learner on simulated users, against doing nothing, with fixed seeds. Run it with `npx vitest run src/shared/neural/eval.test.ts`, and it writes the numbers to `out/neural-eval.json`.

**Gaze Correction**, for a tracker off by about 100 px:

| Confirmed selections | Median error | Hit rate |
|---|---|---|
| None | 104 px | 63% |
| 6 | 53 px | 92% |
| 20 | 33 px | 100% |

With no steady error to learn, it stays off and the error stays at 26 px.

**Icon Order**, scan steps to reach the icon wanted:

| After opens | Screen order | Learned | Best possible |
|---|---|---|---|
| 10 | 10.2 | 5.6 | 4.5 |
| 100 | 9.6 | 4.7 | 4.1 |

After a change in habits it takes 6.1 steps, against 6.6 for plain counts.

**Scan Pace**, from the 2000 ms default:

| Median reaction | Learned step | Seconds per selection | Missed presses |
|---|---|---|---|
| 450 ms | 1184 ms | 8.6 → 5.1 | 0% → 0.3% |
| 600 ms | 1424 ms | 8.8 → 6.4 | 0% → 0.7% |
| 900 ms | 1840 ms | 9.2 → 8.8 | 1.0% → 0.8% |
