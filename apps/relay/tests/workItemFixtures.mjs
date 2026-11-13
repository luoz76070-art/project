import { randomUUID } from 'node:crypto';
import { newAttempt, recordDelivery } from '../dist/workItems/stateMachine.js';
const at = '2026-11-14T00:00:00.000Z';
export const fields = () => ({ kind: 'task', title: '合成事项', detail: '只用于隔离测试', assets: [], codeRefs: [] });
export const item = (state = 'todo') => ({ ...fields(), schemaVersion: 1, uid: randomUUID(), revision: 1, state,
  createdAt: at, updatedAt: at, createdByDeviceId: 'device-a', source: { kind: 'manual' }, currentAttempt: newAttempt(), lastTransition: null });
export const result = (status = 'completed') => ({ turnId: 'turn-fixture', status, reason: { code: status === 'interrupted' ? 'cancelled' : status === 'failed' ? 'engine_exited' : 'completed',
  message: status === 'interrupted' ? '用户取消了这一轮' : status === 'failed' ? '引擎已退出' : '本轮已完成' }, endedAt: at, timeSource: 'observed' });
export const bound = () => {
  const value = item();
  return recordDelivery(value, { ...value.currentAttempt, channel: 'agent', agentId: 'deepseek', sessionId: 'session-fixture',
    clientMessageId: randomUUID(), turnId: 'turn-fixture', delivery: 'delivered', message: '冻结正文' }, at, 'system');
};
export const binding = value => Object.fromEntries(['attemptId', 'channel', 'agentId', 'sessionId', 'turnId'].map(k => [k, value.currentAttempt[k]]));
