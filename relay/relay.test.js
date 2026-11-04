/**
 * Relay integration tests: real server, real WebSocket clients (Node's
 * built-in WebSocket, Node 22+). Run: node --test relay/relay.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { createRelay, loadProtocol, injectAnnotator } = require('./server.js');
const core = require('./room-core.js');

const ROOM = 'test-room';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotate-relay-'));

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/sync`);
  const inbox = [];
  const waiters = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    waiters.slice().forEach(w => { if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
  };
  const opened = new Promise(r => { ws.onopen = r; });
  return {
    ws, inbox, opened,
    send: m => ws.send(JSON.stringify(m)),
    next(pred, ms = 2000) {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: m => { inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        waiters.push(w);
        setTimeout(() => reject(new Error('timed out waiting for message')), ms);
      });
    },
    close: () => ws.close(),
  };
}
const ident = (name, email, extra = {}) => ({ userId: 'u-' + name.toLowerCase().replace(/\W/g, ''), name, email, newsletter: false, ...extra });
const note = (id, comment) => ({ id, page: 'index.html', comment, selector: '#x', anchor: { selector: '#x', tagName: 'div', text: '' }, createdAt: new Date().toISOString(), replies: [] });

describe('relay (collectEmail mode)', () => {
  let relay, port, dataFile;
  before(async () => {
    dataFile = path.join(tmpDir, 'relay.json');
    relay = createRelay({ data: dataFile, collectEmail: true });
    port = await relay.listen(0);
  });
  after(async () => { await relay.close(); });

  it('sends a snapshot and presence on join', async () => {
    const a = client(port); await a.opened;
    a.send({ type: 'join', room: ROOM });
    const snap = await a.next(m => m.type === 'snapshot');
    assert.deepEqual(snap.notes, []);
    assert.equal(snap.viewers.length, 1);
    a.close();
  });

  it('rejects a comment before the viewer identifies (server-side gate)', async () => {
    const a = client(port); await a.opened;
    a.send({ type: 'join', room: ROOM });
    await a.next(m => m.type === 'snapshot');
    a.send({ type: 'note.add', note: note('n-anon', 'sneaky') });
    const err = await a.next(m => m.type === 'error');
    assert.equal(err.code, 'identity_required');
    assert.equal(relay.data.rooms[ROOM].notes.length, 0);
    a.close();
  });

  it('rejects an invalid email in hello', async () => {
    const a = client(port); await a.opened;
    a.send({ type: 'join', room: ROOM });
    a.send({ type: 'hello', identity: ident('Bad Email', 'not-an-email') });
    const err = await a.next(m => m.type === 'error');
    assert.equal(err.code, 'invalid_identity');
    a.close();
  });

  it('broadcasts a new comment live, with name and time but never the email', async () => {
    const a = client(port), b = client(port);
    await Promise.all([a.opened, b.opened]);
    a.send({ type: 'join', room: ROOM }); b.send({ type: 'join', room: ROOM });
    await a.next(m => m.type === 'snapshot'); await b.next(m => m.type === 'snapshot');
    a.send({ type: 'hello', identity: ident('Ana Costa', 'ana@example.com', { newsletter: true, consentAt: '2026-11-03T10:00:00.000Z' }) });
    await a.next(m => m.type === 'welcome');
    // The client claims a different author; the relay must overwrite it.
    a.send({ type: 'note.add', note: { ...note('n1', 'Tighten this headline'), author: 'Someone Else', email: 'leak@example.com' } });
    const got = await b.next(m => m.type === 'op' && m.op.type === 'note.add');
    assert.equal(got.op.note.author, 'Ana Costa');
    assert.equal(got.op.note.comment, 'Tighten this headline');
    assert.ok(got.op.note.createdAt);
    assert.equal(got.actor.name, 'Ana Costa');
    assert.ok(!JSON.stringify(got).includes('@example.com'), 'no email in the broadcast');
    assert.ok(!JSON.stringify(b.inbox).includes('ana@example.com'), 'no email anywhere in the other viewer inbox');
    a.close(); b.close();
  });

  it('stores email and newsletter consent with timestamps, privately', async () => {
    const p = relay.data.people['u-anacosta'];
    assert.equal(p.email, 'ana@example.com');
    assert.equal(p.newsletter, true);
    assert.equal(p.consentAt, '2026-11-03T10:00:00.000Z');
    assert.ok(p.consentRecordedAt);
    assert.equal(p.consentHistory.length, 1);
  });

  it('records no consent when the box was not ticked', async () => {
    const a = client(port); await a.opened;
    a.send({ type: 'join', room: ROOM });
    a.send({ type: 'hello', identity: ident('Bo Lind', 'bo@example.com', { newsletter: 'yes' }) });
    await a.next(m => m.type === 'welcome');
    const p = relay.data.people['u-bolind'];
    assert.equal(p.newsletter, false, 'only literal true counts as consent');
    assert.equal(p.consentAt, null);
    a.close();
  });

  it('broadcasts replies and resolves; only the author can delete', async () => {
    const a = client(port), b = client(port);
    await Promise.all([a.opened, b.opened]);
    a.send({ type: 'join', room: ROOM }); b.send({ type: 'join', room: ROOM });
    a.send({ type: 'hello', identity: ident('Ana Costa', 'ana@example.com') });
    b.send({ type: 'hello', identity: ident('Bo Lind', 'bo@example.com') });
    await a.next(m => m.type === 'welcome'); await b.next(m => m.type === 'welcome');

    b.send({ type: 'reply.add', noteId: 'n1', reply: { id: 'r1', comment: 'Agreed', createdAt: new Date().toISOString() } });
    const rep = await a.next(m => m.type === 'op' && m.op.type === 'reply.add');
    assert.equal(rep.op.reply.author, 'Bo Lind');

    b.send({ type: 'note.resolve', id: 'n1', resolved: true });
    const res = await a.next(m => m.type === 'op' && m.op.type === 'note.resolve');
    assert.equal(res.op.resolved, true);
    assert.equal(res.op.by, 'Bo Lind');

    b.send({ type: 'note.delete', id: 'n1' });
    const err = await b.next(m => m.type === 'error');
    assert.equal(err.code, 'forbidden');
    assert.equal(relay.data.rooms[ROOM].notes.length, 1);
    a.close(); b.close();
  });

  it('persists to the JSON file and reloads it on restart', async () => {
    await relay.close();
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(saved.rooms[ROOM].notes[0].replies.length, 1);
    relay = createRelay({ data: dataFile, collectEmail: true });
    port = await relay.listen(0);
    const a = client(port); await a.opened;
    a.send({ type: 'join', room: ROOM });
    const snap = await a.next(m => m.type === 'snapshot');
    assert.equal(snap.notes[0].id, 'n1');
    assert.equal(snap.notes[0].resolved, true);
    assert.ok(!JSON.stringify(snap).includes('@'), 'snapshot carries no emails');
    a.close();
  });
});

describe('relay (default: name only)', () => {
  let relay, port;
  before(async () => { relay = createRelay({ data: path.join(tmpDir, 'nameonly.json') }); port = await relay.listen(0); });
  after(async () => { await relay.close(); });

  it('accepts a name-only hello and stores no person record, even if an email is sent', async () => {
    const a = client(port), b = client(port);
    await Promise.all([a.opened, b.opened]);
    a.send({ type: 'join', room: 'r' }); b.send({ type: 'join', room: 'r' });
    a.send({ type: 'hello', identity: { userId: 'u-nameonly1', name: 'Kai Moreno', email: 'kai@example.com', newsletter: true } });
    await a.next(m => m.type === 'welcome');
    a.send({ type: 'note.add', note: note('n-k', 'Name only works') });
    const got = await b.next(m => m.type === 'op');
    assert.equal(got.op.note.author, 'Kai Moreno');
    assert.deepEqual(relay.data.people, {});
    assert.ok(!JSON.stringify(relay.data).includes('kai@example.com'));
    a.close(); b.close();
  });

  it('still requires a name', async () => {
    const a = client(port); await a.opened;
    a.send({ type: 'join', room: 'r' });
    a.send({ type: 'hello', identity: { userId: 'u-nameonly2', name: ' ' } });
    const err = await a.next(m => m.type === 'error');
    assert.equal(err.code, 'invalid_identity');
    a.close();
  });
});

describe('moderation (room-core)', () => {
  const P = loadProtocol();
  const notes = [{ id: 'n1', comment: 'ok', authorId: 'u1', replies: [{ id: 'r1', comment: 'spam', authorId: 'u2' }] }, { id: 'n2', comment: 'bad', authorId: 'u3', replies: [] }];
  it('removes any thread regardless of author', () => {
    const r = core.moderate(P, notes, { noteId: 'n2' });
    assert.equal(r.op.type, 'note.delete');
    assert.deepEqual(r.notes.map(n => n.id), ['n1']);
  });
  it('removes a single reply and keeps the thread', () => {
    const r = core.moderate(P, notes, { noteId: 'n1', replyId: 'r1' });
    assert.equal(r.op.type, 'reply.delete');
    assert.equal(r.notes[0].replies.length, 0);
  });
  it('reports unknown ids instead of guessing', () => {
    assert.equal(core.moderate(P, notes, { noteId: 'nope' }).error.code, 'not_found');
    assert.equal(core.moderate(P, notes, { noteId: 'n1', replyId: 'nope' }).error.code, 'not_found');
  });
});

describe('seeding', () => {
  it('seeds an empty room once, turning minutesAgo into real timestamps', async () => {
    const seed = path.join(tmpDir, 'seed.json');
    fs.writeFileSync(seed, JSON.stringify({ rooms: { demo: [{ ...note('s1', 'Seeded'), createdAt: undefined, minutesAgo: 30, replies: [{ id: 's1r', comment: 'Ok', author: 'Kai', minutesAgo: 5 }] }] } }));
    const file = path.join(tmpDir, 'seeded.json');
    const r1 = createRelay({ data: file, seed });
    const n = r1.data.rooms.demo.notes[0];
    const age = (Date.now() - Date.parse(n.createdAt)) / 60000;
    assert.ok(age > 29 && age < 31);
    assert.ok(n.replies[0].createdAt);
    r1.data.rooms.demo.notes = [];
    await r1.close();
    const r2 = createRelay({ data: file, seed });
    assert.equal(r2.data.rooms.demo.notes.length, 0, 'an existing room is never re-seeded');
    await r2.close();
  });
});

describe('shared protocol', () => {
  it('the relay loads the reducer from annotator.js (one source of truth)', () => {
    const P = loadProtocol();
    assert.equal(typeof P.applySyncOp, 'function');
    assert.equal(P.validateEmail('a@b.co'), true);
  });

  it('injects the current annotator between the standard markers', () => {
    const html = '<html><body><p>x</p><!-- annotate:v1 START -->old<!-- annotate:v1 END --></body></html>';
    const out = injectAnnotator(html);
    assert.ok(out.includes('sync-protocol:start'));
    assert.ok(!out.includes('old<!--'));
    assert.equal(out.match(/annotate:v1 START/g).length, 1);
  });
});

describe('room caps and presence', () => {
  const P = loadProtocol();
  const user = { userId: 'u-cap', name: 'Cap' };
  it('presence carries the full count but a capped list of names', () => {
    const list = Array.from({ length: 80 }, (_, i) => ({ name: 'P' + i }));
    const m = core.presence(list);
    assert.equal(m.type, 'presence');
    assert.equal(m.count, 80);
    assert.equal(m.viewers.length, core.PRESENCE_NAMES);
  });
  it('refuses a new thread once the room is full, but still allows edits', () => {
    const full = Array.from({ length: core.MAX_NOTES }, (_, i) => ({ ...note('n' + i, 'c'), author: 'Cap', authorId: 'u-cap' }));
    const res = core.applyClientOp(P, full, user, { type: 'note.add', note: note('extra', 'one more') });
    assert.equal(res.error && res.error.code, 'room_full');
    const ok = core.applyClientOp(P, full, user, { type: 'note.update', id: 'n0', comment: 'edited' });
    assert.ok(ok.op);
  });
});
