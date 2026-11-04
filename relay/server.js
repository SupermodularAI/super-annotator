#!/usr/bin/env node
/* annotate relay: a local, zero-dependency WebSocket relay for multiplayer
 * annotate. In-memory state, persisted to one JSON file.
 *
 *   node relay/server.js [--port 4620] [--data .relay-data/relay.json]
 *                        [--root <static dir>] [--seed <seed.json>]
 *                        [--fonts <brand fonts dir>]
 *
 * - WebSocket endpoint: ws://localhost:<port>/sync
 * - Static files from --root. HTML responses get the CURRENT annotator.js
 *   inlined between the standard `<!-- annotate:v1 START/END -->` markers,
 *   the same idempotent injection the skill does, so the demo never serves
 *   a stale copy of the overlay.
 * - The reducer and identity validator are NOT reimplemented here: they are
 *   loaded from the `sync-protocol` block of annotator.js, so the relay and
 *   every client apply ops with the same code.
 *
 * Privacy: by default identities are name-only and nothing about a viewer is
 * stored beyond the comments they write. With --collect-email, email and
 * newsletter consent are stored under `people` and never sent to any client.
 * Notes carry the author's name and an opaque authorId only.
 *
 * This is a prototype transport for local use. It has no auth beyond the
 * identity gate and no rate limiting; see SKILL.md for what a hosted
 * transport needs.
 */
'use strict';

const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const core   = require('./room-core.js');

const ANNOTATOR_PATH = path.join(__dirname, '..', 'annotator.js');
const WS_GUID  = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 256 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
};

/* ── shared protocol, loaded from annotator.js ─────────────────────────── */
function loadProtocol(file = ANNOTATOR_PATH) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('/* sync-protocol:start */');
  const b = src.indexOf('/* sync-protocol:end */');
  if (a === -1 || b === -1 || b < a) throw new Error('sync-protocol block not found in ' + file);
  const block = src.slice(a, b);
  // The block is function declarations only (no DOM, no globals).
  // eslint-disable-next-line no-new-func
  return new Function(block + '\nreturn { validateEmail, validateIdentity, sanitizeNote, sanitizeReply, applySyncOp };')();
}

/* ── minimal RFC 6455 server side ──────────────────────────────────────── */
function wsAccept(key) { return crypto.createHash('sha1').update(key + WS_GUID).digest('base64'); }
function wsFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function wrapSocket(sock, onText, onClose) {
  let buf = Buffer.alloc(0), frags = [], done = false;
  const conn = {
    send(obj) { if (!done) { try { sock.write(wsFrame(0x1, Buffer.from(JSON.stringify(obj)))); } catch (e) {} } },
    close(code = 1000) {
      if (done) return;
      const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
      try { sock.write(wsFrame(0x8, p)); sock.end(); } catch (e) {}
      finish();
    },
  };
  function finish() { if (done) return; done = true; onClose(conn); }
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME) { conn.close(1009); return; }
      if (!masked) { conn.close(1002); return; }           // clients MUST mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) { conn.close(); return; }
      if (op === 0x9) { try { sock.write(wsFrame(0xA, payload)); } catch (e) {} continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        frags.push(payload);
        if (frags.reduce((n, f) => n + f.length, 0) > MAX_FRAME) { conn.close(1009); return; }
        if (fin) { const text = Buffer.concat(frags).toString('utf8'); frags = []; onText(conn, text); }
      }
    }
  });
  sock.on('end', () => { try { sock.end(); } catch (e) {} finish(); });   // peer half-closed
  sock.on('close', finish);
  sock.on('error', finish);
  return conn;
}

/* ── persistence ───────────────────────────────────────────────────────── */
function loadData(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { rooms: d.rooms || {}, people: d.people || {} };
  } catch (e) { return { rooms: {}, people: {} }; }
}
function makeSaver(file, data) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer); timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  return { schedule() { if (!timer) timer = setTimeout(flush, 150); }, flush };
}

/* Seed format: { "rooms": { "<room>": [ note, ... ] } } where each note (and
   reply) may give `minutesAgo` instead of createdAt, so seeded threads read as
   recent whenever the demo is started. A room is seeded once, on first run. */
function seedRooms(data, seedFile, P, now = Date.now()) {
  if (!seedFile) return false;
  const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  let changed = false;
  Object.entries(seed.rooms || {}).forEach(([room, notes]) => {
    if (data.rooms[room]) return;
    data.rooms[room] = { notes: core.stampSeed(P, notes, now), seededAt: new Date(now).toISOString() };
    changed = true;
  });
  return changed;
}

/* ── static files ──────────────────────────────────────────────────────── */
function injectAnnotator(html) {
  const js = fs.readFileSync(ANNOTATOR_PATH, 'utf8').replace(/<\/script/gi, '<\\/script');
  const block = `<!-- annotate:v1 START -->\n<script>\n${js}\n</script>\n<!-- annotate:v1 END -->`;
  if (/<!-- annotate:v1 START -->[\s\S]*?<!-- annotate:v1 END -->/.test(html)) {
    return html.replace(/<!-- annotate:v1 START -->[\s\S]*?<!-- annotate:v1 END -->/, () => block);
  }
  return html.replace(/<\/body>/i, () => block + '\n</body>');
}
function serveFile(res, base, rel, transform) {
  const full = path.resolve(base, '.' + path.sep + rel);
  if (!full.startsWith(path.resolve(base) + path.sep) && full !== path.resolve(base)) { res.writeHead(403); res.end(); return; }
  fs.stat(full, (err, st) => {
    let file = full;
    if (!err && st.isDirectory()) file = path.join(full, 'index.html');
    fs.readFile(file, (e2, buf) => {
      if (e2) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const body = transform && type.startsWith('text/html') ? transform(buf.toString('utf8')) : buf;
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    });
  });
}

/* ── relay ─────────────────────────────────────────────────────────────── */
function createRelay(opts = {}) {
  const P = loadProtocol(opts.annotatorPath);
  const dataFile = path.resolve(opts.data || path.join(process.cwd(), '.relay-data', 'relay.json'));
  const data  = loadData(dataFile);
  const saver = makeSaver(dataFile, data);
  if (seedRooms(data, opts.seed, P)) saver.flush();
  const rooms = new Map();   // room → Set(conn)

  const roomState = r => (data.rooms[r] = data.rooms[r] || { notes: [] });
  const viewersOf = r => [...(rooms.get(r) || [])].map(c => ({ name: c.user ? c.user.name : 'Guest' }));
  const broadcast = (r, msg) => (rooms.get(r) || new Set()).forEach(c => c.send(msg));
  // One presence update per 250ms per room, same as the Durable Object.
  const presenceTimers = new Map();
  const presence  = r => {
    if (presenceTimers.has(r)) return;
    presenceTimers.set(r, setTimeout(() => { presenceTimers.delete(r); broadcast(r, core.presence(viewersOf(r))); }, 250));
  };
  const fail = (conn, code, message) => conn.send({ type: 'error', code, message });

  function onText(conn, text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.type === 'join') {
      const room = core.cleanRoom(m.room);
      if (conn.room) rooms.get(conn.room)?.delete(conn);
      conn.room = room;
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(conn);
      const pres = core.presence(viewersOf(room));
      conn.send({ type: 'snapshot', room, notes: roomState(room).notes, viewers: pres.viewers, count: pres.count });
      presence(room);
      return;
    }

    if (m.type === 'hello') {
      const v = P.validateIdentity(m.identity, new Date(), { requireEmail: !!opts.collectEmail });
      if (!v.ok) { fail(conn, 'invalid_identity', Object.values(v.errors)[0]); return; }
      const res = core.identify(P, data.people[v.identity.userId] || null, m.identity, new Date(), { collectEmail: !!opts.collectEmail });
      if (res.person) {
        // collectEmail mode only: email + consent, kept privately.
        data.people[res.userId] = res.person;
        saver.schedule();
        if (res.subscriptionChanged && opts.onSubscription) {
          try { opts.onSubscription({ userId: res.userId, ...res.person, room: conn.room || null }); } catch (e) {}
        }
      }
      conn.user = res.user;
      conn.send({ type: 'welcome', userId: res.userId, name: res.user.name });
      if (conn.room) presence(conn.room);
      return;
    }

    if (!core.MUTATING.has(m.type)) return;
    if (!conn.room) { fail(conn, 'join_required', 'Not connected to a page yet.'); return; }
    conn.bucket = conn.bucket || [];
    if (core.rateLimited(conn.bucket)) { fail(conn, 'rate_limited', 'Slow down a little, then try again.'); return; }
    const state = roomState(conn.room);
    const res = core.applyClientOp(P, state.notes, conn.user, m);
    if (res.error) { fail(conn, res.error.code, res.error.message); return; }
    if (!res.op) return;
    state.notes = res.notes;
    saver.schedule();
    broadcast(conn.room, { type: 'op', op: res.op, actor: { userId: conn.user.userId, name: conn.user.name } });
  }

  function onClose(conn) {
    if (conn.room && rooms.has(conn.room)) {
      rooms.get(conn.room).delete(conn);
      presence(conn.room);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    if (rel === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: Object.keys(data.rooms).length })); return; }
    if (rel === '/annotator.js') { serveFile(res, path.dirname(ANNOTATOR_PATH), 'annotator.js'); return; }
    if (opts.fonts && rel.startsWith('/fonts/')) { serveFile(res, opts.fonts, rel.slice('/fonts/'.length)); return; }
    if (opts.root) { serveFile(res, opts.root, rel.replace(/^\/+/, ''), injectAnnotator); return; }
    res.writeHead(404); res.end();
  });

  server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/sync' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) { sock.destroy(); return; }
    sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + wsAccept(key), '', ''].join('\r\n'));
    sock.setNoDelay(true);
    wrapSocket(sock, onText, onClose);
  });

  return {
    server, data, dataFile,
    listen(port = 4620, host = '127.0.0.1') {
      return new Promise(resolve => server.listen(port, host, () => resolve(server.address().port)));
    },
    close() {
      presenceTimers.forEach(t => clearTimeout(t)); presenceTimers.clear();
      saver.flush();
      return new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });
    },
  };
}

module.exports = { createRelay, loadProtocol, injectAnnotator, seedRooms };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, def) => { const i = args.indexOf('--' + name); return i !== -1 && args[i + 1] ? args[i + 1] : def; };
  const fontsDir = arg('fonts');
  const relay = createRelay({
    data: arg('data'), root: arg('root') && path.resolve(arg('root')), seed: arg('seed') && path.resolve(arg('seed')),
    fonts: fontsDir && fs.existsSync(fontsDir) ? path.resolve(fontsDir) : null,
    collectEmail: args.includes('--collect-email'),
  });
  relay.listen(Number(arg('port', process.env.PORT || 4620))).then(port => {
    console.log(`annotate relay on http://localhost:${port}  (ws://localhost:${port}/sync)`);
    console.log(`data: ${relay.dataFile}`);
    if (fontsDir && !fs.existsSync(fontsDir)) console.log(`brand fonts not found at ${fontsDir}, using system fonts`);
  });
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
