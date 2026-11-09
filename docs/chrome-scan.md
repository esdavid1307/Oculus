# Gaze Scan in Google Chrome

The spike for #22: can a 3 second look at a Chrome element (a tab, a toolbar button, a YouTube thumbnail) find that element with an Accessibility lookup at the Gaze Region centre, so it can be scanned like an Icon Scan?

**Result so far: falls back on a dev laptop. Not yet checked on the demo laptop**, which is where #22 asks for the decision to be made. Until it is, the demo plans on Icon Scan and the overlay only. In Chrome a target is still picked with the 1 second target hold, and the Gaze Region goes to Claude as the hint, as before. No code was added.

The findings below are about how Chrome and macOS behave, not about one machine, so the demo laptop will most likely give the same result. To confirm it, run the same lookup there (see "What was tried") with the demo's Chrome and pages, and add a row to the table.

## What was tried

One `osascript -l JavaScript` call per lookup, against Chrome's own application element, so the click-through overlay can never be the thing found:

```js
ObjC.import('ApplicationServices');
const app = $.AXUIElementCreateApplication(chromePid);
const hit = Ref();
$.AXUIElementCopyElementAtPosition(app, x, y, hit); // then AXRole, AXTitle, AXDescription, AXFrame of hit[0]
```

## What happened

| Date | Chrome | Finding |
|---|---|---|
| 2026-11-08 | 157, everyday profile | The hit-test works and is fast: about 1 ms per point, 0.2 s per osascript call. Only Chrome's frame shows single elements, the menu bar items and the Gemini button. The tab strip comes back as one `AXGroup`, the toolbar as one `AXToolbar` and the whole page as one `AXGroup` or `AXWebArea`. |
| 2026-11-08 | 157, everyday profile | Chrome refuses to turn on its web accessibility from outside: setting `AXManualAccessibility` returns -25205 (unsupported) and `AXEnhancedUserInterface` -25208. Without a screen reader running, page content stays hidden. |
| 2026-11-08 | 157, launched with `--force-renderer-accessibility`, on `scripts/youtube-ad-mock.html` | Page content shows up, but a hit-test returns the deepest text run (`AXStaticText`) or a large layout group, never the card or link around it. |
| 2026-11-08 | same | Climbing from the hit element to its clickable parent fails in JXA: an element read back through `AXParent` can't be passed to the AX functions again ("Ref has incompatible type"). |

All rows: a dev laptop, not the demo laptop. macOS 27.0.1, 3024 x 1964 Retina display.

## What it would take

- Chrome launched with `--force-renderer-accessibility` on the demo laptop, or a screen reader running. Chrome then builds its accessibility tree for every page. The cost of that on YouTube and Google Docs was not measured.
- A small compiled helper (Swift) for the hit-test, since JXA can't walk up to the parent element.
- A decision on how a 3 second Chrome hold lives alongside the 1 second target hold, which today starts both demo flows. Chrome elements fill the middle of the screen, so one of the two holds would have to give way.

If this is picked up again, hit-test at the Gaze Region after Gaze Correction (`docs/neural-layer.md`), the one the session sees. A chosen element's bounds would also be a good `gaze` signal for Gaze Correction, like a Text Box is today.

One side note for #13: the text-box reader (`READ_TEXT_BOXES` in `src/main/index.ts`) has the same limit. It only finds Chrome's web text boxes once Chrome's accessibility tree is on.
