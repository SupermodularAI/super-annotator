/**
 * Unit tests for annotate pure utility functions.
 * Run: node --test annotator.test.js
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
const { generateAvatar, fmtRelTime, slug, buildMarkdown,
        validateEmail, validateIdentity, sanitizeNote, applySyncOp, createWebSocketAdapter, resolveSyncAdapter } = utils;

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

// ── multiplayer: identity gate validation ─────────────────────────────────────

describe('validateEmail', () => {
  it('accepts ordinary addresses', () => {
    ['ana@company.com', 'j.doe+review@sub.example.co.uk', 'ANA@Company.COM'].forEach(e => assert.equal(validateEmail(e), true, e));
  });
  it('rejects malformed addresses', () => {
    ['', 'ana', 'ana@', '@company.com', 'ana@company', 'ana @company.com', 'ana@company.c', 'a@b..com', 'a,b@c.com', null, 42]
      .forEach(e => assert.equal(validateEmail(e), false, String(e)));
  });
});

describe('validateIdentity (default: name only)', () => {
  const now = new Date('2026-11-03T09:30:00.000Z');
  it('requires a name', () => {
    const r = validateIdentity({ name: '  ' }, now);
    assert.equal(r.ok, false);
    assert.ok(r.errors.name);
    assert.equal(r.errors.email, undefined);
  });
  it('accepts a name alone and never keeps an email or consent', () => {
    const r = validateIdentity({ name: 'Ana Costa', email: 'ana@company.com', newsletter: true }, now);
    assert.equal(r.ok, true);
    assert.equal(r.identity.name, 'Ana Costa');
    assert.equal('email' in r.identity, false);
    assert.equal('newsletter' in r.identity, false);
    assert.equal('consentAt' in r.identity, false);
  });
  it('normalises whitespace and mints an opaque userId', () => {
    const r = validateIdentity({ name: '  Ana   Costa ' }, now);
    assert.equal(r.identity.name, 'Ana Costa');
    assert.match(r.identity.userId, /^u[a-z0-9]+$/);
  });
});

describe('validateIdentity ({ requireEmail: true }, collectEmail mode)', () => {
  const now = new Date('2026-11-03T09:30:00.000Z');
  const E = { requireEmail: true };
  it('requires both name and a valid email', () => {
    const r = validateIdentity({ name: '  ', email: 'nope' }, now, E);
    assert.equal(r.ok, false);
    assert.ok(r.errors.name);
    assert.ok(r.errors.email);
  });
  it('newsletter defaults to NOT subscribed, with no consent timestamp', () => {
    const r = validateIdentity({ name: 'Ana Costa', email: 'ana@company.com' }, now, E);
    assert.equal(r.ok, true);
    assert.equal(r.identity.newsletter, false);
    assert.equal(r.identity.consentAt, null);
  });
  it('only a literal true counts as consent', () => {
    ['yes', 1, 'true', 'on'].forEach(v => {
      assert.equal(validateIdentity({ name: 'A', email: 'a@b.co', newsletter: v }, now, E).identity.newsletter, false, String(v));
    });
  });
  it('records the consent timestamp when the box is ticked', () => {
    const r = validateIdentity({ name: 'Ana', email: 'ana@company.com', newsletter: true }, now, E);
    assert.equal(r.identity.newsletter, true);
    assert.equal(r.identity.consentAt, now.toISOString());
  });
  it('normalises email case', () => {
    const r = validateIdentity({ name: 'Ana', email: ' Ana@Company.COM ' }, now, E);
    assert.equal(r.identity.email, 'ana@company.com');
    assert.ok(!r.identity.userId.includes('ana'));
  });
});

// ── multiplayer: op reducer ───────────────────────────────────────────────────

describe('applySyncOp', () => {
  const base = [{ id: 'n1', comment: 'First', author: 'Ana', replies: [] }];
  it('adds a note, and adding it again is a no-op (echo-safe)', () => {
    const op = { type: 'note.add', note: { id: 'n2', comment: 'Second', author: 'Bo' } };
    const once = applySyncOp(base, op);
    assert.equal(once.length, 2);
    assert.equal(applySyncOp(once, op).length, 2);
  });
  it('never mutates its input', () => {
    const frozen = JSON.parse(JSON.stringify(base));
    applySyncOp(base, { type: 'note.update', id: 'n1', comment: 'Edited' });
    applySyncOp(base, { type: 'reply.add', noteId: 'n1', reply: { id: 'r1', comment: 'Hi' } });
    assert.deepEqual(base, frozen);
  });
  it('updates, resolves, reopens and deletes', () => {
    let s = applySyncOp(base, { type: 'note.update', id: 'n1', comment: 'Edited', updatedAt: 't' });
    assert.equal(s[0].comment, 'Edited');
    s = applySyncOp(s, { type: 'note.resolve', id: 'n1', resolved: true, by: 'Bo', at: 't2' });
    assert.equal(s[0].resolved, true);
    assert.equal(s[0].resolvedBy, 'Bo');
    s = applySyncOp(s, { type: 'note.resolve', id: 'n1', resolved: false });
    assert.equal(s[0].resolved, false);
    assert.equal(s[0].resolvedBy, null);
    assert.equal(applySyncOp(s, { type: 'note.delete', id: 'n1' }).length, 0);
  });
  it('removes a single reply with reply.delete', () => {
    const withReply = applySyncOp(base, { type: 'reply.add', noteId: 'n1', reply: { id: 'r1', comment: 'Spam' } });
    const s = applySyncOp(withReply, { type: 'reply.delete', noteId: 'n1', replyId: 'r1' });
    assert.equal(s[0].replies.length, 0);
    assert.equal(s[0].comment, 'First');
  });
  it('appends replies once, by id', () => {
    const op = { type: 'reply.add', noteId: 'n1', reply: { id: 'r1', author: 'Bo', comment: 'Agreed', createdAt: 't' } };
    const s = applySyncOp(applySyncOp(base, op), op);
    assert.equal(s[0].replies.length, 1);
    assert.equal(s[0].replies[0].author, 'Bo');
  });
  it('ignores empty edits, unknown ops and garbage', () => {
    assert.equal(applySyncOp(base, { type: 'note.update', id: 'n1', comment: '  ' })[0].comment, 'First');
    assert.equal(applySyncOp(base, { type: 'explode' }), base);
    assert.equal(applySyncOp(base, null), base);
    assert.deepEqual(applySyncOp(null, { type: 'note.delete', id: 'x' }), []);
  });
});

describe('sanitizeNote', () => {
  it('drops fields that are not on the allowlist, email included', () => {
    const n = sanitizeNote({ id: 'n1', comment: 'Hi', author: 'Ana', email: 'ana@x.com', password: 'p',
      replies: [{ id: 'r1', comment: 'Yo', author: 'Bo', email: 'bo@x.com' }] });
    assert.equal(n.email, undefined);
    assert.equal(n.password, undefined);
    assert.equal(n.replies[0].email, undefined);
    assert.ok(!JSON.stringify(n).includes('@'));
  });
  it('rejects notes without an id', () => {
    assert.equal(sanitizeNote({ comment: 'x' }), null);
  });
});

// ── multiplayer: adapters ─────────────────────────────────────────────────────

class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.instances.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
  _open() { this.readyState = 1; this.onopen && this.onopen(); }
  _recv(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
}

describe('resolveSyncAdapter', () => {
  it('returns null with no config: single-player stays offline', () => {
    assert.equal(resolveSyncAdapter(undefined, {}), null);
    assert.equal(resolveSyncAdapter(null, {}), null);
    assert.equal(resolveSyncAdapter({}, {}), null);
  });
  it('rejects non-websocket urls', () => {
    assert.equal(resolveSyncAdapter({ url: 'http://x/sync' }, {}), null);
    assert.equal(resolveSyncAdapter({ url: 'javascript:alert(1)' }, {}), null);
  });
  it('builds the websocket adapter from a ws url, with a default room', () => {
    const r = resolveSyncAdapter({ url: 'wss://localhost:4620/sync', WebSocket: FakeWS }, { defaultRoom: '/deck/index.html' });
    assert.equal(r.adapter.kind, 'websocket');
    assert.equal(r.room, '/deck/index.html');
  });
  it('accepts any custom adapter with connect + send', () => {
    const custom = { connect() {}, send() {} };
    const r = resolveSyncAdapter({ adapter: custom, room: 'r1' }, {});
    assert.equal(r.adapter, custom);
    assert.equal(r.room, 'r1');
    assert.equal(typeof custom.identify, 'function');
    assert.equal(typeof custom.close, 'function');
  });
});

describe('createWebSocketAdapter', () => {
  it('queues ops while connecting, then sends join, hello, queue in order', () => {
    FakeWS.instances = [];
    const statuses = [];
    const a = createWebSocketAdapter({ url: 'wss://x/sync', room: 'r1', WebSocket: FakeWS });
    a.connect({ onStatus: s => statuses.push(s), onMessage() {} });
    a.identify({ userId: 'u1', name: 'Ana' });
    a.send({ type: 'note.add', note: { id: 'n1' } });
    assert.equal(a._queueSize(), 1);
    const ws = FakeWS.instances[0];
    assert.deepEqual(ws.sent, []);
    ws._open();
    assert.deepEqual(ws.sent.map(m => m.type), ['join', 'hello', 'note.add']);
    assert.equal(ws.url, 'wss://x/sync?room=r1');
    assert.equal(ws.sent[0].room, 'r1');
    assert.deepEqual(statuses, ['connecting', 'live']);
    a.close();
  });
  it('delivers parsed messages and ignores junk', () => {
    FakeWS.instances = [];
    const got = [];
    const a = createWebSocketAdapter({ url: 'wss://x/sync', room: 'r', WebSocket: FakeWS });
    a.connect({ onMessage: m => got.push(m) });
    const ws = FakeWS.instances[0];
    ws._open();
    ws._recv({ type: 'snapshot', notes: [] });
    ws.onmessage({ data: 'not json' });
    assert.deepEqual(got, [{ type: 'snapshot', notes: [] }]);
    a.close();
  });
  it('reconnects after a drop and re-sends hello; close() stops retrying', async () => {
    FakeWS.instances = [];
    const statuses = [];
    const a = createWebSocketAdapter({ url: 'wss://x/sync', room: 'r', WebSocket: FakeWS, reconnectMs: 5 });
    a.connect({ onStatus: s => statuses.push(s) });
    a.identify({ userId: 'u1', name: 'Ana' });
    FakeWS.instances[0]._open();
    FakeWS.instances[0].close();           // network drop
    assert.equal(statuses.at(-1), 'offline');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(FakeWS.instances.length, 2);
    FakeWS.instances[1]._open();
    assert.deepEqual(FakeWS.instances[1].sent.map(m => m.type), ['join', 'hello']);
    a.close();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(FakeWS.instances.length, 2, 'no reconnect after close()');
  });
});
