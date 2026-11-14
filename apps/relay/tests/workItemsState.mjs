import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newAttempt, userAction, verifyItem, recordDelivery, applyTurnResult } from '../dist/workItems/stateMachine.js';
import { fieldsSchema, itemSchema, limits } from '../dist/workItems/schema.js';

import { item, fields, result, bound, binding } from './workItemFixtures.mjs';
const at = '2026-11-14T00:00:00.000Z';
test('all 25 user state pairs require a permitted action; acceptance alone enters done', () => {
  const commands = { todo: 'reopen', in_progress: 'start', to_verify: 'review', returned: 'return' };
  const allowed = new Set(['todo:in_progress', 'todo:returned', 'in_progress:to_verify', 'in_progress:returned', 'to_verify:returned', 'to_verify:done', 'done:todo', 'returned:todo']);
  for (const from of ['todo', 'in_progress', 'to_verify', 'done', 'returned']) for (const to of ['todo', 'in_progress', 'to_verify', 'done', 'returned']) {
    const value = item(from), run = () => to === 'done' ? verifyItem(value, 'accept', at) : userAction(value, commands[to], at, '用户决定');
    if (allowed.has(`${from}:${to}`)) {
      const next = run(); assert.equal(next.state, to); assert.equal(next.lastTransition.actor, 'user');
      if (to === 'todo') assert.notEqual(next.currentAttempt.attemptId, value.currentAttempt.attemptId);
    } else assert.throws(run, /transition_invalid/);
    assert.equal(value.state, from, 'pure transitions do not mutate the previous snapshot');
  }
  assert.throws(() => userAction(item('to_verify'), 'accept', at), /transition_invalid/);
  assert.equal(verifyItem(item('to_verify'), 'return', at, '验收未通过').state, 'returned');
});

test('delivery must be confirmed, bound to this attempt and invoked internally', () => {
  for (const actor of ['system', 'agent']) {
    const value = item();
    assert.equal(recordDelivery(value, { ...bound().currentAttempt, attemptId: value.currentAttempt.attemptId }, at, actor).state, 'in_progress');
  }
});

test('unconfirmed and stale delivery cannot start an attempt', () => {
  const value = item(), valid = { ...bound().currentAttempt, attemptId: value.currentAttempt.attemptId };
  for (const patch of [{ delivery: 'unknown' }, { delivery: 'queued' }, { attemptId: randomUUID() }, { sessionId: null }, { agentId: null }, { lastTurn: result() }]) {
    assert.throws(() => recordDelivery(value, { ...valid, ...patch }, at, 'system'), /binding_invalid/);
  }
  assert.throws(() => recordDelivery(value, valid, at, 'user'), /actor_invalid/);
  assert.throws(() => userAction({ ...value, currentAttempt: { ...value.currentAttempt, delivery: 'unknown' } }, 'start', at), /delivery_unknown/);
});

test('S1 completed only reaches verification; failed and interrupted preserve the exact reason', () => {
  for (const status of ['completed', 'failed', 'interrupted']) for (const actor of ['system', 'agent']) {
    const value = bound(), evidence = result(status), next = applyTurnResult(value, binding(value), evidence, at, actor);
    assert.equal(next.state, status === 'completed' ? 'to_verify' : 'returned');
    assert.deepEqual(next.currentAttempt.lastTurn, evidence);
    assert.equal(next.lastTransition.reason, evidence.reason.message);
    assert.equal(applyTurnResult(next, binding(value), evidence, at, actor), next, 'duplicate is a no-op');
  }
});

test('null, unknown, stale, misbound or late S1 evidence never overrides user decisions', () => {
  const value = bound();
  for (const evidence of [null, undefined, { ...result(), status: 'unknown' }, { ...result(), turnId: 'older-turn' }, { ...result(), endedAt: 'bad' }]) {
    assert.equal(applyTurnResult(value, binding(value), evidence, at, 'system'), value);
  }
  for (const key of ['attemptId', 'channel', 'agentId', 'sessionId', 'turnId']) {
    assert.equal(applyTurnResult(value, { ...binding(value), [key]: 'wrong' }, result(), at, 'system'), value);
  }
  for (const state of ['todo', 'to_verify', 'done', 'returned']) {
    const decided = { ...value, state };
    assert.equal(applyTurnResult(decided, binding(value), result('failed'), at, 'agent'), decided);
  }
  const reopened = userAction({ ...value, state: 'done' }, 'reopen', at);
  assert.equal(reopened.currentAttempt.lastTurn, null); assert.equal(reopened.currentAttempt.turnId, null);
  assert.equal(applyTurnResult(reopened, binding(value), result(), at, 'system'), reopened);
  assert.throws(() => applyTurnResult(value, binding(value), result(), at, 'user'), /actor_invalid/);
});

test('shared limits count Unicode titles and UTF-8 bodies, rejecting fields outside the contract', () => {
  assert.ok(fieldsSchema.safeParse({ ...fields(), title: '🙂'.repeat(200) }).success);
  for (const patch of [{ title: '🙂'.repeat(201) }, { detail: '中'.repeat(Math.ceil(limits.detail / 3)) },
    { assets: Array(17).fill({}) }, { codeRefs: Array(33).fill('a') }, { state: 'done' }, { currentAttempt: {} }]) {
    assert.equal(fieldsSchema.safeParse({ ...fields(), ...patch }).success, false);
  }
  assert.equal(itemSchema.safeParse({ ...item(), schemaVersion: 2 }).success, false);
  assert.equal(itemSchema.safeParse({ ...item(), detail: 'x'.repeat(limits.detail), codeRefs: Array(32).fill('x'.repeat(4096)),
    currentAttempt: { ...newAttempt(), message: 'x'.repeat(limits.message) } }).success, false);
});
