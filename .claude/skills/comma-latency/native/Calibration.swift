import AppKit

final class CalibrationPatch: NSView {
  var white = false
  override func draw(_ dirtyRect: NSRect) {
    (white ? NSColor.white : NSColor.black).setFill()
    bounds.fill()
  }
  override func mouseDown(with event: NSEvent) { white.toggle(); needsDisplay = true }
}
struct CalibrationResult: Encodable {
  var renderSubmissionToFrameMs: [Double] = []
  var frameDeliveryMs: [Double] = []
  var processingMs: [Double] = []
  var error: String?
  let requestedHz = 240
  var machNumer = timebase.numer
  var machDenom = timebase.denom
  var displayMaximumHz = 0
}
func calibrate() -> CalibrationResult {
  var result = CalibrationResult()
  let original = NSWorkspace.shared.frontmostApplication
  let application = NSApplication.shared
  application.setActivationPolicy(.regular)
  let panel = NSWindow(contentRect: NSRect(x: 760, y: 460, width: 200, height: 200), styleMask: [.borderless], backing: .buffered, defer: false)
  let patch = CalibrationPatch(frame: NSRect(x: 0, y: 0, width: 200, height: 200))
  patch.setAccessibilityElement(true)
  patch.setAccessibilityRole(.button)
  patch.setAccessibilityLabel("Latency calibration patch")
  panel.contentView = patch
  panel.level = .floating
  panel.makeKeyAndOrderFront(nil)
  application.activate(ignoringOtherApps: true)
  sleepMs(200)
  let capture = Capture()
  let driver = Driver(targetPid: { ProcessInfo.processInfo.processIdentifier })
  defer {
    capture.stop(); driver.stopWatchdog(); panel.orderOut(nil)
    application.setActivationPolicy(.prohibited)
    if let original { try? activate(original) }
  }
  do { try driver.startWatchdog() } catch { result.error = String(describing: error); return result }
  do {
    result.displayMaximumHz = panel.screen?.maximumFramesPerSecond ?? 0
    try capture.start(windowID: CGWindowID(panel.windowNumber))
    capture.watch([CGRect(x: 20, y: 20, width: 160, height: 160)])
    for _ in 0..<5 {
      try driver.check()
      capture.reset()
      let input = now()
      patch.white.toggle()
      patch.needsDisplay = true
      panel.displayIfNeeded()
      while ms(input, now()) < 1000 && !capture.snapshot().contains(where: { $0.t >= input && $0.changed[0] >= 2 }) { try driver.check(); sleepMs(5) }
      guard let frame = capture.snapshot().first(where: { $0.t >= input && $0.changed[0] >= 2 }) else { throw Abort.setup("calibration patch did not respond") }
      result.renderSubmissionToFrameMs.append(ms(input, frame.t))
      result.frameDeliveryMs.append(ms(frame.t, frame.arrival))
      result.processingMs.append(frame.processingMs)
      sleepMs(50)
    }
  } catch { result.error = String(describing: error) }
  return result
}
