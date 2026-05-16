import AppKit
import Foundation

struct RelayConfig: Codable {
  var port: Int
  var token: String
  var brokerUrl: String?
  var relayId: String?
  var relaySecret: String?
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow!
  private var statusLabel: NSTextField!
  private var endpointLabel: NSTextField!
  private var remoteEndpointLabel: NSTextField!
  private var tokenLabel: NSTextField!
  private var logLabel: NSTextField!
  private var startButton: NSButton!
  private var stopButton: NSButton!
  private var relayProcess: Process?
  private var tunnelProcess: Process?
  private var config: RelayConfig!
  private let appSupportDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Mobile Codex Relay", isDirectory: true)

  private var projectRoot: String {
    Bundle.main.object(forInfoDictionaryKey: "MobileCodexProjectRoot") as? String ?? FileManager.default.currentDirectoryPath
  }

  private var nodePath: String {
    let configured = Bundle.main.object(forInfoDictionaryKey: "MobileCodexNodePath") as? String
    if let configured, FileManager.default.isExecutableFile(atPath: configured) {
      return configured
    }
    return "/usr/bin/env"
  }

  private var relayEndpoint: String {
    "http://\(localAddress()):\(config.port)"
  }

  private var remoteEndpoint: String? {
    guard let brokerUrl = normalizedBrokerUrl(), let relayId = config.relayId, !relayId.isEmpty else {
      return nil
    }
    return brokerUrl + "/r/" + relayId
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    config = loadConfig()
    buildWindow()
    updateLabels()
    startRelay()
  }

  func applicationWillTerminate(_ notification: Notification) {
    stopRelay()
  }

  private func buildWindow() {
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 620, height: 380),
      styleMask: [.titled, .closable, .miniaturizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Mobile Codex Relay"
    window.center()

    let content = NSView()
    content.translatesAutoresizingMaskIntoConstraints = false
    window.contentView = content

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.spacing = 14
    stack.alignment = .leading
    stack.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(stack)

    let title = NSTextField(labelWithString: "Mobile Codex Relay")
    title.font = .boldSystemFont(ofSize: 22)
    stack.addArrangedSubview(title)

    statusLabel = NSTextField(labelWithString: "")
    stack.addArrangedSubview(statusLabel)

    endpointLabel = selectableLabel("")
    remoteEndpointLabel = selectableLabel("")
    tokenLabel = selectableLabel("")
    logLabel = selectableLabel("")
    logLabel.font = .systemFont(ofSize: 12)
    logLabel.textColor = .secondaryLabelColor

    stack.addArrangedSubview(row(label: "LAN Endpoint", value: endpointLabel, copyAction: #selector(copyEndpoint)))
    stack.addArrangedSubview(row(label: "Remote Endpoint", value: remoteEndpointLabel, copyAction: #selector(copyRemoteEndpoint)))
    stack.addArrangedSubview(row(label: "Token", value: tokenLabel, copyAction: #selector(copyToken)))

    let buttonRow = NSStackView()
    buttonRow.orientation = .horizontal
    buttonRow.spacing = 10
    startButton = NSButton(title: "Start Relay", target: self, action: #selector(startClicked))
    stopButton = NSButton(title: "Stop Relay", target: self, action: #selector(stopClicked))
    let accessButton = NSButton(title: "Open Accessibility Settings", target: self, action: #selector(openAccessibilitySettings))
    buttonRow.addArrangedSubview(startButton)
    buttonRow.addArrangedSubview(stopButton)
    buttonRow.addArrangedSubview(accessButton)
    stack.addArrangedSubview(buttonRow)

    stack.addArrangedSubview(logLabel)

    let hint = NSTextField(labelWithString: "Install the Android APK, then enter the Endpoint and Token above in the app settings.")
    hint.lineBreakMode = .byWordWrapping
    hint.maximumNumberOfLines = 2
    hint.textColor = .secondaryLabelColor
    stack.addArrangedSubview(hint)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 22),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -22),
      stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
      endpointLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
      remoteEndpointLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
      tokenLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
      logLabel.widthAnchor.constraint(equalTo: stack.widthAnchor)
    ])

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func row(label: String, value: NSTextField, copyAction: Selector) -> NSView {
    let stack = NSStackView()
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 8
    let title = NSTextField(labelWithString: label + ":")
    title.frame.size.width = 115
    title.widthAnchor.constraint(equalToConstant: 115).isActive = true
    let copy = NSButton(title: "Copy", target: self, action: copyAction)
    stack.addArrangedSubview(title)
    stack.addArrangedSubview(value)
    stack.addArrangedSubview(copy)
    return stack
  }

  private func selectableLabel(_ value: String) -> NSTextField {
    let field = NSTextField(labelWithString: value)
    field.isSelectable = true
    field.lineBreakMode = .byTruncatingMiddle
    return field
  }

  private func updateLabels() {
    endpointLabel.stringValue = relayEndpoint
    remoteEndpointLabel.stringValue = remoteEndpoint ?? "Not configured"
    tokenLabel.stringValue = config.token
    let running = relayProcess?.isRunning == true
    statusLabel.stringValue = running ? "Status: running" : "Status: stopped"
    startButton?.isEnabled = !running
    stopButton?.isEnabled = running
  }

  @objc private func startClicked() {
    startRelay()
  }

  @objc private func stopClicked() {
    stopRelay()
    updateLabels()
  }

  @objc private func copyEndpoint() {
    copy(relayEndpoint)
  }

  @objc private func copyRemoteEndpoint() {
    copy(remoteEndpoint ?? "")
  }

  @objc private func copyToken() {
    copy(config.token)
  }

  @objc private func openAccessibilitySettings() {
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
      NSWorkspace.shared.open(url)
    }
  }

  private func startRelay() {
    if relayProcess?.isRunning == true {
      updateLabels()
      return
    }

    let serverFile = URL(fileURLWithPath: projectRoot).appendingPathComponent("apps/relay/dist/server.js").path
    guard FileManager.default.fileExists(atPath: serverFile) else {
      logLabel.stringValue = "Relay build is missing. Run corepack pnpm build, then rebuild this app."
      updateLabels()
      return
    }

    let process = Process()
    if nodePath == "/usr/bin/env" {
      process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
      process.arguments = ["node", "apps/relay/dist/server.js"]
    } else {
      process.executableURL = URL(fileURLWithPath: nodePath)
      process.arguments = ["apps/relay/dist/server.js"]
    }
    process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)

    var environment = ProcessInfo.processInfo.environment
    let pathPrefix = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    environment["PATH"] = pathPrefix + ":" + (environment["PATH"] ?? "")
    environment["MOBILE_CODEX_HOST"] = "0.0.0.0"
    environment["MOBILE_CODEX_PORT"] = String(config.port)
    environment["MOBILE_CODEX_TOKEN"] = config.token
    environment["CODEX_HOME"] = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path
    environment["MOBILE_CODEX_DEFAULT_CWD"] = projectRoot
    let appBundleCodex = "/Applications/Codex.app/Contents/Resources/codex"
    if FileManager.default.isExecutableFile(atPath: appBundleCodex) {
      environment["MOBILE_CODEX_CODEX_EXE"] = appBundleCodex
    }
    process.environment = environment

    let logURL = appSupportDir.appendingPathComponent("relay.log")
    try? FileManager.default.createDirectory(at: appSupportDir, withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: logURL.path) {
      FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    let logHandle = try? FileHandle(forWritingTo: logURL)
    logHandle?.seekToEndOfFile()
    process.standardOutput = logHandle
    process.standardError = logHandle

    process.terminationHandler = { [weak self] terminated in
      DispatchQueue.main.async {
        self?.relayProcess = nil
        self?.logLabel.stringValue = "Relay stopped with status \(terminated.terminationStatus). Log: \(logURL.path)"
        self?.updateLabels()
      }
    }

    do {
      try process.run()
      relayProcess = process
      startTunnelIfConfigured(logURL: logURL)
      logLabel.stringValue = [networkHint(), "Log: \(logURL.path)"].compactMap { $0 }.joined(separator: "\n")
    } catch {
      logLabel.stringValue = "Could not start relay: \(error.localizedDescription)"
    }
    updateLabels()
  }

  private func stopRelay() {
    if let tunnel = tunnelProcess, tunnel.isRunning {
      tunnel.terminate()
    }
    tunnelProcess = nil
    if let process = relayProcess, process.isRunning {
      process.terminate()
    }
    relayProcess = nil
  }

  private func startTunnelIfConfigured(logURL: URL) {
    guard let brokerUrl = normalizedBrokerUrl(),
          let relayId = config.relayId,
          let relaySecret = config.relaySecret,
          !relayId.isEmpty,
          !relaySecret.isEmpty else {
      return
    }

    let tunnelFile = URL(fileURLWithPath: projectRoot).appendingPathComponent("apps/relay/dist/remoteTunnelClient.js").path
    guard FileManager.default.fileExists(atPath: tunnelFile) else {
      return
    }

    let process = Process()
    if nodePath == "/usr/bin/env" {
      process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
      process.arguments = ["node", "apps/relay/dist/remoteTunnelClient.js"]
    } else {
      process.executableURL = URL(fileURLWithPath: nodePath)
      process.arguments = ["apps/relay/dist/remoteTunnelClient.js"]
    }
    process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)

    var environment = ProcessInfo.processInfo.environment
    let pathPrefix = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    environment["PATH"] = pathPrefix + ":" + (environment["PATH"] ?? "")
    environment["MOBILE_CODEX_BROKER_URL"] = brokerUrl
    environment["MOBILE_CODEX_RELAY_ID"] = relayId
    environment["MOBILE_CODEX_RELAY_SECRET"] = relaySecret
    environment["MOBILE_CODEX_LOCAL_RELAY"] = "http://127.0.0.1:\(config.port)"
    process.environment = environment

    let logHandle = try? FileHandle(forWritingTo: logURL)
    logHandle?.seekToEndOfFile()
    process.standardOutput = logHandle
    process.standardError = logHandle
    process.terminationHandler = { [weak self] _ in
      DispatchQueue.main.async {
        self?.tunnelProcess = nil
        self?.updateLabels()
      }
    }

    do {
      try process.run()
      tunnelProcess = process
    } catch {
      logLabel.stringValue = "Could not start remote tunnel: \(error.localizedDescription)"
    }
  }

  private func loadConfig() -> RelayConfig {
    try? FileManager.default.createDirectory(at: appSupportDir, withIntermediateDirectories: true)
    let configURL = appSupportDir.appendingPathComponent("config.json")
    if let data = try? Data(contentsOf: configURL),
       let decoded = try? JSONDecoder().decode(RelayConfig.self, from: data) {
      let normalized = normalizeConfig(decoded)
      saveConfig(normalized, to: configURL)
      return normalized
    }
    let generated = normalizeConfig(RelayConfig(port: 8787, token: "mobile-codex-" + randomToken(), brokerUrl: nil, relayId: nil, relaySecret: nil))
    saveConfig(generated, to: configURL)
    return generated
  }

  private func normalizeConfig(_ value: RelayConfig) -> RelayConfig {
    RelayConfig(
      port: value.port,
      token: value.token.isEmpty ? "mobile-codex-" + randomToken() : value.token,
      brokerUrl: value.brokerUrl,
      relayId: (value.relayId?.isEmpty == false) ? value.relayId : "mac-" + randomToken().prefix(8),
      relaySecret: (value.relaySecret?.isEmpty == false) ? value.relaySecret : randomToken() + randomToken()
    )
  }

  private func saveConfig(_ value: RelayConfig, to url: URL) {
    if let data = try? JSONEncoder().encode(value) {
      try? data.write(to: url, options: .atomic)
    }
  }

  private func copy(_ value: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
  }

  private func localAddress() -> String {
    for interface in ["en0", "en1"] {
      let address = runAndCapture("/usr/sbin/ipconfig", ["getifaddr", interface]).trimmingCharacters(in: .whitespacesAndNewlines)
      if !address.isEmpty {
        return address
      }
    }
    return "127.0.0.1"
  }

  private func networkHint() -> String? {
    if remoteEndpoint != nil {
      return "Remote mode: Android should use Remote Endpoint, not LAN Endpoint."
    }
    let address = localAddress()
    if isPrivateIPv4(address) {
      return nil
    }
    return "Network note: \(address) is not a private LAN address. If Android cannot connect, use the phone hotspot or a private Wi-Fi network, then reopen this app."
  }

  private func isPrivateIPv4(_ address: String) -> Bool {
    let parts = address.split(separator: ".").compactMap { Int($0) }
    guard parts.count == 4 else {
      return false
    }
    if parts[0] == 10 {
      return true
    }
    if parts[0] == 172 && (16...31).contains(parts[1]) {
      return true
    }
    if parts[0] == 192 && parts[1] == 168 {
      return true
    }
    if parts[0] == 169 && parts[1] == 254 {
      return true
    }
    return false
  }

  private func normalizedBrokerUrl() -> String? {
    guard let raw = config.brokerUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
      return nil
    }
    return raw.hasSuffix("/") ? String(raw.dropLast()) : raw
  }

  private func randomToken() -> String {
    let alphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    return String((0..<24).compactMap { _ in alphabet.randomElement() })
  }

  private func runAndCapture(_ executable: String, _ arguments: [String]) -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = Pipe()
    do {
      try process.run()
      process.waitUntilExit()
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      return String(data: data, encoding: .utf8) ?? ""
    } catch {
      return ""
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
