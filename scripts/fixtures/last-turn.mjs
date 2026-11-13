// Synthetic public results shared by relay and mobile boundary tests.
export const turnResults = [
  { turnId: 'synthetic-completed', status: 'completed', reason: { code: 'ok', message: '本轮已完成。' }, endedAt: '2026-11-13T01:00:00.000Z', timeSource: 'provider' },
  { turnId: 'synthetic-failed', status: 'failed', reason: { code: 'provider_error', message: '本轮执行失败，请在电脑端查看详情。' }, endedAt: '2026-11-13T01:01:00.000Z', timeSource: 'provider' },
  { turnId: 'synthetic-interrupted', status: 'interrupted', reason: { code: 'cancelled', message: '本轮已中断。' }, endedAt: '2026-11-13T01:02:00.000Z', timeSource: 'provider' },
];
