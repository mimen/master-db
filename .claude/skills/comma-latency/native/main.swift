import AppKit
import ApplicationServices

func describe(_ e: AXUIElement, depth: Int = 0, budget: inout Int) -> [[String: Any]] {
  guard depth < 18, budget > 0 else { return [] }
  budget -= 1
  let rect = axFrame(e)
  var rows: [[String: Any]] = [["role": axString(e, kAXRoleAttribute), "title": axString(e, kAXTitleAttribute), "description": axString(e, kAXDescriptionAttribute), "identifier": axString(e, kAXIdentifierAttribute), "depth": depth, "rect": [rect.minX, rect.minY, rect.width, rect.height]]]
  for child in axChildren(e) { rows += describe(child, depth: depth + 1, budget: &budget) }
  return rows
}

let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.apple.MobileSMS" || $0.executableURL?.lastPathComponent == "imsg-desktop" }
if CommandLine.arguments.contains("--self-test") {
  selfTest()
} else if CommandLine.arguments.contains("--calibrate") {
  let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  FileHandle.standardOutput.write(try encoder.encode(calibrate()))
} else if CommandLine.arguments.contains("--build-info") {
  guard let app = apps.first(where: { $0.executableURL?.lastPathComponent == "imsg-desktop" }) else { throw Abort.setup("Comma not running") }
  let original = NSWorkspace.shared.frontmostApplication
  let root = AXUIElementCreateApplication(app.processIdentifier)
  guard let window = (ax(root, kAXWindowsAttribute) as? [AXUIElement])?.first,
        let web = axFind(window, { axString($0, kAXRoleAttribute) == "AXWebArea" }) else { throw Abort.setup("Comma web area absent") }
  let driver = Driver(targetPid: { app.processIdentifier })
  try driver.startWatchdog()
  defer { driver.stopWatchdog(); if let original { try? activate(original) } }
  try activate(app)
  let buttons = axSearch(web, key: "AXButtonSearchKey", limit: 80)
  guard let settings = buttons.first(where: { axString($0, kAXTitleAttribute) == "Settings" }) else { throw Abort.setup("Settings AX button absent") }
  try driver.click(midpoint(axFrame(settings)))
  sleepMs(500)
  if let release = axSearch(web, key: "AXButtonSearchKey", limit: 100).first(where: { label($0).contains("Show release details") || label($0).contains("Show version details") }) {
    AXUIElementPerformAction(release, "AXScrollToVisible" as CFString)
    sleepMs(100)
    for _ in 0..<4 where !axFrame(window).contains(midpoint(axFrame(release))) {
      _ = try driver.scroll(at: midpoint(axFrame(window)), dy: -80, steps: 20, everyMs: 8)
      sleepMs(100)
    }
    try driver.click(midpoint(axFrame(release)))
    sleepMs(150)
  }
  var values: [String: String] = [:]
  let texts = axSearch(web, key: "AXStaticTextSearchKey", limit: 10000)
  values["hashes"] = texts.map { axValueText($0) }.filter { $0.range(of: "^[0-9a-f]{7,40}$", options: .regularExpression) != nil }.joined(separator: " | ")
  values["versionText"] = texts.map { axValueText($0) }.filter { $0.contains("Version ") || $0.contains("Running web") || $0.contains("Deployed web") }.joined(separator: " | ")
  values["releaseControls"] = axSearch(web, key: "AXButtonSearchKey", limit: 100).map { label($0) }.filter { $0.localizedCaseInsensitiveContains("release") || $0.localizedCaseInsensitiveContains("version") }.joined(separator: " | ")
  for name in ["Running web", "Deployed web"] {
    if let index = texts.firstIndex(where: { axValueText($0) == name }), index + 1 < texts.count {
      let candidate = axValueText(texts[index + 1])
      if candidate.range(of: "^[0-9a-f]{7,40}$", options: .regularExpression) != nil { values[name] = candidate }
    }
  }
  if let messages = buttons.first(where: { axString($0, kAXTitleAttribute) == "Messages" }) { try driver.click(midpoint(axFrame(messages))) }
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys]))
} else if CommandLine.arguments.contains("--run") {
  let args = CommandLine.arguments
  let output = args.firstIndex(of: "--output").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
  let budget = args.firstIndex(of: "--budget-ms").flatMap { $0 + 1 < args.count ? Double(args[$0 + 1]) : nil } ?? 82_000
  let repeats = args.firstIndex(of: "--repeats").flatMap { $0 + 1 < args.count ? Int(args[$0 + 1]) : nil } ?? 5
  guard budget >= 1000 && budget <= 82_000, (1...10).contains(repeats), let output, output.hasPrefix("/Users/mimen/Programming/Repos/convex-db/apps/imsg/artifacts/latency/") else { fatalError("--output must be under the main checkout latency artifacts; repeats 1...10") }
  let directory = URL(fileURLWithPath: output, isDirectory: true).standardizedFileURL
  guard directory.path.hasPrefix("/Users/mimen/Programming/Repos/convex-db/apps/imsg/artifacts/latency/") else { throw Abort.setup("output escaped latency artifacts") }
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  var runs: [AppRun] = []
  for app in apps where (!args.contains("--messages-only") || app.bundleIdentifier == "com.apple.MobileSMS") && (!(args.contains("--preview-only") || args.contains("--comma-only")) || app.executableURL?.lastPathComponent == "imsg-desktop") {
    do {
      let session = try Session(app: app, directory: directory, budgetMs: budget)
      let run = session.perform(repeats: repeats, previewOnly: args.contains("--preview-only"))
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
