#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_FILE = path.join(ROOT_DIR, "scripts", "helper", "CodexLiveSessionInput.swift");
const APP_DIR = path.join(ROOT_DIR, "Codex Live Session Input.app");
const CONTENTS_DIR = path.join(APP_DIR, "Contents");
const MACOS_DIR = path.join(CONTENTS_DIR, "MacOS");
const EXEC_FILE = path.join(MACOS_DIR, "CodexLiveSessionInput");
const PLIST_FILE = path.join(CONTENTS_DIR, "Info.plist");

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
  if (!fs.existsSync(EXEC_FILE) || !fs.existsSync(PLIST_FILE)) return false;
  const sourceMtime = fs.statSync(SOURCE_FILE).mtimeMs;
  const execMtime = fs.statSync(EXEC_FILE).mtimeMs;
  return execMtime >= sourceMtime;
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>CodexLiveSessionInput</string>
  <key>CFBundleIdentifier</key>
  <string>local.codex-to-phone.input-helper</string>
  <key>CFBundleName</key>
  <string>Codex Live Session Input</string>
  <key>CFBundleDisplayName</key>
  <string>Codex Live Session Input</string>
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
  fs.writeFileSync(PLIST_FILE, plist);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.platform !== "darwin") {
    console.log("Skipping UI helper build: macOS only.");
    return;
  }
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Missing helper source: ${SOURCE_FILE}`);
  }
  if (!commandExists("swiftc")) {
    throw new Error("Missing swiftc. Install Xcode Command Line Tools first: xcode-select --install");
  }

  if (!options.force && helperIsCurrent()) {
    console.log(`UI helper already current: ${APP_DIR}`);
    console.log(`Executable: ${EXEC_FILE}`);
    console.log(`Platform: ${os.platform()} ${os.release()}`);
    return;
  }

  fs.mkdirSync(MACOS_DIR, { recursive: true });
  writeInfoPlist();
  run("swiftc", [
    SOURCE_FILE,
    "-O",
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-o",
    EXEC_FILE,
  ]);
  fs.chmodSync(EXEC_FILE, 0o755);

  if (commandExists("codesign")) {
    run("codesign", ["--force", "--deep", "--sign", "-", APP_DIR]);
  }

  console.log(`UI helper ready: ${APP_DIR}`);
  console.log(`Executable: ${EXEC_FILE}`);
  console.log(`Platform: ${os.platform()} ${os.release()}`);
}

main();
