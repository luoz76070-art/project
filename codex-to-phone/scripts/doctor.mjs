#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CODEX_APP = "/Applications/Codex.app";
const HELPER_APP = path.join(ROOT_DIR, "Codex Live Session Input.app");
const HELPER_EXEC = path.join(HELPER_APP, "Contents", "MacOS", "CodexLiveSessionInput");

function commandExists(command) {
  const result = spawnSync("/usr/bin/which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function nodeMajorVersion() {
  const match = process.versions.node.match(/^(\d+)/u);
  return match ? Number(match[1]) : 0;
}

function check(name, ok, fix = "") {
  const mark = ok ? "ok" : "missing";
  console.log(`${mark.padEnd(7)} ${name}${ok || !fix ? "" : `\n        fix: ${fix}`}`);
  return ok;
}

function note(name, ok, message) {
  const mark = ok ? "ok" : "note";
  console.log(`${mark.padEnd(7)} ${name}${ok ? "" : `\n        ${message}`}`);
}

function main() {
  const results = [];
  results.push(check("macOS", process.platform === "darwin", "Codex To Phone currently supports macOS only."));
  results.push(check("Node.js >= 22", nodeMajorVersion() >= 22, "Install Node.js 22 or newer."));
  results.push(check("cloudflared", commandExists("cloudflared"), "brew install cloudflared"));
  results.push(check("swiftc", commandExists("swiftc"), "xcode-select --install"));
  results.push(check("Codex Desktop", fs.existsSync(CODEX_APP), "Install Codex Desktop at /Applications/Codex.app."));
  note(
    "Codex Live Session Input helper",
    fs.existsSync(HELPER_EXEC),
    "Not built yet. npm start and npm run plugin:start build it automatically.",
  );

  const ok = results.every(Boolean);
  console.log("");
  if (ok) {
    console.log("Codex To Phone is ready to start.");
    console.log("Next: open the target Codex Desktop conversation, then run npm start.");
  } else {
    console.log("Fix the missing items above, then rerun npm run doctor.");
    process.exitCode = 1;
  }
}

main();
