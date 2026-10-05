import AppKit
import ApplicationServices

enum Abort: Error, CustomStringConvertible {
  case user
  case setup(String)
  case unsafe(String)
  var description: String {
    switch self {
    case .user: return "aborted: the cursor moved without the harness (user took the mouse)"
    case .setup(let s): return "setup failed: \(s)"
    case .unsafe(let s): return "refused unsafe input: \(s)"
    }
  }
}

let timebase: mach_timebase_info_data_t = { var i = mach_timebase_info_data_t(); mach_timebase_info(&i); return i }()
func now() -> UInt64 { mach_absolute_time() }
func ms(_ from: UInt64, _ to: UInt64) -> Double {
  (Double(to) - Double(from)) * Double(timebase.numer) / Double(timebase.denom) / 1e6
}
func sleepMs(_ v: Double) { RunLoop.current.run(until: Date().addingTimeInterval(max(0, v) / 1000)) }

enum Key: CGKeyCode {
  case a = 0, b = 11, c = 8, n = 45, i = 34, k = 40, delete = 51, escape = 53
  static func letter(_ ch: Character) -> Key? {
    switch ch { case "a": return .a; case "b": return .b; case "c": return .c; case "n": return .n; default: return nil }
  }
}


func ax(_ e: AXUIElement, _ k: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, k as CFString, &v) == .success ? v : nil
}
func axString(_ e: AXUIElement, _ k: String) -> String { (ax(e, k) as? String) ?? "" }
func axChildren(_ e: AXUIElement) -> [AXUIElement] { (ax(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func axFrame(_ e: AXUIElement) -> CGRect {
  var p = CGPoint.zero, s = CGSize.zero
  if let v = ax(e, kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
  if let v = ax(e, kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &s) }
  return CGRect(origin: p, size: s)
}
func axFind(_ e: AXUIElement, depth: Int = 0, _ match: (AXUIElement) -> Bool) -> AXUIElement? {
  if match(e) { return e }
  guard depth < 30 else { return nil }
  for k in axChildren(e) { if let f = axFind(k, depth: depth + 1, match) { return f } }
  return nil
}
func axSearch(_ root: AXUIElement, key: String, text: String? = nil, limit: Int = 50) -> [AXUIElement] {
  var pred: [String: Any] = ["AXSearchKey": key, "AXResultsLimit": limit, "AXDirection": "AXDirectionNext", "AXVisibleOnly": false]
  if let text { pred["AXSearchText"] = text }
  var out: AnyObject?
  AXUIElementCopyParameterizedAttributeValue(root, "AXUIElementsForSearchPredicate" as CFString, pred as CFDictionary, &out)
  return (out as? [AXUIElement]) ?? []
}
func axValueText(_ e: AXUIElement) -> String { axString(e, kAXValueAttribute) }


final class Driver {
  private let src = CGEventSource(stateID: .hidSystemState)
  private let lock = NSLock()
  private var expected: [CGPoint]
  private var aborted = false
  private var timer: DispatchSourceTimer?
  let targetPid: () -> pid_t

  init(targetPid: @escaping () -> pid_t) {
    self.targetPid = targetPid
    expected = [CGEvent(source: nil)?.location ?? .zero]
  }

  var cursorAtStart: CGPoint { expected.first ?? .zero }

  func startWatchdog() {
    let t = DispatchSource.makeTimerSource(queue: .global(qos: .userInteractive))
    t.schedule(deadline: .now(), repeating: .milliseconds(10))
    t.setEventHandler { [weak self] in
      guard let self, let loc = CGEvent(source: nil)?.location else { return }
      self.lock.lock(); defer { self.lock.unlock() }
      if !self.expected.contains(where: { hypot($0.x - loc.x, $0.y - loc.y) < 3 }) { self.aborted = true }
    }
    t.resume()
    timer = t
  }

  func stopWatchdog() { timer?.cancel(); timer = nil }

  func check() throws {
    lock.lock(); defer { lock.unlock() }
    if aborted { throw Abort.user }
  }

  private func expect(_ p: CGPoint) {
    lock.lock(); expected = [expected.last ?? p, p]; lock.unlock()
  }

  private func frontIsTarget() throws {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPid() else {
      throw Abort.unsafe("frontmost app is \(NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"), not the target")
    }
  }

  @discardableResult
  func click(_ p: CGPoint) throws -> UInt64 {
    try check()
    try frontIsTarget()
    var hit: AXUIElement?
    var pid: pid_t = 0
    if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(p.x), Float(p.y), &hit) == .success, let hit {
      AXUIElementGetPid(hit, &pid)
    }
    guard pid == targetPid() else { throw Abort.unsafe("point \(p) belongs to pid \(pid), not the target") }
    expect(p)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    sleepMs(30)
    let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)!
    let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)!
    let t = now()
    down.post(tap: .cghidEventTap)
    sleepMs(8)
    up.post(tap: .cghidEventTap)
    return t
  }

  @discardableResult
  func key(_ k: Key, cmd: Bool = false, into focused: AXUIElement? = nil, app: AXUIElement? = nil) throws -> UInt64 {
    try check()
    try frontIsTarget()
    if !cmd && k != .escape && (focused == nil || app == nil) { throw Abort.unsafe("text and deletion require verified field focus") }
    if k == .delete && cmd { throw Abort.unsafe("command-delete is forbidden") }
    if let focused, let app {
      guard let f = ax(app, kAXFocusedUIElementAttribute), CFEqual(f, focused) else {
        throw Abort.unsafe("keyboard focus left the expected field")
      }
    }
    let down = CGEvent(keyboardEventSource: src, virtualKey: k.rawValue, keyDown: true)!
    let up = CGEvent(keyboardEventSource: src, virtualKey: k.rawValue, keyDown: false)!
    down.flags = cmd ? .maskCommand : []
    up.flags = down.flags
    let t = now()
    down.post(tap: .cghidEventTap)
    sleepMs(6)
    up.post(tap: .cghidEventTap)
    return t
  }

  func scroll(at p: CGPoint, dy: Int32, steps: Int, everyMs: Double) throws -> UInt64 {
    try check()
    try frontIsTarget()
    expect(p)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    sleepMs(30)
    var first: UInt64 = 0
    for i in 0..<steps {
      try check()
      try frontIsTarget()
      let e = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)!
      e.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
      e.setIntegerValueField(.scrollWheelEventScrollPhase, value: i == 0 ? 1 : (i == steps - 1 ? 4 : 2))
      let t = now()
      if i == 0 { first = t }
      e.post(tap: .cghidEventTap)
      sleepMs(everyMs)
    }
    return first
  }

  func restoreCursor() {
    let p = cursorAtStart
    expect(p)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  }
}
