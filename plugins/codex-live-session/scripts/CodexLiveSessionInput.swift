import AppKit
import ApplicationServices
import Foundation

private let inputPath = "/tmp/codex-live-session-input.txt"
private let logPath = "/tmp/codex-live-session-helper.log"
private let permissionProbePrefix = "__CODEX_LIVE_SESSION_PERMISSION_PROBE__"

private enum HelperError: Error, CustomStringConvertible {
    case inputMissing(String)
    case accessibilityDenied
    case codexNotRunning
    case activationFailed
    case eventCreationFailed(String)

    var description: String {
        switch self {
        case .inputMissing(let path):
            return "input file is missing: \(path)"
        case .accessibilityDenied:
            return "accessibility permission is not granted"
        case .codexNotRunning:
            return "Codex app is not running"
        case .activationFailed:
            return "failed to activate Codex app"
        case .eventCreationFailed(let key):
            return "failed to create keyboard event: \(key)"
        }
    }
}

private struct PasteboardSnapshot {
    let items: [[(NSPasteboard.PasteboardType, Data)]]
}

private func writeLog(_ message: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    guard let data = line.data(using: .utf8) else { return }

    if FileManager.default.fileExists(atPath: logPath),
       let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logPath)) {
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        _ = try? handle.write(contentsOf: data)
        return
    }

    FileManager.default.createFile(atPath: logPath, contents: data, attributes: nil)
}

private func ensureAccessibility(prompt: Bool) throws {
    let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [promptKey: prompt] as CFDictionary
    if !AXIsProcessTrustedWithOptions(options) {
        throw HelperError.accessibilityDenied
    }
}

private func capturePasteboard() -> PasteboardSnapshot {
    let items = NSPasteboard.general.pasteboardItems ?? []
    let copiedItems = items.map { item in
        item.types.compactMap { type -> (NSPasteboard.PasteboardType, Data)? in
            guard let data = item.data(forType: type) else { return nil }
            return (type, data)
        }
    }
    return PasteboardSnapshot(items: copiedItems)
}

private func restorePasteboard(_ snapshot: PasteboardSnapshot) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()

    let items = snapshot.items.map { values -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in values {
            item.setData(data, forType: type)
        }
        return item
    }

    if !items.isEmpty {
        pasteboard.writeObjects(items)
    }
}

private func setClipboardText(_ text: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
}

private func activeCodexApp() -> NSRunningApplication? {
    let bundleIds = ["com.openai.codex"]
    for bundleId in bundleIds {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .filter { !$0.isTerminated }
        if let regularApp = apps.first(where: { $0.activationPolicy == .regular }) {
            return regularApp
        }
        if let app = apps.first {
            return app
        }
    }

    return NSWorkspace.shared.runningApplications.first {
        !$0.isTerminated &&
            $0.activationPolicy == .regular &&
            ($0.localizedName == "Codex" || $0.bundleURL?.lastPathComponent == "Codex.app")
    }
}

private func activateCodex() throws {
    guard let app = activeCodexApp() else {
        throw HelperError.codexNotRunning
    }
    let didActivate = app.activate(options: [.activateAllWindows])
    if !didActivate {
        throw HelperError.activationFailed
    }
    usleep(450_000)
}

private func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) throws {
    let source = CGEventSource(stateID: .hidSystemState)
    guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
        throw HelperError.eventCreationFailed(String(keyCode))
    }

    keyDown.flags = flags
    keyUp.flags = flags
    keyDown.post(tap: .cghidEventTap)
    usleep(40_000)
    keyUp.post(tap: .cghidEventTap)
    usleep(80_000)
}

private func runPermissionProbe() throws {
    writeLog("probe-start-native")
    try ensureAccessibility(prompt: true)
    try postKey(56)
    writeLog("probe-ok")
}

private func injectIntoCodex(_ text: String) throws {
    writeLog("inject-start length=\(text.count)")
    try ensureAccessibility(prompt: true)

    let snapshot = capturePasteboard()
    setClipboardText(text)
    defer {
        usleep(300_000)
        restorePasteboard(snapshot)
    }

    try activateCodex()
    try postKey(9, flags: .maskCommand)
    try postKey(36)
    writeLog("inject-ok")
}

do {
    writeLog("start-native")
    guard FileManager.default.fileExists(atPath: inputPath) else {
        throw HelperError.inputMissing(inputPath)
    }

    let text = try String(contentsOfFile: inputPath, encoding: .utf8)
    if text.hasPrefix(permissionProbePrefix) {
        try runPermissionProbe()
    } else {
        try injectIntoCodex(text)
    }
    exit(0)
} catch {
    writeLog("error \(error)")
    fputs("Codex Live Session Input: \(error)\n", stderr)
    exit(1)
}
