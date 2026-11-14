import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

// Run the production component's handlers and effects with isolated native/UI ports.
// This checks lifecycle wiring, not browser layout or React DOM scheduling.
const source = await fs.readFile(new URL('../../apps/mobile/src/features/voice/VoiceInput.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('VoiceInput.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n').replace('export function VoiceInput', 'function VoiceInput');
const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment' } }).outputText;
const dependencies = ['useEffect', 'useRef', 'useState', 'createPortal', 'VoiceRecorder', 'voiceRecordingSupported', 'voiceApi', 'mergeVoiceDraft', 'voiceError', 'writeClipboard', 'voiceDraftHash', 'document', 'HTMLElement', 'h', 'Fragment', 'Mic', 'X', 'Square', 'Loader2', 'Copy', 'findMissingVoiceDetails', 'buildAsrHints', 'voiceContextEnabled', 'recordVoiceTranscript'];
const component = new Function(...dependencies, 'joinTranscripts', 'parseVoiceSegment', 'transcribeSegment', 'voiceSegmentMs', 'voiceSegmentedMaxMs', `${js}\nreturn VoiceInput;`);
// The real V5 piece helpers (their only import is a type).
const segmentsSource = await fs.readFile(new URL('../../apps/mobile/src/features/voice/segments.ts', import.meta.url), 'utf8');
const segmentsUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(segmentsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
export const segments = await import(segmentsUrl);

export function voiceInputDriver({ api, recovery, mergeVoiceDraft, voiceError, voiceDraftHash, findMissingVoiceDetails, buildAsrHints, voiceContextEnabled, segmented = false }) {
  const transcripts = [];
  let cursor = 0, tree, dirty = false, mounted = true;
  const named = new Map();
  const slots = [], effects = [], listeners = new Map(), calls = { start: 0, cancel: 0 };
  const drafts = [];
  const props = { endpoint: 'https://synthetic.invalid', token: 'synthetic', scope: 'connection-one', thread: 'codex:original-thread', draft: '原草稿', onDraft: value => drafts.push(value), recovery };
  const document = { body: {}, hidden: false, activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const native = {
    addListener: async (name, callback) => { named.set(name, callback); return { remove: async () => { if (named.get(name) === callback) named.delete(name); } }; },
    // A V5 recorder answers start with segmented: true; an older one resolves with nothing.
    start: async options => { calls.start++; calls.sessionId = options.sessionId; calls.startOptions = options; return segmented ? { segmented: true, maxMs: 600000 } : undefined; },
    stop: async () => {}, cancel: async () => { calls.cancel++; },
  };
  const useRef = value => { const index = cursor++; return slots[index] ??= { current: value }; };
  const useState = value => {
    const index = cursor++; slots[index] ??= { value };
    return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (slots[index].value !== value) dirty = true; slots[index].value = value; }];
  };
  const useEffect = (setup, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; });
  };
  const h = (type, props, ...children) => ({ type, props: { ...props, children } });
  const Component = component(useEffect, useRef, useState, child => child, native, () => true, () => api, mergeVoiceDraft, voiceError, async () => {}, voiceDraftHash, document, class {}, h, 'fragment', ...Array(5).fill('icon'), findMissingVoiceDetails, buildAsrHints, voiceContextEnabled, text => { transcripts.push(text); }, segments.joinTranscripts, segments.parseVoiceSegment, segments.transcribeSegment, segments.voiceSegmentMs, segments.voiceSegmentedMaxMs);
  function render(patch = {}) {
    assert.ok(mounted); Object.assign(props, patch);
    do { dirty = false; cursor = 0; tree = Component(props); for (const run of effects.splice(0)) run(); } while (dirty);
    return tree;
  }
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(item => nodes(item));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props.children)];
  }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props.children) : node ?? '';
  function button(label) { render(); return nodes(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label)); }
  render();
  return { transcripts,
    render, calls, drafts, document,
    button, click(label) { const target = button(label); assert.ok(target, `missing button: ${label}`); assert.ok(!target.props.disabled, `disabled button: ${label}`); target.props.onClick({}); render(); },
    recording(value = {}) { const listener = named.get('finished'); assert.ok(listener, 'recording listener must be installed'); listener({ sessionId: calls.sessionId, dataBase64: 'synthetic-audio', durationMs: 1000, ...value }); render(); },
    segment(value = {}) { const listener = named.get('segment'); assert.ok(listener, 'segment listener must be installed'); listener({ sessionId: calls.sessionId, index: 0, startMs: 0, durationMs: 30000, dataBase64: `synthetic-piece-${value.index ?? 0}-audio`, ...value }); render(); },
    listening: name => named.has(name),
    text: () => { render(); return text(tree); },
    session: () => slots.find(slot => slot?.current?.abort)?.current,
    original() { render(); return nodes(tree).find(node => node.props['aria-label'] === '语音识别原文')?.props.value; },
    warning() { render(); const warning = nodes(tree).find(node => node.props['aria-label'] === '整理稿关键信息警告'); return warning ? { text: text(warning), items: nodes(warning).filter(node => node.type === 'li').map(text) } : undefined; },
    edit(label, value) { render(); const field = nodes(tree).find(node => node.type === 'textarea' && node.props['aria-label'] === label); assert.ok(field && !field.props.disabled); field.props.onChange({ target: { value } }); render(); },
    hide() { document.hidden = true; listeners.get('visibilitychange')?.(); render(); },
    unmount() { if (!mounted) return; for (const slot of slots) slot?.cleanup?.(); mounted = false; },
  };
}
