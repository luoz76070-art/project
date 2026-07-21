#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.join(rootDir, "scripts", "helper", "MobileCodexInput.swift");
const appDir = path.join(rootDir, "Mobile Codex Input.app");
const contentsDir = path.join(appDir, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const execFile = path.join(macosDir, "MobileCodexInput");
const plistFile = path.join(contentsDir, "Info.plist");

function parseArgs(argv) {
  return {
    force: argv.includes("--force"),
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
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

function helperIsCurrent() {
  if (!fs.existsSync(execFile) || !fs.existsSync(plistFile)) return false;
  return fs.statSync(execFile).mtimeMs >= fs.statSync(sourceFile).mtimeMs;
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>MobileCodexInput</string>
  <key>CFBundleIdentifier</key>
  <string>local.mobile-codex.input-helper</string>
  <key>CFBundleName</key>
  <string>Mobile Codex Input</string>
  <key>CFBundleDisplayName</key>
  <string>Mobile Codex Input</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
  fs.writeFileSync(plistFile, plist);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.platform !== "darwin") {
    console.log("Skipping Mobile Codex Input helper build: macOS only.");
    return;
  }
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Missing helper source: ${sourceFile}`);
  }
  if (!commandExists("swiftc")) {
    throw new Error("Missing swiftc. Install Xcode Command Line Tools first: xcode-select --install");
  }
  if (!options.force && helperIsCurrent()) {
    console.log(`Mobile Codex Input helper already current: ${appDir}`);
    console.log(`Executable: ${execFile}`);
    console.log(`Platform: ${os.platform()} ${os.release()}`);
    return;
  }

  fs.mkdirSync(macosDir, { recursive: true });
  writeInfoPlist();
  run("swiftc", [sourceFile, "-O", "-framework", "AppKit", "-framework", "ApplicationServices", "-o", execFile]);
  fs.chmodSync(execFile, 0o755);
  if (commandExists("codesign")) {
    run("codesign", ["--force", "--deep", "--sign", "-", appDir]);
  }

  console.log(`Mobile Codex Input helper ready: ${appDir}`);
  console.log(`Executable: ${execFile}`);
  console.log(`Platform: ${os.platform()} ${os.release()}`);
}

main();
