#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(rootDir, "apps", "mobile", "src", "features", "chat", "messageReconciliation.ts");
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
  const steeringTurn = '00000000-0000-4000-8000-000000000010';
  const acceptedSteer = { ...message(`desktop-${steeringTurn}-accepted-item`, '2026-10-23T05:51:35.517Z', 'user', '合成引导：只回复成功', 'userMessage'), turnId: steeringTurn, clientMessageId: 'synthetic-steering-client' };
  const persistedSteer = { ...message('log-synthetic-200', '2026-10-23T05:52:09.088Z', 'user', acceptedSteer.text, 'message'), turnId: steeringTurn, sourceItemId: 'msg_synthetic_steering' };
  for (const [before, arriving] of [[[acceptedSteer], [persistedSteer]], [[persistedSteer], [acceptedSteer]]]) {
    const result = reconcileMessages(before, arriving);
    assert.equal(result.length, 1, 'accepted steering and its rollout record must display once despite the turn-start timestamp fallback');
    assert.equal(result[0].id, persistedSteer.id);
    assert.equal(result[0].timestamp, persistedSteer.timestamp);
    assert.equal(result[0].clientMessageId, acceptedSteer.clientMessageId);
    assert.equal(result[0].sourceItemId, persistedSteer.sourceItemId);
    assert.equal(result[0].turnId, steeringTurn);
    assert.equal(reconcileMessages(JSON.parse(JSON.stringify(result)), [{ ...acceptedSteer, clientMessageId: undefined }]).length, 1, 'a cached source association also recognizes a replay that lacks its earlier client ID');
    assert.deepEqual(reconcileMessages(result, [acceptedSteer, persistedSteer]), result, 'replayed snapshots cannot restore the second copy');
    assert.equal(reconcileMessages(result, [{ ...acceptedSteer, id: 'desktop-local-synthetic-steering-client', kind: 'local' }]).length, 1, 'late HTTP placeholders still join the accepted input');
  }
  const nativeRepeated = { ...acceptedSteer, id: `desktop-${steeringTurn}-second-item`, clientMessageId: 'synthetic-second-client' };
  const historyRepeated = { ...persistedSteer, id: 'log-synthetic-300', sourceItemId: 'msg_synthetic_second', timestamp: '2026-10-23T05:52:10.088Z' };
  const repeatedInputs = reconcileMessages([acceptedSteer, nativeRepeated], [persistedSteer, historyRepeated]);
  assert.equal(repeatedInputs.length, 2, 'two actual same-text inputs in one turn keep their multiplicity across sources');
  assert.deepEqual(repeatedInputs.map(m => m.clientMessageId), [acceptedSteer.clientMessageId, nativeRepeated.clientMessageId]);
  assert.equal(reconcileMessages(repeatedInputs, [nativeRepeated, acceptedSteer, persistedSteer, historyRepeated]).length, 2);
  assert.equal(reconcileMessages([acceptedSteer], [{ ...persistedSteer, turnId: 'different-turn' }]).length, 2, 'same text in different turns cannot be joined');
  assert.equal(reconcileMessages([{ ...acceptedSteer, text: '保留  空格' }], [{ ...persistedSteer, text: '保留 空格' }]).length, 2, 'source joining requires the full body rather than whitespace-normalized content');
  assert.equal(reconcileMessages([acceptedSteer, nativeRepeated], [persistedSteer]).length, 3, 'partial history with ambiguous repeated inputs is kept rather than guessing an identity');
  assert.equal(reconcileMessages([persistedSteer], [{ ...persistedSteer, id: 'log-independent', sourceItemId: 'msg_independent' }]).length, 2, 'distinct persisted user source identities survive identical text and timestamps');
  assert.equal(reconcileMessages([{ ...acceptedSteer, clientMessageId: undefined }], [{ ...nativeRepeated, clientMessageId: undefined }]).length, 2, 'native items without submission metadata are not removed as identical events');
  const attachedSteer = { ...acceptedSteer, attachments: [{ id: 'synthetic-upload', path: '/synthetic/input.txt' }] };
  assert.deepEqual(reconcileMessages([attachedSteer], [persistedSteer])[0].attachments, attachedSteer.attachments, 'source reconciliation keeps attachment metadata');
  const eventCopy = { ...persistedSteer, id: 'log-synthetic-user-event', sourceItemId: undefined, turnId: undefined, kind: 'user_message' };
  const withEventMirror = reconcileMessages([attachedSteer], [eventCopy, persistedSteer]);
  assert.equal(withEventMirror.length, 1, 'an additional rollout user event does not prevent the native/history association');
  assert.equal(withEventMirror[0].sourceItemId, persistedSteer.sourceItemId);
  assert.equal(withEventMirror[0].clientMessageId, acceptedSteer.clientMessageId);
  const { turnId: ignoredOldTurn, sourceItemId: ignoredOldSource, ...oldHistorySteer } = persistedSteer;
  assert.equal(reconcileMessages([acceptedSteer, oldHistorySteer], [persistedSteer]).length, 1, 'same-ID refresh enriches old history before joining the accepted steering copy');
  // Initial/older native items may lack a submission ID. Progress records also
  // put the history copy beyond the four-neighbour fallback search.
  const noClientNative = { ...acceptedSteer, clientMessageId: undefined };
  const intervening = Array.from({ length: 7 }, (_, i) => ({
    ...message(`progress-${i}`, acceptedSteer.timestamp, 'tool', `合成执行过程 ${i + 1}`, 'commandExecution'), turnId: steeringTurn,
  }));
  for (const [before, arriving] of [[[noClientNative, ...intervening], [persistedSteer]], [[persistedSteer], [noClientNative, ...intervening]]]) {
    const result = reconcileMessages(before, arriving);
    assert.equal(result.filter(m => m.role === 'user').length, 1, 'native/history copies with missing client IDs and intervening progress must join by turn and occurrence');
    assert.equal(result.find(m => m.role === 'user').nativeMessageId, noClientNative.id, 'retain the native alias after choosing the history record');
    const restored = JSON.parse(JSON.stringify(result));
    assert.equal(reconcileMessages(restored, [noClientNative, persistedSteer]).filter(m => m.role === 'user').length, 1, 'native replay after a cache roundtrip cannot resurrect an identity-free copy');
    const secondNative = { ...noClientNative, id: `desktop-${steeringTurn}-genuine-second` };
    assert.equal(reconcileMessages(restored, [secondNative]).filter(m => m.role === 'user').length, 2, 'a new native occurrence must not consume the alias already assigned to the first input');
    const two = reconcileMessages([...restored, secondNative], [historyRepeated]);
    assert.equal(two.filter(m => m.role === 'user').length, 2);
    assert.equal(reconcileMessages(two, [noClientNative, secondNative, persistedSteer, historyRepeated]).filter(m => m.role === 'user').length, 2);
  }
  const nativeId = 'desktop-00000000-0000-4000-8000-000000000001-msg_synthetic_final';
  const nativeFinal = { ...message(nativeId, '2026-10-22T18:52:02.622Z', 'assistant', '同一条完整回复', 'agentMessage'), sourceItemId: 'msg_synthetic_final' };
  const historyFinal = { ...message('log-fixture-100', '2026-10-22T18:52:19.963Z', 'assistant', nativeFinal.text, 'message'), sourceItemId: 'msg_synthetic_final', phase: 'final_answer' };
  const joined = reconcileMessages([nativeFinal], [historyFinal]);
  assert.equal(joined.length, 1, 'native turn-start time and rollout completion time must not duplicate the same source item');
  assert.equal(joined[0].timestamp, historyFinal.timestamp, 'persisted item timestamp replaces the native turn fallback');
  assert.equal(joined[0].phase, 'final_answer');
  const { sourceItemId: unusedIdentity, ...legacyNative } = nativeFinal;
  assert.equal(reconcileMessages([legacyNative], [historyFinal]).length, 1, 'old native cache recovers its source identity from its ID');
  const { sourceItemId: unusedHistoryIdentity, ...legacyHistory } = historyFinal;
  assert.equal(reconcileMessages([legacyHistory, legacyNative], [historyFinal]).length, 1, 'a same-ID history refresh enriches old cached messages before collapsing');
  assert.equal(reconcileMessages([historyFinal], [{ ...historyFinal, id: 'log-fixture-200', sourceItemId: 'msg_different_final' }]).length, 2, 'distinct source items with identical text and timestamp remain distinct');
  assert.equal(reconcileMessages([nativeFinal], [{ ...historyFinal, text: nativeFinal.text + '，完整版本' }]).length, 1, 'streaming and final versions join by source identity');
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

  const authoritative = { ...message("desktop-authoritative", "2026-07-11T09:00:00Z", "user", "继续", "userMessage"), clientMessageId: "submission-a" };
  const progress = message("desktop-progress", "2026-07-11T09:01:00Z", "assistant", "正在继续处理", "agentMessage");
  const local = { ...message("desktop-local-submission-a", "2026-07-11T09:05:00Z", "user", "继续", "local"), attachments: [{ id: "attachment-a" }] };
  for (const [before, arriving] of [[[authoritative, progress], [local]], [[local], [authoritative, progress]]]) {
    const merged = reconcileMessages(before, arriving);
    assert.deepEqual(merged.map(item => item.id), [authoritative.id, progress.id], "client identity must reconcile either HTTP/SSE order despite clock skew and assistant output");
    assert.deepEqual(merged[0].attachments, local.attachments, "authoritative replacement retains local attachment metadata");
    assert.deepEqual(reconcileMessages(merged, [local, authoritative]), merged, "repeated snapshots and late acknowledgements cannot resurrect the local copy");
  }
  assert.equal(reconcileMessages([authoritative], [{ ...authoritative, id: "desktop-new-item", timestamp: "2026-07-11T09:10:00Z" }]).length, 1,
    "turn input replaced by a canonical item keeps one client identity");
  const beforeIdentity = { ...authoritative, clientMessageId: undefined };
  const identityEnriched = reconcileMessages([beforeIdentity], [authoritative]);
  assert.equal(identityEnriched[0].clientMessageId, authoritative.clientMessageId, "an equal-text cache entry must retain a newly supplied submission identity");
  assert.equal(reconcileMessages(identityEnriched, [{ ...local, clientMessageId: authoritative.clientMessageId }]).length, 1, "a late local copy cannot return after identity enrichment");
  const secondSubmission = { ...authoritative, id: "desktop-second", clientMessageId: "submission-b" };
  assert.equal(reconcileMessages([authoritative], [secondSubmission]).length, 2, "identical content and timestamps with different submission identities remain two messages");
  const secondLocal = { ...local, id: "desktop-local-submission-b", clientMessageId: "submission-b" };
  const separate = reconcileMessages([local, secondLocal], [authoritative]);
  assert.deepEqual(separate.map(item => item.id), [authoritative.id, secondLocal.id], "confirmation of one submission cannot consume a different same-text pending message");
  const oldServiceLocal = message("desktop-local-old", "2026-07-11T09:00:01Z", "user", "兼容旧服务", "local");
  assert.equal(reconcileMessages([oldServiceLocal], [message("old-server", "2026-07-11T09:00:02Z", "user", "兼容旧服务", "userMessage")]).length, 1,
    "old services without client identities retain the bounded text matching fallback");

  console.log("message reconciliation regression tests passed (including native identity and HTTP/SSE races)");
} finally {
  await fs.rm(temporaryDir, { recursive: true, force: true });
}

function message(id, timestamp, role, text, kind) {
  return { id, timestamp, role, text, kind };
}
