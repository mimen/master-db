import AppKit
import CoreMedia
import ScreenCaptureKit

struct Frame {
  let t: UInt64
  let changed: [Int]
  let arrival: UInt64
  let processingMs: Double
  let thumb: [UInt8]?
}

struct Thumb {
  let w: Int, h: Int
  let bgra: [UInt8]
}

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
  private let lock = NSLock()
  private let queue = DispatchQueue(label: "capture", qos: .userInteractive)
  private var stream: SCStream?
  private var last: CVPixelBuffer?
  private var rects: [CGRect] = []
  private var bounds = CGRect.zero
  private var step = 4
  private var membership: [[Int]] = []
  private var prev: [UInt8]?
  private var baseline: [UInt8]?
  private var latest: [UInt8]?
  private var frames: [Frame] = []
  private var failure: String?
  private var callbacks = 0
  private var idleFrames = 0

  func health() throws -> (callbacks: Int, idle: Int) {
    lock.lock(); defer { lock.unlock() }
    if let failure { throw Abort.setup(failure) }
    return (callbacks, idleFrames)
  }
  private(set) var pxPerPt: CGFloat = 2
  private(set) var size = (w: 0, h: 0)

  func start(windowID: CGWindowID) throws {
    let content = try blocking { try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) }
    guard let win = content.windows.first(where: { $0.windowID == windowID }) else { throw Abort.setup("window \(windowID) is not shareable") }
    let cfg = SCStreamConfiguration()
    pxPerPt = 1
    cfg.width = Int(win.frame.width * pxPerPt)
    cfg.height = Int(win.frame.height * pxPerPt)
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: 240)
    cfg.queueDepth = 6
    cfg.pixelFormat = kCVPixelFormatType_32BGRA
    cfg.showsCursor = false
    cfg.ignoreShadowsSingleWindow = true
    let s = SCStream(filter: SCContentFilter(desktopIndependentWindow: win), configuration: cfg, delegate: self)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    try blocking { try await s.startCapture() }
    stream = s
    for _ in 0..<200 where hasNoBuffer() { sleepMs(10) }
    guard !hasNoBuffer() else { stop(); throw Abort.setup("ScreenCaptureKit supplied no initial frame") }
  }

  private func hasNoBuffer() -> Bool { lock.lock(); defer { lock.unlock() }; return last == nil }

  func stop() {
    if let s = stream { try? blocking { try await s.stopCapture() } }
    stream = nil
    lock.lock(); last = nil; prev = nil; lock.unlock()
  }

  func watch(_ rects: [CGRect]) {
    lock.lock(); defer { lock.unlock() }
    self.rects = rects.map { $0.integral }
    bounds = self.rects.dropFirst().reduce(self.rects[0]) { $0.union($1) }
    step = 1
    let tw = (Int(bounds.width * pxPerPt) + step - 1) / step, th = (Int(bounds.height * pxPerPt) + step - 1) / step
    size = (tw, th)
    membership = []
    for j in 0..<th {
      for i in 0..<tw {
        let p = CGPoint(x: bounds.minX + CGFloat(i * step) / pxPerPt, y: bounds.minY + CGFloat(j * step) / pxPerPt)
        membership.append(self.rects.indices.filter { self.rects[$0].contains(p) })
      }
    }
    frames = []
    prev = last.flatMap { sample($0) }
    baseline = prev
    latest = prev
  }

  func reset() { lock.lock(); frames = []; baseline = prev; latest = prev; lock.unlock() }

  func snapshot() -> [Frame] { lock.lock(); defer { lock.unlock() }; return frames }

  func pictures() -> (baseline: Thumb?, latest: Thumb?) {
    lock.lock(); defer { lock.unlock() }
    return (baseline.map { Thumb(w: size.w, h: size.h, bgra: $0) }, latest.map { Thumb(w: size.w, h: size.h, bgra: $0) })
  }

  private func sample(_ px: CVPixelBuffer) -> [UInt8]? {
    CVPixelBufferLockBaseAddress(px, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
    let bw = CVPixelBufferGetWidth(px), bh = CVPixelBufferGetHeight(px), row = CVPixelBufferGetBytesPerRow(px)
    guard let base = CVPixelBufferGetBaseAddress(px)?.assumingMemoryBound(to: UInt8.self) else { return nil }
    let x0 = Int(bounds.minX * pxPerPt), y0 = Int(bounds.minY * pxPerPt)
    var out = [UInt8](repeating: 255, count: size.w * size.h * 4)
    out.withUnsafeMutableBufferPointer { dst in
      for j in 0..<size.h {
        let y = y0 + j * step
        guard y >= 0, y < bh else { continue }
        let line = base + y * row
        for i in 0..<size.w {
          let x = x0 + i * step
          guard x >= 0, x < bw else { continue }
          let p = line + x * 4, k = (j * size.w + i) * 4
          dst[k] = p[0]; dst[k + 1] = p[1]; dst[k + 2] = p[2]
        }
      }
    }
    return out
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    let arrival = now()
    guard type == .screen,
          let info = (CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
          let raw = info[.status] as? Int, let status = SCFrameStatus(rawValue: raw) else { return }
    lock.lock(); defer { lock.unlock() }
    callbacks += 1
    if status == .idle { idleFrames += 1; return }
    if status == .stopped || status == .suspended || status == .blank {
      failure = "capture unhealthy: \(status.rawValue)"
      return
    }
    guard status == .complete || status == .started,
          let t = info[.displayTime] as? UInt64,
          let px = CMSampleBufferGetImageBuffer(sb) else { return }
    last = px
    guard !rects.isEmpty, let cur = sample(px) else { return }
    defer { prev = cur }
    guard let old = prev, old.count == cur.count else { return }
    var changed = [Int](repeating: 0, count: rects.count)
    for (n, owners) in membership.enumerated() where !owners.isEmpty {
      let k = n * 4
      let d = abs(Int(cur[k]) - Int(old[k])) + abs(Int(cur[k + 1]) - Int(old[k + 1])) + abs(Int(cur[k + 2]) - Int(old[k + 2]))
      if d > 12 { for o in owners { changed[o] += 1 } }
    }
    latest = cur
    frames.append(Frame(t: t, changed: changed, arrival: arrival, processingMs: ms(arrival, now()), thumb: cur))
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    lock.lock(); failure = "capture stopped: \(error)"; lock.unlock()
  }

}

func blocking<T>(_ body: @escaping () async throws -> T) throws -> T {
  let done = DispatchSemaphore(value: 0)
  var result: Result<T, Error>!
  Task.detached {
    do { result = .success(try await body()) } catch { result = .failure(error) }
    done.signal()
  }
  done.wait()
  return try result.get()
}
