// Gaze Scan in Chrome (#22): finds the named Chrome elements around a point with the Accessibility API.
// The Oculus Agent compiles this on first use (swiftc) and keeps one process running while "chromeScan" is on.
//
// stdin, one line per lookup: "<x> <y> <radius>" in screen points.
// stdout, one JSON line per lookup: {"front": <Chrome is the app in front>, "elements": [{role, subrole, name, x, y, width, height}]}
//
// Chrome only shows its web content and most of its window to assistive apps. Watching its Accessibility notifications,
// as a screen reader does, is what makes it build them: setting AXEnhancedUserInterface or AXManualAccessibility is
// refused (see docs/chrome-scan.md). JXA can't do this or climb to an element's parent, hence Swift.
import AppKit
import ApplicationServices

let chromeBundle = "com.google.Chrome"
// How far up from what the lookup hit, and how deep below it, an element is still about the same spot.
let climb = 4
let descend = 2
let maxChildren = 40
// Big layout roles never make a useful target on their own.
let skipped: Set<String> = ["AXApplication", "AXWindow", "AXWebArea", "AXScrollArea", "AXSplitGroup", "AXToolbar", "AXMenuBar", "AXLayoutArea"]

var watched: (pid: pid_t, observer: AXObserver)?

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func text(_ element: AXUIElement, _ name: String) -> String {
  ((attribute(element, name) as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}

func frame(_ element: AXUIElement) -> CGRect? {
  guard let value = attribute(element, "AXFrame"), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
  var rect = CGRect.zero
  return AXValueGetValue(value as! AXValue, .cgRect, &rect) ? rect : nil
}

func children(_ element: AXUIElement) -> [AXUIElement] {
  (attribute(element, "AXChildren") as? [AXUIElement]) ?? []
}

// Watches Chrome like a screen reader, once per Chrome process, so it exposes its web content.
func watch(_ pid: pid_t, _ app: AXUIElement) {
  if watched?.pid == pid { return }
  var observer: AXObserver?
  guard AXObserverCreate(pid, { _, _, _, _ in }, &observer) == .success, let observer else { return }
  for name in [kAXFocusedUIElementChangedNotification, kAXValueChangedNotification, kAXLayoutChangedNotification, "AXLoadComplete"] {
    AXObserverAddNotification(observer, app, name as CFString, nil)
  }
  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
  watched = (pid, observer)
  // One shallow walk, as a screen reader does on start, so the first lookups already find something.
  var budget = 3000
  func walk(_ element: AXUIElement, _ depth: Int) {
    budget -= 1
    if budget <= 0 || depth > 12 { return }
    children(element).forEach { walk($0, depth + 1) }
  }
  walk(app, 0)
}

func lookup(x: Double, y: Double, radius: Double) -> [String: Any] {
  guard let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier == chromeBundle else {
    return ["front": false, "elements": []]
  }
  let app = AXUIElementCreateApplication(front.processIdentifier)
  AXUIElementSetMessagingTimeout(app, 0.25)
  watch(front.processIdentifier, app)

  var found: [[String: Any]] = []
  func add(_ element: AXUIElement) {
    let role = text(element, "AXRole")
    if role.isEmpty || skipped.contains(role) { return }
    let name = [text(element, "AXTitle"), text(element, "AXDescription"), text(element, "AXValue"), text(element, "AXHelp")].first { !$0.isEmpty } ?? ""
    guard !name.isEmpty, let rect = frame(element) else { return }
    found.append(["role": role, "subrole": text(element, "AXSubrole"), "name": name, "x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height])
  }
  func below(_ element: AXUIElement, _ depth: Int, _ budget: inout Int) {
    if depth > descend { return }
    for child in children(element) {
      budget -= 1
      if budget < 0 { return }
      add(child)
      below(child, depth + 1, &budget)
    }
  }

  // The centre, then 8 points half a radius out and 8 a whole radius out, so elements beside the gaze count too.
  var points = [(x, y)]
  for ring in [0.5, 1.0] {
    for step in 0..<8 {
      let angle = Double(step) * .pi / 4
      points.append((x + cos(angle) * radius * ring, y + sin(angle) * radius * ring))
    }
  }
  for (px, py) in points {
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(app, Float(px), Float(py), &hit) == .success, let start = hit else { continue }
    var element = start
    add(element)
    var budget = maxChildren
    below(element, 1, &budget)
    for _ in 0..<climb {
      guard let parent = attribute(element, "AXParent"), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
      element = parent as! AXUIElement
      add(element)
    }
  }
  return ["front": true, "elements": found]
}

// A request can arrive split across two reads, so the part after the last newline waits for the rest.
var pending = ""
FileHandle.standardInput.readabilityHandler = { handle in
  let data = handle.availableData
  // The Oculus Agent quit or closed the pipe. Queued behind any lookup still waiting, so its answer goes out first.
  if data.isEmpty {
    handle.readabilityHandler = nil
    DispatchQueue.main.async { exit(0) }
    return
  }
  pending += String(decoding: data, as: UTF8.self)
  let lines = pending.split(separator: "\n", omittingEmptySubsequences: false)
  pending = String(lines.last ?? "")
  for line in lines.dropLast() where !line.isEmpty {
    let numbers = line.split(separator: " ").compactMap { Double($0) }
    DispatchQueue.main.async {
      let reply = numbers.count == 3 ? lookup(x: numbers[0], y: numbers[1], radius: numbers[2]) : ["front": false, "elements": [], "error": "Expected: x y radius"]
      let json = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data("{\"front\":false,\"elements\":[]}".utf8)
      FileHandle.standardOutput.write(json + Data("\n".utf8))
    }
  }
}
RunLoop.main.run()
