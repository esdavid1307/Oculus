# Gaze event format

Status: approved on 2026-11-06 by Edwin Shaiju David on behalf of all five roles (#4).

Every gaze source (the dev-only mouse input and real tracking) sends the session core the same event. The types live in `src/shared/gaze.ts`.

```ts
type GazeRegion = { x: number; y: number; radius: number };
type GazeEvent = { type: 'gaze'; t: number; region: GazeRegion | null };
```

| Field | Meaning |
| --- | --- |
| `t` | `Date.now()` when the gaze was sampled, in milliseconds. |
| `region.x`, `region.y` | Centre of the Gaze Region, in CSS pixels from the top-left of the overlay. The overlay covers the primary display. |
| `region.radius` | How far the gaze may be from that centre, in CSS pixels. |
| `region` is `null` | Tracking is lost, for example no face is found. |

Rules for a gaze source:

- Send events continuously, at least 10 per second, even when the gaze isn't moving. The ring only moves when an event arrives.
- Send `region: null` when tracking is lost. Don't repeat the last region. Without it, a gap between two samples on a target counts as part of the hold, and the session can't see a Look Away.
- Smooth the gaze before sending it. One sample off a target restarts the hold.

A Gaze Region is on the centre box when its centre is inside the box, and off screen when its centre is off screen or it's `null`. Keep `radius` honest, because it goes to the model as a hint.

The session core detects the Start Gesture and Look Away, so they can be tested with scripted gaze events. A gaze source only reports where the user is looking. The Recalibrate Gesture is handled inside real tracking, outside this format, and tracking sends `region: null` while calibrating and until the Start Gesture.

The session core also takes timer ticks, `{ type: 'tick', t }`, so Look Away still fires if gaze events stop.
