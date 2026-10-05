import AppKit
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct FrameEvidence: Codable {
  let displayTicks: UInt64
  let arrivalTicks: UInt64
  let changedPixels: Int
  let processingMs: Double
}
struct Trial: Codable {
  let app: String
  let interaction: String
  let repetition: Int
  var status: String
  var reason: String?
  var inputTicks: UInt64?
  var lastInputTicks: UInt64?
  var firstMs: Double?
  var settledMs: Double?
  var confirmedMs: Double?
  var region: [Double] = []
  var width = 0
  var height = 0
  var frames: [FrameEvidence] = []
  var evidence: String?
}
struct AppRun: Codable {
  let app: String
  var elapsedMs: Double = 0
  var trials: [Trial] = []
  var hitTestPid: Int32?
  var pid: Int32
  var restoredFrontmost = false
  var cleanupVerified = true
  var error: String?
}
struct Measurement {
  let first: Double?
  let settled: Double?
  let confirmed: Double?
}
func analyze(_ frames: [FrameEvidence], input: UInt64, lastInput: UInt64, observedUntil: UInt64) -> Measurement {
  let changes = frames.filter { $0.displayTicks >= input && $0.changedPixels >= 2 }
  guard let first = changes.first else { return Measurement(first: nil, settled: nil, confirmed: nil) }
  let last = max(changes.last!.displayTicks, lastInput)
  let quiet = ms(last, observedUntil)
  return Measurement(first: ms(input, first.displayTicks), settled: quiet >= 300 ? ms(input, last) : nil, confirmed: quiet >= 300 ? ms(input, last) + 300 : nil)
}
func writeJSON<T: Encodable>(_ value: T, _ path: URL) throws {
  let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  try encoder.encode(value).write(to: path, options: .atomic)
}
func writePNG(_ thumb: Thumb, _ path: URL) throws {
  let data = Data(thumb.bgra)
  guard let provider = CGDataProvider(data: data as CFData),
        let image = CGImage(width: thumb.w, height: thumb.h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: thumb.w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: [.byteOrder32Little, CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue)], provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
        let dest = CGImageDestinationCreateWithURL(path as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw Abort.setup("cannot create PNG") }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { throw Abort.setup("cannot write PNG") }
}
func windowID(pid: pid_t) throws -> CGWindowID {
  guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
        let window = windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }),
        let id = window[kCGWindowNumber as String] as? UInt32 else { throw Abort.setup("no visible target window") }
  return id
}
func label(_ e: AXUIElement) -> String { [axString(e, kAXTitleAttribute), axString(e, kAXDescriptionAttribute)].filter { !$0.isEmpty }.joined(separator: " ") }
func descendants(_ root: AXUIElement, limit: Int = 1500) -> [AXUIElement] {
  var pending = [root], result: [AXUIElement] = []
  while let next = pending.popLast(), result.count < limit { result.append(next); pending.append(contentsOf: axChildren(next).reversed()) }
  return result
}
func midpoint(_ rect: CGRect) -> CGPoint { CGPoint(x: rect.midX, y: rect.midY) }
func activate(_ app: NSRunningApplication) throws {
  guard let identifier = app.bundleIdentifier, identifier.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }) else { throw Abort.setup("invalid activation identity") }
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  process.arguments = ["-e", "tell application id \"\(identifier)\" to activate", "-e", "tell application \"System Events\" to set frontmost of (first process whose unix id is \(app.processIdentifier)) to true"]
  process.standardOutput = FileHandle.nullDevice
  process.standardError = FileHandle.nullDevice
  try process.run()
  let start = now()
  while process.isRunning && ms(start, now()) < 2500 { sleepMs(20) }
  if process.isRunning { process.terminate(); throw Abort.setup("activation timed out") }
  guard process.terminationStatus == 0 else { throw Abort.setup("activation failed") }
  AXUIElementSetAttributeValue(AXUIElementCreateApplication(app.processIdentifier), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
  sleepMs(400)
}


final class Session {
  let app: NSRunningApplication
  let root: AXUIElement
  let window: AXUIElement
  let frame: CGRect
  let web: AXUIElement?
  let capture = Capture()
  let driver: Driver
  let directory: URL
  let budgetMs: Double
  let start = now()
  var run: AppRun
  var ownedField: AXUIElement?
  var ownedText: String?

  init(app: NSRunningApplication, directory: URL, budgetMs: Double = 82_000) throws {
    self.app = app; self.directory = directory; self.budgetMs = budgetMs
    root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.3)
    guard let window = (ax(root, kAXWindowsAttribute) as? [AXUIElement])?.first else { throw Abort.setup("no AX window") }
    self.window = window; frame = axFrame(window)
    web = axFind(window, { axString($0, kAXRoleAttribute) == "AXWebArea" })
    driver = Driver(targetPid: { app.processIdentifier })
    run = AppRun(app: app.localizedName ?? "Unknown", pid: app.processIdentifier)
  }
  func check() throws {
    try driver.check()
    guard ms(start, now()) < budgetMs else { throw Abort.setup("work budget exhausted; reserved cleanup time") }
    guard axFrame(window) == frame else { throw Abort.unsafe("window moved or resized") }
    _ = try capture.health()
  }
  func controls() -> [AXUIElement] {
    if let web { return axSearch(web, key: "AXControlSearchKey", limit: 100) }
    return descendants(window).filter { ["AXTextField", "AXButton", "AXRadioButton"].contains(axString($0, kAXRoleAttribute)) }
  }
  func relative(_ r: CGRect) -> CGRect { r.offsetBy(dx: -frame.minX, dy: -frame.minY).intersection(CGRect(origin: .zero, size: frame.size)) }
  func skip(_ name: String, _ reason: String) { run.trials.append(Trial(app: run.app, interaction: name, repetition: 0, status: "unavailable", reason: reason)) }
  func measure(_ name: String, repetition: Int, region: CGRect, action: () throws -> UInt64) throws {
    try check()
    let roi = relative(region)
    guard roi.width > 2, roi.height > 2 else { throw Abort.setup("empty measurement region") }
    capture.watch([roi])
    sleepMs(100)
    capture.reset()
    let input = try action(), lastInput = now()
    var measurement = Measurement(first: nil, settled: nil, confirmed: nil)
    repeat {
      sleepMs(12); try check()
      let observed = capture.snapshot().map { FrameEvidence(displayTicks: $0.t, arrivalTicks: $0.arrival, changedPixels: $0.changed[0], processingMs: $0.processingMs) }
      measurement = analyze(observed, input: input, lastInput: lastInput, observedUntil: now())
    } while measurement.settled == nil && ms(input, now()) < 2200
    let frames = capture.snapshot().filter { $0.t >= input }
    var trial = Trial(app: run.app, interaction: name, repetition: repetition, status: measurement.first == nil ? "no-response" : (measurement.settled == nil ? "timeout" : "measured"))
    trial.inputTicks = input; trial.lastInputTicks = lastInput
    trial.firstMs = measurement.first; trial.settledMs = measurement.settled; trial.confirmedMs = measurement.confirmed
    trial.region = [roi.minX, roi.minY, roi.width, roi.height].map(Double.init)
    trial.width = capture.size.w; trial.height = capture.size.h
    trial.frames = frames.map { FrameEvidence(displayTicks: $0.t, arrivalTicks: $0.arrival, changedPixels: $0.changed[0], processingMs: $0.processingMs) }
    let name = "\(run.app.lowercased())-\(name)-\(repetition)"
    let target = directory.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
    let raw = target.appendingPathComponent("frames.bgra")
    FileManager.default.createFile(atPath: raw.path, contents: nil)
    let file = try FileHandle(forWritingTo: raw)
    for f in frames { if let pixels = f.thumb { try file.write(contentsOf: Data(pixels)) } }
    try file.close()
    if let picture = capture.pictures().baseline { try writePNG(picture, target.appendingPathComponent("before.png")) }
    if let first = frames.first(where: { $0.changed[0] >= 2 })?.thumb { try writePNG(Thumb(w: trial.width, h: trial.height, bgra: first), target.appendingPathComponent("first.png")) }
    if let pixels = frames.last?.thumb { try writePNG(Thumb(w: trial.width, h: trial.height, bgra: pixels), target.appendingPathComponent("after.png")) }
    trial.evidence = name
    try writeJSON(trial, target.appendingPathComponent("trial.json"))
    run.trials.append(trial)
  }
  func focus(_ field: AXUIElement) throws {
    guard axValueText(field).isEmpty else { throw Abort.unsafe("field already contains text") }
    try driver.click(midpoint(axFrame(field))); sleepMs(100)
    guard let focused = ax(root, kAXFocusedUIElementAttribute), CFEqual(focused, field) else { throw Abort.unsafe("field did not receive focus") }
  }
  func clearOwned() throws {
    guard let field = ownedField, let text = ownedText else { return }
    let value = axValueText(field)
    guard value.isEmpty || value == text else { throw Abort.unsafe("field changed outside harness; preserving it") }
    if !value.isEmpty {
      try driver.key(.a, cmd: true, into: field, app: root)
      try driver.key(.delete, into: field, app: root)
      sleepMs(100)
    }
    guard axValueText(field).isEmpty else { throw Abort.unsafe("temporary text not cleared") }
    ownedField = nil; ownedText = nil
  }
  func perform(repeats: Int, previewOnly: Bool = false) -> AppRun {
    do {
    let front = NSWorkspace.shared.frontmostApplication
    do { try driver.startWatchdog() } catch { run.error = String(describing: error); return run }
    defer {
      do { try clearOwned() } catch { run.cleanupVerified = false; run.error = "\(run.error ?? ""); cleanup incomplete: \(error)" }
      capture.stop(); driver.stopWatchdog()
      if let front { try? activate(front) }
      sleepMs(60)
      run.restoredFrontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier == front?.processIdentifier
      run.elapsedMs = ms(start, now())
    }
    do {
      guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else { throw Abort.setup("Accessibility and Screen Recording are required") }
      try activate(app)
      AXUIElementPerformAction(window, kAXRaiseAction as CFString)
      for _ in 0..<20 {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier { break }
        sleepMs(50)
      }
      sleepMs(150)
      try driver.check()
      let point = midpoint(frame)
      var hit: AXUIElement?, pid: pid_t = 0
      if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success, let hit { AXUIElementGetPid(hit, &pid) }
      run.hitTestPid = pid
      guard pid == app.processIdentifier else { throw Abort.unsafe("system-wide hit-test is occluded by pid \(pid)") }
      try capture.start(windowID: windowID(pid: app.processIdentifier))
      let isComma = web != nil
      let search = controls().first { axString($0, kAXRoleAttribute) == "AXTextField" && label($0).localizedCaseInsensitiveContains("Search") }
      let list: CGRect
      if let search { let s = axFrame(search); list = CGRect(x: s.minX, y: s.maxY + (isComma ? 60 : 10), width: isComma ? 410 : 300, height: min(500, frame.maxY - s.maxY - 90)) }
      else { throw Abort.setup("AX search anchor not found") }
      if previewOnly {
        guard isComma, let all = controls().first(where: { axString($0, kAXRoleAttribute) == "AXRadioButton" && label($0).hasPrefix("All,") }),
              let divider = controls().first(where: { axString($0, kAXRoleAttribute) == "AXSlider" && label($0).contains("Resize sidebar") }) else { throw Abort.setup("preview navigation anchors absent") }
        try driver.click(midpoint(axFrame(all)))
        sleepMs(200)
        let left = axFrame(divider).maxX + 8
        let thread = CGRect(x: left, y: frame.minY + 120, width: frame.maxX - left - 15, height: frame.height - 210)
        for i in 1...repeats {
          try measure("preview-switch", repetition: i, region: thread) { try driver.key(i % 2 == 1 ? .j : .k, app: root) }
        }
        for i in 1...repeats {
          try driver.key(.j, app: root); sleepMs(80)
          try measure("rapid-preview", repetition: i, region: thread) { try driver.key(.k, app: root) }
        }
        for i in 1...repeats { try measure("thread-scroll", repetition: i, region: thread) { try driver.scroll(at: midpoint(thread), dy: i % 2 == 1 ? -24 : 24, steps: 16, everyMs: 8) } }
        for i in 1...repeats {
          try measure("details", repetition: i, region: thread) { try driver.key(.i, cmd: true) }
          try driver.key(.i, cmd: true); sleepMs(150)
        }
      } else {
      skip("switch", "Strict no-mark policy: selecting a conversation can automatically mark read. No read-state-changing operation was issued.")
      skip("rapid-switch", "Conversation switching is blocked by the no-mark policy; an overlapping load cannot be verified.")
      for i in 1...repeats {
        try measure("list-scroll", repetition: i, region: list) { try driver.scroll(at: midpoint(list), dy: i % 2 == 1 ? -24 : 24, steps: 16, everyMs: 8) }
      }
      if let search {
        for i in 1...repeats {
          try focus(search)
          ownedField = search; ownedText = "a"
          do {
            try measure("search", repetition: i, region: list) { try driver.key(.a, into: search, app: root) }
            try clearOwned()
            sleepMs(150)
          } catch { try clearOwned(); throw error }
        }
      }
      let fields = controls()
      let composer = fields.first { axString($0, kAXIdentifierAttribute) == "messageBodyField" || label($0).lowercased().contains("message composer") }
      if let composer {
        let r = axFrame(composer)
        let thread = CGRect(x: r.minX, y: frame.minY + 130, width: min(r.width, 750), height: max(10, r.minY - frame.minY - 145))
        for i in 1...repeats { try measure("thread-scroll", repetition: i, region: thread) { try driver.scroll(at: midpoint(thread), dy: i % 2 == 1 ? 24 : -24, steps: 16, everyMs: 8) } }
      } else { skip("thread-scroll", "No active thread/composer exposed by AX; opening a different thread would auto-mark it.") }
      skip("compose", "Self-chat identity was not verified as the already-open conversation; no draft was typed.")
      if isComma {
        let tabs = fields.filter { axString($0, kAXRoleAttribute) == "AXRadioButton" && (label($0).hasPrefix("All,") || label($0).hasPrefix("Waiting,")) }
        if tabs.count == 2 {
          for i in 1...repeats { try measure("lens-tabs", repetition: i, region: list) { try driver.click(midpoint(axFrame(tabs[(i - 1) % 2]))) } }
        } else { skip("lens-tabs", "Expected All/Waiting AX radio controls were not found") }
        for i in 1...repeats {
          let region = CGRect(x: frame.minX + frame.width * 0.25, y: frame.minY + 80, width: frame.width * 0.5, height: min(420, frame.height - 100))
          try measure("command-palette", repetition: i, region: region) { try driver.key(.k, cmd: true) }
          try driver.key(.escape); sleepMs(100)
        }
        skip("details", "No active conversation details control exposed; normal selection would auto-mark the thread.")
      }
      }
    } catch { run.error = String(describing: error) }
    }
    return run
  }
}

func selfTest() {
  func tick(_ v: Double) -> UInt64 { UInt64(v * 1e6 * Double(timebase.denom) / Double(timebase.numer)) }
  let frames = [10.0, 400.0].map { FrameEvidence(displayTicks: tick($0), arrivalTicks: tick($0 + 2), changedPixels: 20, processingMs: 1) }
  let early = analyze(frames, input: 0, lastInput: tick(450), observedUntil: tick(600))
  precondition(early.settled == nil, "an earlier quiet gap must not settle a continuing gesture")
  let late = analyze(frames, input: 0, lastInput: tick(450), observedUntil: tick(800))
  precondition(abs(late.settled! - 450) < 0.01)
  precondition(analyze([], input: 0, lastInput: 0, observedUntil: tick(1000)).first == nil)
  precondition(Key(rawValue: 36) == nil && Key(rawValue: 76) == nil)
  print("native self-tests passed")
}
