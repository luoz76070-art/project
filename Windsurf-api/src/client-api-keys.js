import { randomBytes, randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config, log } from './config.js';

const API_KEYS_FILE = join(process.cwd(), 'client-api-keys.json');
const managedKeys = [];
let loaded = false;

function loadKeys() {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(API_KEYS_FILE)) return;
    const data = JSON.parse(readFileSync(API_KEYS_FILE, 'utf-8'));
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (!item?.id || !item?.key) continue;
      managedKeys.push({
        id: item.id,
        label: item.label || item.id,
        note: item.note || '',
        key: item.key,
        status: item.status === 'disabled' ? 'disabled' : 'active',
        createdAt: item.createdAt || Date.now(),
        lastUsed: item.lastUsed || 0,
        requestCount: item.requestCount || 0,
        _lastPersistAt: 0,
      });
    }
    if (managedKeys.length) log.info(`Loaded ${managedKeys.length} managed client API key(s)`);
  } catch (err) {
    log.error(`Failed to load client API keys: ${err.message}`);
  }
}

function saveKeys() {
  try {
    const data = managedKeys.map(k => ({
      id: k.id,
      label: k.label,
      note: k.note,
      key: k.key,
      status: k.status,
      createdAt: k.createdAt,
      lastUsed: k.lastUsed || 0,
      requestCount: k.requestCount || 0,
    }));
    writeFileSync(API_KEYS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.error(`Failed to save client API keys: ${err.message}`);
  }
}

function toPublicKey(key) {
  return {
    id: key.id,
    label: key.label,
    note: key.note || '',
    key: key.key,
    status: key.status,
    kind: 'managed',
    mutable: true,
    createdAt: new Date(key.createdAt).toISOString(),
    lastUsed: key.lastUsed ? new Date(key.lastUsed).toISOString() : null,
    requestCount: key.requestCount || 0,
  };
}

function bootstrapKeyRecord() {
  if (!config.apiKey) return null;
  return {
    id: 'bootstrap',
    label: '环境变量 API_KEY',
    note: '来自 .env / 进程环境，只读',
    key: config.apiKey,
    status: 'active',
    kind: 'bootstrap',
    mutable: false,
    createdAt: null,
    lastUsed: null,
    requestCount: null,
  };
}

function maybePersistUsage(key, now) {
  key.lastUsed = now;
  key.requestCount = (key.requestCount || 0) + 1;
  if (!key._lastPersistAt || now - key._lastPersistAt >= 30_000 || key.requestCount % 20 === 0) {
    key._lastPersistAt = now;
    saveKeys();
  }
}

export function listClientApiKeys() {
  loadKeys();
  const keys = managedKeys.map(toPublicKey);
  const bootstrap = bootstrapKeyRecord();
  if (bootstrap) keys.unshift(bootstrap);
  return keys;
}

export function getClientApiKeySummary() {
  loadKeys();
  const bootstrapConfigured = !!config.apiKey;
  const managedTotal = managedKeys.length;
  const managedActive = managedKeys.filter(k => k.status === 'active').length;
  return {
    openAccess: !bootstrapConfigured && managedTotal === 0,
    bootstrapConfigured,
    managedTotal,
    managedActive,
    effectiveTotal: managedActive + (bootstrapConfigured ? 1 : 0),
  };
}

export function createClientApiKey(label = '', note = '') {
  loadKeys();
  const key = {
    id: randomUUID().slice(0, 8),
    label: (label || '').trim() || `key-${managedKeys.length + 1}`,
    note: (note || '').trim(),
    key: `wsapi_${randomBytes(24).toString('hex')}`,
    status: 'active',
    createdAt: Date.now(),
    lastUsed: 0,
    requestCount: 0,
    _lastPersistAt: 0,
  };
  managedKeys.push(key);
  saveKeys();
  log.info(`Managed client API key created: ${key.id} (${key.label})`);
  return toPublicKey(key);
}

export function updateClientApiKey(id, patch = {}) {
  loadKeys();
  const key = managedKeys.find(k => k.id === id);
  if (!key) return null;
  if (typeof patch.label === 'string') key.label = patch.label.trim() || key.label;
  if (typeof patch.note === 'string') key.note = patch.note.trim();
  if (typeof patch.status === 'string') {
    key.status = patch.status === 'disabled' ? 'disabled' : 'active';
  }
  saveKeys();
  log.info(`Managed client API key updated: ${key.id} (${key.label})`);
  return toPublicKey(key);
}

export function deleteClientApiKey(id) {
  loadKeys();
  const idx = managedKeys.findIndex(k => k.id === id);
  if (idx === -1) return false;
  const [removed] = managedKeys.splice(idx, 1);
  saveKeys();
  log.info(`Managed client API key deleted: ${removed.id} (${removed.label})`);
  return true;
}

export function validateClientApiKey(rawKey) {
  loadKeys();
  const key = (rawKey || '').trim();
  if (!config.apiKey && managedKeys.length === 0) {
    return { ok: true, source: 'open' };
  }
  if (config.apiKey && key === config.apiKey) {
    return { ok: true, source: 'bootstrap', id: 'bootstrap' };
  }
  const managed = managedKeys.find(item => item.status === 'active' && item.key === key);
  if (!managed) return { ok: false };
  maybePersistUsage(managed, Date.now());
  return { ok: true, source: 'managed', id: managed.id };
}
