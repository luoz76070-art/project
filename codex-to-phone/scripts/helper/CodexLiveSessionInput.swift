import AppKit
import ApplicationServices
import Foundation

let requestFile = "/tmp/codex-live-session-input-request.json"
let resultFile = "/tmp/codex-live-session-input-result.json"
let defaultInputFile = "/tmp/codex-live-session-input.txt"
let codexBundleIdentifier = "com.openai.codex"
let codexAppURL = URL(fileURLWithPath: "/Applications/Codex.app")
var requestId = "unknown"
var inputFile = defaultInputFile

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

if let data = FileManager.default.contents(atPath: requestFile),
   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
  if let id = object["id"] as? String {
    requestId = id
  }
  if let requestedInputFile = object["inputFile"] as? String, !requestedInputFile.isEmpty {
    inputFile = requestedInputFile
  }
}

let accessibilityOptions = [
  kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
] as CFDictionary

guard AXIsProcessTrustedWithOptions(accessibilityOptions) else {
  fail("Accessibility permission is not granted for Codex Live Session Input.app", code: 3)
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
}

usleep(450_000)
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
