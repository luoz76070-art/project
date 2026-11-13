import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { messageOf, finalMessageId } from './messages.mjs';

const fail = (code, status = 409) => Object.assign(new Error(`DEEPSEEK_${code}`), { status });
const iso = value => new Date(Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15 ? value : Date.now()).toISOString();

/** Original Host catalog and non-activating pages. Only prompt may restore an Agent. */
export function createDeepSeekCatalog(ctx, token, retained = () => false) {
  const rows = new Map(), lists = new Map(), pages = new Map();
  let cached = null, cacheUntil = 0;
  const controller = () => {
    const service = ctx.get?.('sessionController') ?? ctx.sessionController;
    if (!service || !['list', 'page', 'prompt'].every(key => typeof service[key] === 'function')) throw fail('HISTORY_UNAVAILABLE', 503);
    return service;
  };
  function identity(hostId) {
    const bytes = createHmac('sha256', token).update('mobile-deepseek-session\0').update(hostId).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function remember(item) {
    if (typeof item.sessionId !== 'string' || !item.sessionId || item.sessionId.length > 4096
      || typeof item.cwd !== 'string' || !path.isAbsolute(item.cwd) || item.cwd.length > 4096 || item.origin) return null;
    const id = identity(item.sessionId), title = item.projections?.values?.title;
    const row = { hostId: item.sessionId, running: item.running === true, session: { id, title: typeof title === 'string' && title ? title.slice(0, 256) : `DeepSeek · ${item.sessionId.slice(0, 64)}`, directory: path.resolve(item.cwd), updatedAt: iso(item.updatedAt) } };
    if (!rows.has(id) && rows.size >= 16384) throw fail('CATALOG_LIMIT', 429);
    rows.set(id, row); return row;
  }
  async function load(signal) {
    signal.throwIfAborted();
    if (cached && Date.now() < cacheUntil) return cached;
    const result = await controller().list({}, signal); signal.throwIfAborted();
    if (!Array.isArray(result?.items)) throw fail('PROTOCOL_ERROR', 502);
    const resultRows = [], seen = new Set();
    for (const item of result.items) {
      const row = remember(item); if (!row) continue;
      if (seen.has(row.session.id)) throw fail('PROTOCOL_ERROR', 502);
      seen.add(row.session.id); resultRows.push(row.session);
    }
    cached = resultRows.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)); cacheUntil = Date.now() + 15_000;
    return cached;
  }
  function prune(map) { for (const [id, item] of map) if (item.expires < Date.now()) map.delete(id); }
  function issue(map, value, limit) {
    prune(map); if (map.size >= limit) map.delete(map.keys().next().value);
    const id = randomUUID(); map.set(id, { ...value, expires: Date.now() + 15 * 60_000 }); return id;
  }
  async function resolve(id, signal) {
    if (!rows.has(id)) await load(signal);
    const row = rows.get(id); if (!row) throw fail('SESSION_GONE', 410); return row;
  }
  return {
    identity,
    invalidate() { cacheUntil = 0; },
    row(id) { const row = rows.get(id); if (!row) throw fail('SESSION_GONE', 410); return row; },
    rememberAgent(agent) {
      const id = identity(agent.id);
      if (!rows.has(id)) remember({ sessionId: agent.id, cwd: agent.session.header.cwd, origin: agent.session.header.origin, updatedAt: agent.session.header.createdAt });
      return id;
    },
    resolve,
    async list(search, cursor, signal, range = 'recent') {
      if (!['recent', 'all'].includes(range)) throw fail('INPUT_INVALID', 400);
      const query = search?.toLowerCase() ?? ''; let sessions, offset = 0;
      if (cursor) {
        prune(lists); const cut = lists.get(cursor);
        if (!cut || cut.query !== query || cut.range !== range) throw fail('CURSOR_INVALID', 400);
        sessions = cut.sessions; offset = cut.offset;
      } else {
        const cutoff = Date.now() - 30 * 24 * 60 * 60_000;
        sessions = (await load(signal)).filter(row => (range === 'all' || Date.parse(row.updatedAt) >= cutoff || rows.get(row.id)?.running || retained(row.id))
          && (!query || `${row.title}\n${row.directory}`.toLowerCase().includes(query)));
      }
      return { sessions: sessions.slice(offset, offset + 50), cursor: offset + 50 < sessions.length ? issue(lists, { sessions, offset: offset + 50, query, range }, 16) : null };
    },
    async page(id, cursor, signal) {
      const row = await resolve(id, signal); let cut;
      if (cursor) {
        prune(pages); cut = pages.get(cursor);
        if (!cut || cut.id !== id) throw fail('CURSOR_INVALID', 400);
      }
      const observation = await ctx.sessionQuery.observeSession(row.hostId, { signal, projectionMode: 'none' });
      try {
        signal.throwIfAborted();
        if (observation.header.id !== row.hostId || observation.header.origin || path.resolve(observation.header.cwd ?? '') !== row.session.directory
          || !Number.isSafeInteger(observation.cursor) || observation.cursor < -1) throw fail('SESSION_CHANGED', 409);
        const throughSeq = cut?.throughSeq ?? observation.cursor;
        if (throughSeq > observation.cursor) throw fail('CURSOR_INVALID', 400);
        const page = await controller().page({ address: { kind: 'session', sessionId: row.hostId }, throughSeq, ...(cut ? { beforeSeq: cut.beforeSeq } : {}), maxMessages: 40 }, signal);
        signal.throwIfAborted();
        if (!Array.isArray(page?.records) || typeof page.hasMore !== 'boolean') throw fail('PROTOCOL_ERROR', 502);
        const events = page.records.map(record => {
          if (record?.type !== 'event' || !Number.isSafeInteger(record.event?.seq) || record.event.seq < 0 || record.event.seq > throughSeq
            || (cut && record.event.seq >= cut.beforeSeq)) throw fail('PROTOCOL_ERROR', 502);
          return record.event;
        });
        for (let i=1;i<events.length;i++) if (events[i].seq <= events[i-1].seq) throw fail('PROTOCOL_ERROR', 502);
        const phaseState = {}, finalIds = new Set();
        for (const event of events) { const id = finalMessageId(phaseState, event); if (id) finalIds.add(id); }
        let budget = 256 * 1024, trimmed = false; const kept = [], seen = new Set();
        for (const event of events.slice().reverse()) {
          const message = messageOf(event); if (!message || seen.has(message.id)) continue;
          if (finalIds.has(message.id)) message.phase = 'final_answer';
          const bytes = Buffer.byteLength(JSON.stringify(message));
          if (bytes > budget) { trimmed = true; break; }
          budget -= bytes; seen.add(message.id); kept.push({ message, seq: event.seq });
        }
        const beforeSeq = trimmed ? kept.at(-1)?.seq : events[0]?.seq;
        if (page.hasMore && beforeSeq === undefined) throw fail('PROTOCOL_ERROR', 502);
        const next = (page.hasMore || trimmed) && beforeSeq > 0 ? issue(pages, { id, throughSeq, beforeSeq }, 512) : null;
        return { events, messages: kept.reverse().map(item => item.message), cursor: next, throughSeq, session: row.session };
      } finally { observation[Symbol.dispose](); }
    },
    async prompt(id, input, signal) {
      const row = await resolve(id, signal); signal.throwIfAborted();
      const result = await controller().prompt({ sessionId: row.hostId, requestId: input.clientMessageId, mode: 'queue', content: [{ type: 'text', text: input.text }] }, signal);
      if (result?.accepted !== true) throw fail('RESULT_UNKNOWN', 502);
    },
    stop() { rows.clear(); lists.clear(); pages.clear(); cached = null; },
  };
}
