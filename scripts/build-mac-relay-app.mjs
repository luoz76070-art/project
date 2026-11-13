#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.join(rootDir, "scripts", "helper", "MobileCodexRelay.swift");
const appDir = path.join(rootDir, "Mobile Codex Relay.app");
const contentsDir = path.join(appDir, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const execFile = path.join(macosDir, "MobileCodexRelay");
const plistFile = path.join(contentsDir, "Info.plist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    cwd: options.cwd ?? rootDir,
    env: process.env,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `\n${output}` : ""}`);
  }
  return result.stdout.trim();
}

function commandExists(command) {
  const result = spawnSync("/usr/bin/which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>MobileCodexRelay</string>
  <key>CFBundleIdentifier</key>
  <string>local.mobile-codex.relay</string>
  <key>CFBundleName</key>
  <string>Mobile Codex Relay</string>
  <key>CFBundleDisplayName</key>
  <string>Mobile Codex Relay</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>MobileCodexProjectRoot</key>
  <string>${xmlEscape(rootDir)}</string>
  <key>MobileCodexNodePath</key>
  <string>${xmlEscape(process.execPath)}</string>
</dict>
</plist>
`;
  fs.writeFileSync(plistFile, plist);
}

function main() {
  if (process.platform !== "darwin") {
    console.log("Skipping Mobile Codex Relay app build: macOS only.");
    return;
  }
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Missing source file: ${sourceFile}`);
  }
  if (!commandExists("swiftc")) {
    throw new Error("Missing swiftc. Install Xcode Command Line Tools first: xcode-select --install");
  }
  if (!fs.existsSync(path.join(rootDir, "apps", "relay", "dist", "server.js"))) {
    throw new Error("Relay build is missing. Run corepack pnpm build first.");
  }

  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  writeInfoPlist();
  run("swiftc", [sourceFile, "-O", "-framework", "AppKit", "-o", execFile]);
  fs.chmodSync(execFile, 0o755);
  if (commandExists("codesign")) {
    run("codesign", ["--force", "--deep", "--sign", "-", appDir]);
  }

  console.log(`Mobile Codex Relay app ready: ${appDir}`);
  console.log(`Executable: ${execFile}`);
  console.log(`Project root: ${rootDir}`);
  console.log(`Node: ${process.execPath}`);
  console.log(`Platform: ${os.platform()} ${os.release()}`);
}

main();
