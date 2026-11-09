# Gaze Scan in Google Chrome

Issue #22. While the agent is awake, looking at named things in Chrome for 3 seconds sticks to them, the way Icon Scan sticks to the Dock: a video title, a thumbnail link, the Skip Ad button, Back, Reload. The highlight then steps through the Chrome elements near the Gaze Region, and a Select Blink chooses one. The chosen element becomes the target of the Suggested Intents, and its name and bounds go to Claude as a hint next to the Gaze Region, so "Skip the ad" or "Open this video" is about exactly that element.

It's off by default. Turn it on with `"chromeScan": true` in `~/Library/Application Support/oculus-agent/config.json`. Off, everything works as before.

## The flow

1. Wake the agent with the Start Gesture.
2. Look at something in Chrome. Where named elements are near the Gaze Region, a 3 second hold sticks to them, instead of the 1 second target hold. Anywhere else (a blank part of the page, an image with no name) the 1 second target hold works as before.
3. The highlight steps through those elements, at most 6, one every 2 seconds (or at the Scan Pace), column by column from the left. With Large View on, the highlighted element's name shows large.
4. A Select Blink on one asks Claude for Suggested Intents about it. Something else keeps the same element, and so does the run of the Intent chosen.
5. Look Away ends the scan without choosing anything, as in every scan.

Text boxes (the address bar, a search box) are left to the Gaze Keyboard: a 1 second look at one still opens the keyboard on it (#13), even when Chrome elements are around it.

The choice also teaches the Neural Layer: the user held their gaze on that element, so it is a full-weight example for Gaze Correction. Chrome elements change with every page, so Icon Order learns nothing from them.

## How it works

| Part | What it does |
|---|---|
| `scripts/oculus-ax.swift` | The Accessibility helper. One process runs while Oculus does. For each gaze point it hit-tests Chrome's own application element (so the click-through overlay is never what it finds) at the centre and 16 points around it, then adds the named elements around each hit: up to 4 parents and 2 levels of children. It only answers while Chrome is the app in front. |
| `src/main/chrome-scan.ts` | Builds the helper with `xcrun swiftc` on first use into the user data folder, and again whenever the source is newer. Sends it the Gaze Region (after Gaze Correction) at most every 300 ms while a target can be picked, one lookup at a time. |
| `src/shared/chrome-scan.ts` | Turns what the helper found into the elements the session scans. Drops elements with no name, tiny ones, ones larger than a quarter of the screen (like the whole page), text boxes, duplicates and anything the Gaze Region doesn't touch. Keeps the 6 nearest. Names are cut to 80 characters. |
| `src/shared/session.ts` | Chrome is one more Icon Scan source (`'chrome'`). A Select Blink on a Chrome element sends `suggest-intents` with an `element` instead of opening anything. |
| `src/main/agent/intents.ts`, `run-intent.ts` | Add "They chose the element "…" at (x, y), w x h pixels." to the Suggested Intents prompt and the run goal, in screenshot pixels. The name is quoted, since it comes from a web page. |

### Why a Swift helper

Chrome only shows its web content, and most of its own window, to assistive apps such as VoiceOver. It refuses the two switches meant to turn that on from outside (`AXManualAccessibility` gives -25205, `AXEnhancedUserInterface` -25208). What does work is to watch its Accessibility notifications, as a screen reader does: Chrome then builds the tree for the page and the toolbar. That needs a process that keeps running. JXA can't climb from an element to its parent either ("Ref has incompatible type"), so the helper is Swift.

The helper needs the same Accessibility permission as the rest of Oculus, given to the app that runs `npm run dev`. Building it needs Xcode or its Command Line Tools (`xcode-select --install`). Without them, the log says `[chrome-scan] could not build …`, and Chrome works with the 1 second target hold as before.

## Results

| Date | Machine | Chrome | Finding |
|---|---|---|---|
| 2026-11-08 | Dev laptop, macOS 27.0.1 | 157, everyday profile | JXA lookups only: the tab strip comes back as one `AXGroup`, the toolbar as one `AXToolbar` and the page as one group. Both switches refused. Climbing to a parent fails in JXA. |
| 2026-11-09 | Dev laptop, macOS 27.0.1 | 157, fresh profile, no flags, `scripts/youtube-ad-mock.html` | With the Swift helper watching Chrome: the Skip Ad button, the ad heading, every video title, channel and view count, Back, Forward, Reload, the address bar and the profile button come back by name. **Tabs don't**: the tab strip stays one unnamed group. A lookup takes 50 ms at the median and 134 ms at most (30 lookups). |
| 2026-11-09 | Dev laptop, same | same | End to end in the app (mouse as gaze): wake, a 3 second look at Skip Ad, scan, Select, Claude suggested "Skip the ad" with the element in its prompt, the run clicked Skip in 6.4 s and the video played. Look Away ended a scan over the video titles. A blank part of the page still gave Suggested Intents after 1 second. |

On the mock page the video cards are plain `div`s, so the scan steps through their title, channel and view lines one by one. On real YouTube a card is a link with the video's name, which the helper climbs to, so the whole card should be one element. That wasn't checked on real YouTube yet.

### Not done yet: the demo laptop

#22 asks for this to be checked on the demo laptop (an M5 MacBook Pro running Chrome). Nothing above was run there. To check it:

1. Clone the repo and run `npm install` and `npm run dev` once, with Accessibility and Screen Recording given to the terminal.
2. Add `"chromeScan": true` to `config.json` and restart. The log shows `[chrome-scan] building the Accessibility helper` the first time.
3. Open YouTube in Chrome, wake the agent, and look at a thumbnail or title for 3 seconds. A highlight should step through the elements there.
4. Add a row to the table above with what happened. If nothing is found, set `"chromeScan": false` and the demo uses Icon Scan and the 1 second target hold, as #22 allows.

## Limits

- **Tabs aren't found.** Chrome 157 doesn't expose its tabs this way. Looking at the tab strip falls back to the 1 second target hold.
- **The helper is dev-only.** It is built from the repo with `swiftc`, like the hands script is read from the repo. A packaged app would need it built and shipped.
- **Chrome builds its Accessibility tree** for every page once the helper has watched it, as with VoiceOver on. No slowdown was seen on the mock page, but heavy pages (YouTube, Google Docs) weren't measured.
- **Primary display and the Chrome window in front only**, like the rest of the Intent flow.
- **Likely side effect for #13:** once Chrome has built its tree, the text-box reader (`READ_TEXT_BOXES` in `src/main/index.ts`) should also find Chrome's web text boxes, such as YouTube's search box, so the Gaze Keyboard can open on them. Not checked yet.
