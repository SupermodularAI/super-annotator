/**
 * Unit tests for annotate pure utility functions.
 * Run: node --test .claude/skills/annotate/annotator.test.js
 *
 * No install required — uses Node.js built-in test runner (Node 18+).
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Minimal DOM shims so the IIFE doesn't crash in Node.
globalThis.window   = globalThis;
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), className: '', style: {}, dataset: {},
    textContent: '', innerHTML: '', id: '', type: '', value: '', placeholder: '',
    title: '', href: '', download: '', src: '', alt: '',
    offsetWidth: 0, offsetHeight: 0, scrollHeight: 10, clientHeight: 10,
    children: [], childNodes: [],
    parentNode: null,
    appendChild: function(c) { if (c) { c.parentNode = this; this.children.push(c); this.childNodes.push(c); } return c; },
    append:      function(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? makeEl('span') : c)); },
    prepend:     function(...cs) { cs.forEach(c => this.appendChild(c)); },
    remove:      function() {},
    insertBefore: function(c) { return this.appendChild(c); },
    removeChild: function() {},
    contains:    function() { return false; },
    closest:     function() { return null; },
    querySelector:    function() { return null; },
    querySelectorAll: function() { return []; },
    setAttribute: function(k, v) { this[k] = v; },
    getAttribute: function(k) { return this[k] || null; },
    removeAttribute: function() {},
    getBoundingClientRect: function() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
    scrollIntoView: function() {},
    click: function() {},
    focus: function() {},
    select: function() {},
    classList: {
      _list: new Set(),
      add:      function(...cs) { cs.forEach(c => this._list.add(c)); },
      remove:   function(...cs) { cs.forEach(c => this._list.delete(c)); },
      toggle:   function(c, f) { f === undefined ? (this._list.has(c) ? this._list.delete(c) : this._list.add(c)) : (f ? this._list.add(c) : this._list.delete(c)); },
      contains: function(c) { return this._list.has(c); },
    },
    addEventListener:    function() {},
    removeEventListener: function() {},
    onkeydown: null, onclick: null, oninput: null, onchange: null, onmousedown: null,
  };
  return el;
}
const _body = makeEl('body');
_body.style.backgroundColor = 'rgb(255,255,255)';
globalThis.document = {
  title: 'supermodular.ai — Test Artefact',
  head:  makeEl('head'),
  body:  _body,
  documentElement: makeEl('html'),
  getElementById:    () => null,
  querySelector:     () => null,
  querySelectorAll:  () => { const arr = []; arr.forEach = Array.prototype.forEach; return arr; },
  createElement:     (tag) => makeEl(tag),
  addEventListener:  () => {},
  removeEventListener: () => {},
};
globalThis.location    = { pathname: '/test/my-doc_v2.html' };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'Node', userAgentData: null }, configurable: true, writable: true });
globalThis.URL          = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
globalThis.window.getComputedStyle = () => ({ backgroundColor: 'rgb(255,255,255)' });
globalThis.window.scrollY = 0;
globalThis.window.scrollX = 0;
globalThis.window.innerWidth  = 1280;
globalThis.window.innerHeight = 800;
globalThis.window.addEventListener    = () => {};
globalThis.window.removeEventListener = () => {};
globalThis.Blob         = class Blob {};
globalThis.requestAnimationFrame = () => {};
globalThis.setTimeout = globalThis.setTimeout || (() => {});
globalThis.clearTimeout = globalThis.clearTimeout || (() => {});
globalThis.window.SM_ARTEFACT_KEY  = undefined;
globalThis.window.SM_ARTEFACT_NAME = undefined;
globalThis.window.SM_REVIEWER_NAME = undefined;
globalThis.window.__smBaked        = undefined;
globalThis.CSS = { escape: (s) => s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`) };

const utils = require('./annotator.js');
const { generateAvatar, fmtRelTime, slug, buildMarkdown } = utils;

// ── generateAvatar ────────────────────────────────────────────────────────────

describe('generateAvatar', () => {
  it('returns a data URI', () => {
    const uri = generateAvatar('Diogo Bastos');
    assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  });

  it('is deterministic for the same name', () => {
    assert.equal(generateAvatar('João Romão'), generateAvatar('João Romão'));
  });

  it('produces different avatars for different names', () => {
    assert.notEqual(generateAvatar('Alice'), generateAvatar('Bob'));
  });

  it('produces a valid SVG', () => {
    const uri  = generateAvatar('Test User');
    const svg  = decodeURIComponent(uri.replace('data:image/svg+xml;charset=utf-8,', ''));
    assert.match(svg, /<svg /);
    assert.match(svg, /<\/svg>/);
    assert.match(svg, /viewBox="0 0 36 36"/);
  });

  it('handles empty string without throwing', () => {
    assert.doesNotThrow(() => generateAvatar(''));
  });
});

// ── fmtRelTime ────────────────────────────────────────────────────────────────

describe('fmtRelTime', () => {
  it('returns "Just now" for timestamps within 60 seconds', () => {
    const iso = new Date(Date.now() - 10_000).toISOString();
    assert.equal(fmtRelTime(iso), 'Just now');
  });

  it('returns minutes ago', () => {
    const iso = new Date(Date.now() - 3 * 60_000).toISOString();
    assert.equal(fmtRelTime(iso), '3m ago');
  });

  it('returns hours ago', () => {
    const iso = new Date(Date.now() - 2 * 3600_000).toISOString();
    assert.equal(fmtRelTime(iso), '2h ago');
  });

  it('returns days ago', () => {
    const iso = new Date(Date.now() - 3 * 86400_000).toISOString();
    assert.equal(fmtRelTime(iso), '3d ago');
  });

  it('returns formatted date for older timestamps', () => {
    const iso = new Date(Date.now() - 14 * 86400_000).toISOString();
    const result = fmtRelTime(iso);
    assert.match(result, /\d+ \w+/); // e.g. "15 May"
  });

  it('returns empty string for falsy input', () => {
    assert.equal(fmtRelTime(null), '');
    assert.equal(fmtRelTime(''),   '');
  });

  it('returns empty string for invalid ISO string', () => {
    assert.equal(fmtRelTime('not-a-date'), '');
  });
});

// ── slug ──────────────────────────────────────────────────────────────────────

describe('slug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    assert.equal(slug('Hello World'), 'hello-world');
  });

  it('strips special characters', () => {
    assert.equal(slug('AI-Native Audit!'), 'ai-native-audit');
  });

  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(50);
    assert.equal(slug(long).length, 40);
  });

  it('handles empty/null input', () => {
    assert.equal(slug(''),   'artefact');
    assert.equal(slug(null), 'artefact');
  });
});

// ── buildMarkdown ─────────────────────────────────────────────────────────────

describe('buildMarkdown', () => {
  // buildMarkdown reads from allAnnotations() which is a closure — we exercise
  // it indirectly via the module's internal state by calling it right after
  // require, when annotations are empty.

  it('returns a string', () => {
    const md = buildMarkdown();
    assert.equal(typeof md, 'string');
  });

  it('starts with the artefact name heading', () => {
    const md = buildMarkdown();
    assert.match(md, /^# /m);
  });

  it('includes version suffix for _v2 in PAGE', () => {
    // location.pathname was set to /test/my-doc_v2.html above
    const md = buildMarkdown();
    assert.match(md, / v2$/m);
  });
});
