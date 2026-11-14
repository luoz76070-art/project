import fs from 'node:fs/promises';
import ts from 'typescript';

// Exercise the production hook's handlers and cleanup with isolated React/DOM/timer ports.
// This does not claim browser gesture arbitration or native clipboard coverage.
const source = await fs.readFile(new URL('../../apps/mobile/src/features/chat/useMessageInteraction.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('useMessageInteraction.ts', source, ts.ScriptTarget.Latest, true);
const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n').replace('export function', 'function');
const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const factory = new Function('useEffect', 'useRef', 'useState', 'setTimeout', 'clearTimeout', 'Element', 'window', `${js}\nreturn useMessageInteraction;`);

export function messageInteractionDriver(onCopy) {
  let cursor = 0, state, serial = 0, selection = '';
  const slots = [], timers = new Map();
  const useRef = value => slots[cursor++] ??= { current: value };
  const useState = value => {
    const index = cursor++; slots[index] ??= { value };
    return [slots[index].value, next => { slots[index].value = next; }];
  };
  const useEffect = (setup, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; }
  };
  class Element {
    constructor(selector = '', parent = null) { this.selector = selector; this.parent = parent; }
    closest(selectors) { return selectors.split(',').some(selector => selector.trim() === this.selector) ? this : this.parent?.closest(selectors) ?? null; }
  }
  const hook = factory(useEffect, useRef, useState, fn => { timers.set(++serial, fn); return serial; }, id => timers.delete(id), Element, { getSelection: () => selection });
  function render() { cursor = 0; state = hook('message-one', onCopy); return state; }
  render();
  return {
    render,
    event(name, patch = {}) { const event = { target: new Element(), currentTarget: { contains: target => target === 'inside' }, pointerType: 'touch', isPrimary: true, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; }, ...patch }; state.handlers[name](event); render(); return event; },
    interactive: () => new Element('button'),
    element: (selector, parent) => new Element(selector, parent),
    select: text => { selection = text; },
    hold() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } render(); },
    pending: () => timers.size,
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
