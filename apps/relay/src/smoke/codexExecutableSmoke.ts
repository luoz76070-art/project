import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexExecutableDetails } from "../codex/codexExecutable.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-codex-executable-"));
const executable = path.join(root, process.platform === "win32" ? "codex.cmd" : "codex");

try {
  fs.writeFileSync(executable, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\nexit 0\n");
  if (process.platform !== "win32") fs.chmodSync(executable, 0o755);

  const configured = resolveCodexExecutableDetails({
    env: { MOBILE_CODEX_EXECUTABLE: executable, PATH: "" },
    homeDir: root,
    platform: process.platform,
  });
  if (configured.executable !== executable || configured.source !== "configured") {
    throw new Error(`configured executable resolution failed: ${JSON.stringify(configured)}`);
  }

  const fromPath = resolveCodexExecutableDetails({
    env: { PATH: root },
    homeDir: path.join(root, "empty-home"),
    platform: process.platform,
  });
  if (fromPath.executable !== executable || fromPath.source !== "path") {
    throw new Error(`PATH executable resolution failed: ${JSON.stringify(fromPath)}`);
  }

  const missing = resolveCodexExecutableDetails({
    env: { PATH: "" },
    homeDir: path.join(root, "missing-home"),
    platform: "linux",
  });
  if (missing.executable !== null || missing.source !== "not-found") {
    throw new Error(`missing executable resolution failed: ${JSON.stringify(missing)}`);
  }

  console.log("codex executable resolver smoke passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
