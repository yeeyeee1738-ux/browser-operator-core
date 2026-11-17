// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/** One browser call. Keeps live nodes on window.__boActNodes and returns a numbered table. */
export const OBSERVE_EXPRESSION = `(() => {
  const MAX = 80;
  const nodes = [];
  const controls = [];
  const seen = new Set();
  function add(el) {
    if (!(el instanceof Element) || seen.has(el) || controls.length >= MAX) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return;
    const fillable = el.matches('textarea,input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),[contenteditable="true"]');
    const selectable = el.matches('select');
    const clickable = el.matches('a,button,summary,input[type=button],input[type=submit],input[type=checkbox],input[type=radio],[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"]');
    if (!fillable && !selectable && !clickable) return;
    seen.add(el);
    const id = String(controls.length + 1);
    nodes.push(el);
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.innerText || el.getAttribute('value') || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const value = 'value' in el ? String(el.value).slice(0, 80) : '';
    controls.push({
      id: id,
      role: (el.getAttribute('role') || el.tagName || '').toLowerCase(),
      name: name,
      value: value,
      kind: selectable ? 'select' : fillable ? 'fill' : 'click',
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
    });
  }
  function walk(root) {
    if (!root || controls.length >= MAX) return;
    const list = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of list) {
      add(el);
      if (el.shadowRoot) walk(el.shadowRoot);
      if (el.tagName === 'IFRAME') {
        try { if (el.contentDocument) walk(el.contentDocument); } catch (e) {}
      }
    }
  }
  walk(document);
  window.__boActNodes = nodes;
  const fingerprint = location.href + '|' + controls.map(control => control.role + ':' + control.name + ':' + control.value).join('|');
  return { fingerprint: fingerprint, url: location.href, title: document.title, controls: controls };
})()`;

export function actExpression(index: number, operation: string, text?: string): string {
  const payload = JSON.stringify({ index, operation, text: text ?? null });
  return `(() => {
    const request = ${payload};
    const el = window.__boActNodes && window.__boActNodes[request.index];
    if (request.operation === 'SCROLL_DOWN') { window.scrollBy(0, Math.round(window.innerHeight * 0.75)); return { ok: true }; }
    if (request.operation === 'SCROLL_UP') { window.scrollBy(0, -Math.round(window.innerHeight * 0.75)); return { ok: true }; }
    if (request.operation === 'WAIT') { return { ok: true }; }
    if (!el) return { ok: false, reason: 'missing' };
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const covered = hit && hit !== el && !el.contains(hit) && !hit.contains(el);
    if (covered && request.operation === 'CLICK') return { ok: false, reason: 'covered' };
    if (request.operation === 'TYPE_TEXT') {
      el.focus();
      if ('value' in el) el.value = request.text || '';
      else el.textContent = request.text || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (request.operation === 'SELECT') {
      if ('value' in el) el.value = request.text || el.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    el.click();
    return { ok: true };
  })()`;
}
