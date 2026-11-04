/* One annotate room. Same rules as relay/server.js: both call room-core.js
   and the generated sync-protocol module. Uses the WebSocket Hibernation API,
   so idle viewers cost nothing. Storage: SQLite-backed KV
     note:<id>    { seq, note }
     person:<uid> private record (email, consent); ONLY when COLLECT_EMAIL=on
     outbox:<ts>  sign-up events waiting for SIGNUP_URL; ONLY when NEWSLETTER_SIGNUPS=on
   By default (both flags off) identities are name-only and nothing about a
   viewer is stored beyond the comments they write. */
import { DurableObject } from 'cloudflare:workers';
import * as P from './protocol.generated.js';
import core from '../../room-core.js';
import seed from '../../../examples/live-dashboard/seed.json';

export class AnnotateRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.notes = null;      // [{ seq, note }]
    this.buckets = new Map();
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('meta:room')) || null;
      this.seq = (await ctx.storage.get('meta:seq')) || 0;
      const rows = [...(await ctx.storage.list({ prefix: 'note:' })).values()];
      this.notes = rows.sort((a, b) => a.seq - b.seq);
    });
  }

  list() { return this.notes.map(r => r.note); }

  async ensureRoom(room) {
    if (this.room) return;
    this.room = room;
    await this.ctx.storage.put('meta:room', room);
    const seeded = seed.rooms && seed.rooms[room];
    if (seeded && this.notes.length === 0) {
      try { await this.replaceAll(core.stampSeed(P, seeded)); }
      catch (e) { console.error('seed failed', e && e.stack || e); }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = core.cleanRoom(url.searchParams.get('room'));
    // Admin calls arrive only from the Worker, after it checked ADMIN_TOKEN.
    if (url.pathname.startsWith('/admin/')) return this.admin(url.pathname.slice(7), room, request);
    await this.ensureRoom(room);
    if (this.ctx.getWebSockets().length >= core.MAX_SOCKETS) return new Response('Room is full', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ user: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async replaceAll(notes) {
    const keep = new Set(notes.map(n => n.id));
    const byId = new Map(this.notes.map(r => [r.note.id, r]));
    const writes = {};
    const next = notes.map(n => {
      const prev = byId.get(n.id);
      // applySyncOp returns the same object for every note it didn't touch,
      // so only the changed note is written (not the whole room per op).
      if (prev && prev.note === n) return prev;
      const row = { seq: prev ? prev.seq : ++this.seq, note: n };
      writes['note:' + n.id] = row;
      return row;
    });
    const gone = this.notes.filter(r => !keep.has(r.note.id)).map(r => 'note:' + r.note.id);
    writes['meta:seq'] = this.seq;
    await this.ctx.storage.put(writes);
    if (gone.length) await this.ctx.storage.delete(gone);
    this.notes = next.sort((a, b) => a.seq - b.seq);
  }

  // Open sockets only: a closing one must not count as a viewer (presence
  // is now sent a moment after the close).
  sockets(except) { return this.ctx.getWebSockets().filter(ws => ws !== except && ws.readyState === 1); }
  viewers(except) { return this.sockets(except).map(ws => ({ name: (ws.deserializeAttachment() || {}).user?.name || 'Guest' })); }
  // Joins and leaves arrive in bursts; send one presence update per 250ms
  // instead of one per event (that was ~3,400 messages for 50 joins).
  schedulePresence() {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => { this.presenceTimer = null; this.broadcast(core.presence(this.viewers())); }, 250);
  }
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) {} }
  broadcast(msg, except) { const s = JSON.stringify(msg); this.sockets(except).forEach(ws => { try { ws.send(s); } catch (e) {} }); }

  async webSocketMessage(ws, text) {
    if (typeof text !== 'string' || text.length > 256 * 1024) return;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const att = ws.deserializeAttachment() || { user: null };

    if (m.type === 'join') {
      const pres = core.presence(this.viewers());
      this.send(ws, { type: 'snapshot', room: this.room, notes: this.list(), viewers: pres.viewers, count: pres.count });
      this.schedulePresence();
      return;
    }

    if (m.type === 'hello') {
      const collectEmail = this.env.COLLECT_EMAIL === 'on';
      const v = P.validateIdentity(m.identity, new Date(), { requireEmail: collectEmail });
      if (!v.ok) { this.send(ws, { type: 'error', code: 'invalid_identity', message: Object.values(v.errors)[0] }); return; }
      const key = 'person:' + v.identity.userId;
      const prev = collectEmail ? (await this.ctx.storage.get(key)) || null : null;
      const res = core.identify(P, prev, m.identity, new Date(), { collectEmail });
      if (res.person) await this.ctx.storage.put(key, res.person);
      att.user = res.user;
      ws.serializeAttachment(att);
      this.send(ws, { type: 'welcome', userId: res.userId, name: res.user.name });
      this.schedulePresence();
      if (res.person && res.subscriptionChanged && this.env.NEWSLETTER_SIGNUPS === 'on') await this.forwardSignup(res);
      return;
    }

    if (!core.MUTATING.has(m.type)) return;
    let bucket = this.buckets.get(ws);
    if (!bucket) { bucket = []; this.buckets.set(ws, bucket); }
    if (core.rateLimited(bucket)) { this.send(ws, { type: 'error', code: 'rate_limited', message: 'Slow down a little, then try again.' }); return; }
    const res = core.applyClientOp(P, this.list(), att.user, m);
    if (res.error) { this.send(ws, { type: 'error', ...res.error }); return; }
    if (!res.op) return;
    await this.replaceAll(res.notes);
    this.broadcast({ type: 'op', op: res.op, actor: { userId: att.user.userId, name: att.user.name } });
  }

  /* ── moderation ────────────────────────────────────────────────────
     list                       every thread with ids, for picking what to remove
     delete {noteId, replyId?}  remove a thread or one reply, live for everyone
     reset                      wipe the room (notes, any person records, outbox);
                                the demo room re-seeds itself */
  async admin(action, room, request) {
    await this.ensureRoom(room);
    if (action === 'list') {
      return Response.json({ room: this.room, notes: this.list().map(n => ({ id: n.id, author: n.author, comment: n.comment,
        createdAt: n.createdAt, resolved: !!n.resolved, replies: (n.replies || []).map(r => ({ id: r.id, author: r.author, comment: r.comment })) })) });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (action === 'delete') {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const res = core.moderate(P, this.list(), body);
      if (res.error) return Response.json(res.error, { status: 404 });
      await this.replaceAll(res.notes);
      this.broadcast({ type: 'op', op: res.op, actor: { userId: 'moderator', name: 'A moderator' } });
      return Response.json({ ok: true, op: res.op });
    }
    if (action === 'reset') {
      const name = this.room;
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.notes = []; this.seq = 0; this.room = null;
      await this.ensureRoom(name);
      const pres = core.presence(this.viewers());
      this.sockets().forEach(ws => this.send(ws, { type: 'snapshot', room: this.room, notes: this.list(), viewers: pres.viewers, count: pres.count }));
      return Response.json({ ok: true, room: this.room, notes: this.notes.length });
    }
    return new Response('Not found', { status: 404 });
  }

  async webSocketClose(ws) {
    this.buckets.delete(ws);
    try { ws.close(); } catch (e) {}
    this.schedulePresence();
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  /* Newsletter opt-ins and withdrawals go to SIGNUP_URL, a sign-up endpoint you own.
     A failed delivery is parked in the outbox and retried by alarm. */
  async forwardSignup(res) {
    const p = res.person;
    const event = { userId: res.userId, name: p.name, email: p.email, newsletter: p.newsletter,
      consentAt: p.consentAt, consentRecordedAt: p.consentRecordedAt, room: this.room, source: 'annotate-live' };
    if (!(await this.deliver(event))) {
      await this.ctx.storage.put('outbox:' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), event);
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    }
  }
  async deliver(event) {
    if (!this.env.SIGNUP_URL || !this.env.SIGNUP_INGEST_TOKEN) return false;
    try {
      const r = await fetch(this.env.SIGNUP_URL, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.env.SIGNUP_INGEST_TOKEN },
        body: JSON.stringify(event) });
      return r.ok;
    } catch (e) { return false; }
  }
  async alarm() {
    const pending = await this.ctx.storage.list({ prefix: 'outbox:' });
    let left = 0;
    for (const [k, ev] of pending) {
      if (await this.deliver(ev)) await this.ctx.storage.delete(k); else left++;
    }
    if (left) await this.ctx.storage.setAlarm(Date.now() + 5 * 60000);
  }
}
