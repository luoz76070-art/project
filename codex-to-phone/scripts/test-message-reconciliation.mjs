#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(rootDir, "apps", "mobile", "src", "messageReconciliation.ts");
const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-codex-message-test-"));
const outputPath = path.join(temporaryDir, "messageReconciliation.mjs");

try {
  const source = await fs.readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0, "message reconciliation source should transpile");
  await fs.writeFile(outputPath, output.outputText);

  const { collapseMirroredMessages, reconcileMessages, stripCodexAppDirectives } = await import(pathToFileURL(outputPath).href);
  const rawDesktopMessages = [
    message("response-user-1", "2026-07-11T08:59:24.552Z", "user", "你好", "message"),
    message("event-user-1", "2026-07-11T08:59:24.552Z", "user", "你好", "user_message"),
    message("event-agent-1", "2026-07-11T08:59:44.159Z", "assistant", "你好。", "agent_message"),
    message("response-agent-1", "2026-07-11T08:59:44.163Z", "assistant", "你好。", "message"),
    message("response-user-2", "2026-07-11T09:01:27.685Z", "user", "你好", "message"),
    message("event-user-2", "2026-07-11T09:01:27.686Z", "user", "你好", "user_message"),
    message("event-agent-2", "2026-07-11T09:02:41.997Z", "assistant", "你好，我在。", "agent_message"),
    message("response-agent-2", "2026-07-11T09:02:42.006Z", "assistant", "你好，我在。", "message"),
    message("response-user-3", "2026-07-11T09:02:58.221Z", "user", "你好", "message"),
    message("event-user-3", "2026-07-11T09:02:58.221Z", "user", "你好", "user_message"),
    message("event-agent-3", "2026-07-11T09:03:07.446Z", "assistant", "你好，我在。", "agent_message"),
    message("response-agent-3", "2026-07-11T09:03:07.450Z", "assistant", "你好，我在。", "message"),
  ];

  assert.deepEqual(
    collapseMirroredMessages(rawDesktopMessages).map(({ role, text }) => [role, text]),
    [
      ["user", "你好"],
      ["assistant", "你好。"],
      ["user", "你好"],
      ["assistant", "你好，我在。"],
      ["user", "你好"],
      ["assistant", "你好，我在。"],
    ],
    "repeated turns must remain visible while mirrored rollout events collapse",
  );

  const cached = [
    message("response-user-1", "2026-07-11T08:59:24.552Z", "user", "你好", "message"),
    message("event-agent-1", "2026-07-11T08:59:44.159Z", "assistant", "你好。", "agent_message"),
    message("desktop-local-3", "2026-07-11T09:02:59.000Z", "user", "你好", "local"),
  ];
  const reconciled = reconcileMessages(cached, rawDesktopMessages);
  assert.deepEqual(
    reconciled.map(({ role, text }) => [role, text]),
    [
      ["user", "你好"],
      ["assistant", "你好。"],
      ["user", "你好"],
      ["assistant", "你好，我在。"],
      ["user", "你好"],
      ["assistant", "你好，我在。"],
    ],
    "cached optimistic input must reconcile with its matching desktop event without disturbing earlier turns",
  );
  assert.ok(
    reconciled.every((item, index, items) => index === 0 || Date.parse(items[index - 1].timestamp) <= Date.parse(item.timestamp)),
    "reconciled messages must follow desktop timestamp order",
  );

  assert.equal(
    reconcileMessages(
      [message("latest-window-a", "2026-07-11T09:03:07.450Z", "assistant", "你好，我在。", "message")],
      [message("latest-window-b", "2026-07-11T09:03:07.450Z", "assistant", "你好，我在。", "message")],
    ).length,
    1,
    "the same rollout event read through a shifted tail window must remain a single message",
  );

  assert.equal(
    stripCodexAppDirectives(
      [
        "已上传更新。",
        "",
        '::git-stage{cwd="/Users/example/project"}',
        '::git-commit{cwd="/Users/example/project"}',
        '::git-push{cwd="/Users/example/project" branch="main"}',
        "",
        "```text",
        '::git-stage{cwd="/shown/as/example"}',
        "```",
      ].join("\n"),
    ),
    ['已上传更新。', "", "```text", '::git-stage{cwd=\"/shown/as/example\"}', "```"].join("\n"),
    "Codex app directives should be hidden outside fenced examples",
  );

  console.log("message reconciliation regression tests passed");
} finally {
  await fs.rm(temporaryDir, { recursive: true, force: true });
}

function message(id, timestamp, role, text, kind) {
  return { id, timestamp, role, text, kind };
}
