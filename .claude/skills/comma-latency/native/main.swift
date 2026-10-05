import AppKit
import ApplicationServices

func describe(_ e: AXUIElement, depth: Int = 0, budget: inout Int) -> [[String: Any]] {
  guard depth < 18, budget > 0 else { return [] }
  budget -= 1
  let rect = axFrame(e)
  var rows: [[String: Any]] = [["role": axString(e, kAXRoleAttribute), "title": axString(e, kAXTitleAttribute), "description": axString(e, kAXDescriptionAttribute), "value": String(axValueText(e).prefix(160)), "identifier": axString(e, kAXIdentifierAttribute), "depth": depth, "rect": [rect.minX, rect.minY, rect.width, rect.height]]]
  for child in axChildren(e) { rows += describe(child, depth: depth + 1, budget: &budget) }
  return rows
}

let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.apple.MobileSMS" || $0.executableURL?.lastPathComponent == "imsg-desktop" }
if CommandLine.arguments.contains("--self-test") {
  selfTest()
} else if CommandLine.arguments.contains("--run") {
  let args = CommandLine.arguments
  let output = args.firstIndex(of: "--output").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
  let repeats = args.firstIndex(of: "--repeats").flatMap { $0 + 1 < args.count ? Int(args[$0 + 1]) : nil } ?? 5
  guard (1...10).contains(repeats), let output, output.hasPrefix("/Users/mimen/Programming/Repos/convex-db/apps/imsg/artifacts/latency/") else { fatalError("--output must be under the main checkout latency artifacts; repeats 1...10") }
  let directory = URL(fileURLWithPath: output, isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  var runs: [AppRun] = []
  for app in apps where !args.contains("--messages-only") || app.bundleIdentifier == "com.apple.MobileSMS" {
    do {
      let session = try Session(app: app, directory: directory)
      let run = session.perform(repeats: repeats)
      runs.append(run)
      try writeJSON(run, directory.appendingPathComponent("\(run.app.lowercased())-native.json"))
      if !run.cleanupVerified || run.error?.contains("cursor moved") == true { break }
    } catch { print("setup error", error) }
  }
  try writeJSON(runs, directory.appendingPathComponent("native.json"))
  print(directory.path)
} else if CommandLine.arguments.contains("--doctor") {
  var results: [[String: Any]] = []
  for app in apps {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 1)
    var budget = 1800
    results.append(["name": app.localizedName ?? "", "pid": app.processIdentifier, "bundle": app.bundleIdentifier ?? "", "tree": describe(root, budget: &budget)])
  }
  let data = try JSONSerialization.data(withJSONObject: ["accessibility": AXIsProcessTrusted(), "screenCapture": CGPreflightScreenCaptureAccess(), "apps": results], options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(data)
} else if CommandLine.arguments.contains("--targets") {
  for app in apps {
    print("APP", app.localizedName ?? "", app.processIdentifier)
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.5)
    let window = (ax(root, kAXWindowsAttribute) as? [AXUIElement])?.first
    guard let window else { continue }
    if let web = axFind(window, { axString($0, kAXRoleAttribute) == "AXWebArea" }) {
      for key in ["AXButtonSearchKey", "AXTextFieldSearchKey", "AXControlSearchKey"] {
        for e in axSearch(web, key: key, limit: 90) {
          print(key, axString(e, kAXRoleAttribute), axString(e, kAXTitleAttribute), axString(e, kAXDescriptionAttribute), axFrame(e))
        }
      }
    }
  }
} else {
  print("comma-latency --doctor | --targets")
}
