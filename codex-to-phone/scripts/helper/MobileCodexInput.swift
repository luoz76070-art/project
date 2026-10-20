import AppKit
import ApplicationServices
import Foundation

let args = CommandLine.arguments
// Only per-request files are accepted; legacy shared /tmp requests are unsafe.
guard args.count == 3, args[1] == "--request" else { exit(2) }
let requestURL = URL(fileURLWithPath: args[2]).standardizedFileURL.resolvingSymlinksInPath()
let transactionDir = requestURL.deletingLastPathComponent()
guard transactionDir.lastPathComponent.hasPrefix("mobile-codex-input-"),
      let data = try? Data(contentsOf: requestURL),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let requestId = object["id"] as? String,
      let inputFile = object["inputFile"] as? String,
      let resultFile = object["resultFile"] as? String,
      let expiresAt = object["expiresAt"] as? Double,
      URL(fileURLWithPath: inputFile).standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent() == transactionDir,
      URL(fileURLWithPath: resultFile).standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent() == transactionDir else { exit(2) }
let codexBundleIdentifier = "com.openai.codex"
let codexAppURL = URL(fileURLWithPath: "/Applications/Codex.app")

func writeResult(ok: Bool, message: String, code: Int32) {
  let payload: [String: Any] = [
    "id": requestId,
    "ok": ok,
    "message": message,
    "code": Int(code)
  ]
  guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
    return
  }
  try? data.write(to: URL(fileURLWithPath: resultFile), options: .atomic)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  writeResult(ok: false, message: message, code: code)
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(code)
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) {
  guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
    fail("Could not create keyboard event")
  }
  down.flags = flags
  up.flags = flags
  down.post(tap: .cghidEventTap)
  usleep(40_000)
  up.post(tap: .cghidEventTap)
}

func clickCodexInputArea(_ app: NSRunningApplication) {
  let axApp = AXUIElementCreateApplication(app.processIdentifier)
  var windowsValue: CFTypeRef?
  guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsValue) == .success,
        let windows = windowsValue as? [AXUIElement],
        let window = windows.first else {
    return
  }

  var positionValue: CFTypeRef?
  var sizeValue: CFTypeRef?
  guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionValue) == .success,
        AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue) == .success,
        let positionAx = positionValue,
        let sizeAx = sizeValue else {
    return
  }

  var position = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(positionAx as! AXValue, .cgPoint, &position),
        AXValueGetValue(sizeAx as! AXValue, .cgSize, &size),
        size.width > 200,
        size.height > 200 else {
    return
  }

  let yOffset = CGFloat(Int(ProcessInfo.processInfo.environment["MOBILE_CODEX_MAC_INPUT_CLICK_Y_FROM_BOTTOM"] ?? "92") ?? 92)
  let point = CGPoint(x: position.x + size.width / 2, y: position.y + size.height - yOffset)
  guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
        let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
    return
  }
  down.post(tap: .cghidEventTap)
  usleep(60_000)
  up.post(tap: .cghidEventTap)
}

let accessibilityOptions = [
  kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
] as CFDictionary

guard AXIsProcessTrustedWithOptions(accessibilityOptions) else {
  fail("Accessibility permission is not granted for Mobile Codex Input.app", code: 3)
}

let text: String
do {
  text = try String(contentsOfFile: inputFile, encoding: .utf8)
} catch {
  fail("Could not read input file: \(error)")
}

guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
  fail("Input text is empty")
}

let pasteboard = NSPasteboard.general
let previousClipboard = pasteboard.string(forType: .string)
pasteboard.clearContents()
guard pasteboard.setString(text, forType: .string) else {
  fail("Could not write text to pasteboard")
}

if let codex = NSRunningApplication.runningApplications(withBundleIdentifier: codexBundleIdentifier).first {
  codex.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
  usleep(350_000)
  clickCodexInputArea(codex)
} else {
  let configuration = NSWorkspace.OpenConfiguration()
  configuration.activates = true
  let semaphore = DispatchSemaphore(value: 0)
  var openError: Error?
  NSWorkspace.shared.openApplication(at: codexAppURL, configuration: configuration) { _, error in
    openError = error
    semaphore.signal()
  }
  _ = semaphore.wait(timeout: .now() + 5)
  if let openError {
    fail("Could not open Codex.app: \(openError)")
  }
  if let codex = NSRunningApplication.runningApplications(withBundleIdentifier: codexBundleIdentifier).first {
    usleep(350_000)
    clickCodexInputArea(codex)
  }
}

usleep(450_000)
guard Date().timeIntervalSince1970 * 1000 < expiresAt else { fail("Input request expired before submission") }
postKey(9, flags: .maskCommand) // V
usleep(80_000)
postKey(36) // Return
usleep(120_000)

if let previousClipboard {
  pasteboard.clearContents()
  _ = pasteboard.setString(previousClipboard, forType: .string)
}

writeResult(ok: true, message: "ok", code: 0)
print("ok")
