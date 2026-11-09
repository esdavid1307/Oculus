# Gaze Scan in Google Chrome

Issue #22. While the agent is awake, looking at named things in Chrome for 3 seconds sticks to them, the way Icon Scan sticks to the Dock: a video title, a thumbnail link, the Skip Ad button, Back, Reload. The highlight then steps through the Chrome elements near the Gaze Region, and a Select Blink chooses one. The chosen element becomes the target of the Suggested Intents, and its name and bounds go to Claude as a hint next to the Gaze Region, so "Skip the ad" or "Open this video" is about exactly that element.

It's off by default. Turn it on with `"chromeScan": true` in `~/Library/Application Support/oculus-agent/config.json`. Off, everything works as before.

## The flow

1. Wake the agent with the Start Gesture.
2. Look at something in Chrome. Where named elements are near the Gaze Region, a 3 second hold sticks to them, instead of the 1 second target hold. Anywhere else (a blank part of the page, an image with no name) the 1 second target hold works as before.
3. The highlight steps through those elements, at most 6, one every 2 seconds (or at the Scan Pace), nearest the gaze first, so the scan starts on what you looked at. With Large View on, the highlighted element's name shows large, under "Blink to choose". Without it, the highlight is drawn 8 points outside the element, so a line of text stays readable inside it.
4. A Select Blink on one asks Claude for Suggested Intents about it. Something else keeps the same element, and so does the run of the Intent chosen.
5. Look Away ends the scan without choosing anything, as in every scan.

Text boxes (the address bar, a search box) are left to the Gaze Keyboard: a 1 second look at one still opens the keyboard on it (#13), even when Chrome elements are around it. The helper's lookup also finds Chrome's web text boxes, which the System Events read (`READ_TEXT_BOXES`) can't see, or only after more than 5 seconds once Chrome's tree is on, so with `chromeScan` on they are added to the text boxes the Gaze Keyboard opens on.

The menu bar's Icon Scan only starts while the gaze centre is on the menu bar or past the top edge, not anywhere within a radius of it. So a tab, the address bar and a search box just under the toolbar keep their 1 second hold.

Choosing an element confirms nothing yet, so only Scan Pace learns from that Select Blink. If the Intent then runs well, Gaze Correction learns from the 3 second hold, as it does for any run, and never for "Skip the ad". Chrome elements change with every page, so Icon Order learns nothing from them.

The Gaze Region sent to Claude for a chosen element is centred on the element, with the element's name and bounds next to it.

## How it works

| Part | What it does |
|---|---|
| `scripts/oculus-ax.swift` | The Accessibility helper. One process runs while the Oculus Agent does. Once per Chrome process it watches Chrome's notifications and walks at most 3000 elements, 12 levels deep, as a screen reader does on start, so Chrome builds its tree. A fresh helper finds the toolbar at once, but no page elements for its first 1 or 2 lookups (about the first second) while Chrome builds the tree. After that, for each gaze point it hit-tests Chrome's own application element (so the click-through overlay is never what it finds) at the centre and 16 points around it, then adds the named elements around each hit: up to 4 parents and 2 levels of children. It only answers while Chrome is the app in front. |
| `src/main/chrome-scan.ts` | Builds the helper with `xcrun swiftc` on first use into the user data folder, and again whenever the source is newer. Sends it the Gaze Region (after Gaze Correction) at most every 300 ms while a target can be picked, one lookup at a time. A lookup slower than 1 second is not waited for. The helper answers in order, so each answer is matched to the region it was asked about. |
| `src/shared/chrome-scan.ts` | Turns what the helper found into the elements the session scans. Drops elements with no name, tiny ones, ones larger than a quarter of the screen (like the whole page), text boxes (kept apart for the Gaze Keyboard), Chrome's own menus (the menu bar Icon Scan opens those), duplicates, a text run inside a button with the same name, and anything the Gaze Region doesn't touch. Keeps the 6 nearest, nearest first. Names are cut to 80 characters. |
| `src/shared/session.ts` | Scans the Chrome elements with the same hold and scan code as Icon Scan, as the source `'chrome'`. A Select Blink on a Chrome element sends `suggest-intents` with an `element` instead of opening anything. |
| `src/main/agent/intents.ts`, `run-intent.ts` | Add "They chose the element "…" centred at (x, y), w x h pixels." to the Suggested Intents prompt and the run goal, in screenshot pixels. The name is quoted, since it comes from a web page. |

### Why a Swift helper

Chrome only shows its web content, and most of its own window, to assistive apps such as VoiceOver. It refuses the two switches meant to turn that on from outside (`AXManualAccessibility` gives -25205, `AXEnhancedUserInterface` -25208). What does work is to watch its Accessibility notifications, as a screen reader does: Chrome then builds the tree for the page and the toolbar. That needs a process that keeps running, so the helper is Swift. (JXA can climb to a parent after all: the raw `AXParent` Ref fails with "Ref has incompatible type", but `ObjC.castRefToObject(ref)` works. Reading attributes from JXA never turns the page tree on, though.) VoiceOver also turns the tree on, and it stays on after VoiceOver is off, until that Chrome quits.

The helper needs the same Accessibility permission as the rest of the Oculus Agent, given to the app that runs `npm run dev`. Building it needs Xcode or its Command Line Tools (`xcode-select --install`). Without them, the log says `[chrome-scan] could not build …`, and Chrome works with the 1 second target hold as before.

## Results

| Date | Machine | Chrome | Finding |
|---|---|---|---|
| 2026-11-08 | Dev laptop, macOS 27.0.1 | 157, everyday profile | JXA lookups only: the tab strip comes back as one `AXGroup`, the toolbar as one `AXToolbar` and the page as one group. Both switches refused. Climbing to a parent fails in JXA. |
| 2026-11-09 | Dev laptop, macOS 27.0.1 | 157, fresh profile, no flags, `scripts/youtube-ad-mock.html` | With the Swift helper watching Chrome: the Skip Ad button, the ad heading, every video title, channel and view count, Back, Forward, Reload, the address bar and the profile button come back by name. **Tabs don't**: the tab strip stays one unnamed group. A lookup takes 50 ms at the median and 134 ms at most (30 lookups). |
| 2026-11-09 | Dev laptop, same | same | End to end in the app (mouse as gaze): wake, a 3 second look at Skip Ad, scan, Select, Claude suggested "Skip the ad" with the element in its prompt, the run clicked Skip in 6.4 s and the video played. Look Away ended a scan over the video titles. A blank part of the page still gave Suggested Intents after 1 second. |

On the mock page the video cards are plain `div`s, so the scan steps through their title, channel and view lines one by one.

On real YouTube search results (2026-11-09, logged out, a throwaway profile) it is weak: the main result's thumbnail returns nothing, and its title returns only the channel link and the view count and age, not the title. Only Shorts cards come back as one link with the video's name. The 1 second target hold, which `chromeScan` off uses everywhere, gave the right Suggested Intents on all of these, so `chromeScan` stays off for the demo.

### Not done yet: the demo laptop

#22 asks for this to be checked on the demo laptop (an M5 MacBook Pro running Chrome). Nothing above was run there. To check it:

1. Clone the repo and run `npm install` and `npm run dev` once, with Accessibility and Screen Recording given to the terminal.
2. Add `"chromeScan": true` to `config.json` and restart. The log shows `[chrome-scan] building the Accessibility helper` the first time.
3. Open YouTube in Chrome, wake the agent, and look at a thumbnail or title for 3 seconds. A highlight should step through the elements there.
4. Add a row to the table above with what happened. If nothing is found, set `"chromeScan": false` and the demo uses Icon Scan and the 1 second target hold, as #22 allows.

## Limits

- **Tabs aren't found.** Chrome 157 doesn't expose its tabs this way. Looking at the tab strip falls back to the 1 second target hold.
- **Two Chrome processes** (another `--user-data-dir`): Chrome's scripting can't tell them apart, so per-site Intent History uses the app alone while two run.
- **The helper is dev-only.** It is built from the repo with `swiftc`, like the hands script is read from the repo. A packaged app would need it built and shipped.
- **Chrome builds its Accessibility tree** for every page once the helper has watched it, as with VoiceOver on. No slowdown was seen on the mock page, but heavy pages (YouTube, Google Docs) weren't measured.
- **Primary display and the Chrome window in front only**, like the rest of the Intent flow.
- **#13 with `chromeScan` off:** Chrome shows no web text boxes until its tree is on, so the YouTube search box can't open the Gaze Keyboard. Once the tree is on (the helper, VoiceOver), `READ_TEXT_BOXES` takes 5.1 to 5.3 seconds, over its 4 second limit, which is why the helper's own text boxes are used.
