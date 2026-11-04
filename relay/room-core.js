/* Transport-agnostic room logic for the annotate relay.
 *
 * Used by BOTH relay/server.js (local Node) and relay/cloudflare (Durable
 * Object), so the rules (who may write, how authors are stamped, how consent
 * is recorded) are identical wherever the relay runs. No I/O here: callers
 * pass state in and apply what comes back.
 *
 * `P` is the sync-protocol block from annotator.js (validateIdentity,
 * sanitizeNote, sanitizeReply, applySyncOp).
 */
'use strict';

const MUTATING = new Set(['note.add', 'note.update', 'note.resolve', 'note.delete', 'reply.add']);
const RATE_WINDOW_MS = 10000;
const RATE_MAX_OPS   = 30;
// Room caps. Nothing a real crowd reaches, but one page can't grow forever.
const MAX_NOTES   = 500;   // threads per room
const MAX_REPLIES = 200;   // replies per thread
const MAX_SOCKETS = 500;   // open connections per room
// Presence carries the real head count but only the first names: the list
// goes to everyone on every join and leave, so it must not grow with the room.
const PRESENCE_NAMES = 50;
const ROOM_FULL = { code: 'room_full', message: 'This page has reached its comment limit.' };

/* hello → who is commenting.
   Default (name-only): returns { user, userId } and NO person record; any
   email in the payload is dropped by validateIdentity and never stored.
   With opts.collectEmail: also returns the private person record (email +
   consent) and whether the newsletter subscription changed. */
function identify(P, prev, rawIdentity, now = new Date(), opts = {}) {
  const collectEmail = opts.collectEmail === true;
  const res = P.validateIdentity(rawIdentity, now, { requireEmail: collectEmail });
  if (!res.ok) return { error: { code: 'invalid_identity', message: Object.values(res.errors)[0] } };
  const id = res.identity, at = now.toISOString();
  if (!collectEmail) return { person: null, user: { userId: id.userId, name: id.name }, userId: id.userId, subscriptionChanged: false };
  const person = {
    name: id.name, email: id.email,
    newsletter: id.newsletter,
    // consentAt: when the viewer ticked the box. consentRecordedAt: when the
    // relay received it. Both kept for the audit trail.
    consentAt: id.newsletter ? id.consentAt : null,
    consentRecordedAt: id.newsletter ? ((prev && prev.newsletter && prev.consentRecordedAt) || at) : null,
    consentHistory: (prev && Array.isArray(prev.consentHistory)) ? prev.consentHistory.slice(-50) : [],
    identifiedAt: id.identifiedAt,
    firstSeenAt: (prev && prev.firstSeenAt) || at,
    lastSeenAt: at,
  };
  const changed = !prev || prev.newsletter !== id.newsletter || (id.newsletter && prev.email !== id.email);
  if (changed) person.consentHistory.push({ newsletter: id.newsletter, at, clientAt: id.consentAt || id.identifiedAt });
  // Forward to the sign-up list on every opt-in and on a withdrawal.
  const subscriptionChanged = changed && (id.newsletter || !!(prev && prev.newsletter));
  return { person, user: { userId: id.userId, name: id.name }, userId: id.userId, subscriptionChanged };
}

/* A mutating op from an identified viewer. Returns { op, notes } to apply and
   broadcast, { error } to send back, or {} to ignore silently. */
function applyClientOp(P, notes, user, m, now = new Date()) {
  if (!MUTATING.has(m && m.type)) return {};
  if (!user) return { error: { code: 'identity_required', message: 'Add your name and email before commenting.' } };
  const find = id => notes.find(n => n.id === id);
  const at = now.toISOString();
  let op;
  switch (m.type) {
    case 'note.add': {
      const note = P.sanitizeNote(m.note);
      if (!note || !note.comment.trim()) return {};
      const existing = find(note.id);
      if (existing && existing.authorId !== user.userId) return { error: { code: 'forbidden', message: 'That note belongs to someone else.' } };
      if (!existing && notes.length >= MAX_NOTES) return { error: ROOM_FULL };
      // The relay, not the client, decides who wrote it.
      note.author = user.name; note.authorId = user.userId; note.replies = [];
      op = { type: 'note.add', note };
      break;
    }
    case 'note.update': case 'note.delete': {
      const n = find(m.id);
      if (!n) return {};
      if (n.authorId !== user.userId) return { error: { code: 'forbidden', message: 'Only the author can change this note.' } };
      op = m.type === 'note.update'
        ? { type: 'note.update', id: m.id, comment: String(m.comment || ''), updatedAt: at }
        : { type: 'note.delete', id: m.id };
      break;
    }
    case 'note.resolve':
      if (!find(m.id)) return {};
      op = { type: 'note.resolve', id: m.id, resolved: m.resolved === true, by: user.name, at };
      break;
    case 'reply.add': {
      const reply = P.sanitizeReply(m.reply);
      if (!reply || !reply.comment.trim() || !find(m.noteId)) return {};
      if ((find(m.noteId).replies || []).length >= MAX_REPLIES) return { error: { code: 'room_full', message: 'This thread has reached its reply limit.' } };
      reply.author = user.name; reply.authorId = user.userId;
      op = { type: 'reply.add', noteId: m.noteId, reply };
      break;
    }
  }
  const next = P.applySyncOp(notes, op);
  if (next === notes) return {};
  return { op, notes: next };
}

/* Moderator removal of a thread or a single reply, whoever wrote it.
   Returns { op, notes } or { error }. Callers authenticate the moderator. */
function moderate(P, notes, { noteId, replyId } = {}) {
  const n = notes.find(x => x.id === noteId);
  if (!n) return { error: { code: 'not_found', message: 'No such note.' } };
  let op;
  if (replyId) {
    if (!(n.replies || []).some(r => r.id === replyId)) return { error: { code: 'not_found', message: 'No such reply.' } };
    op = { type: 'reply.delete', noteId, replyId };
  } else {
    op = { type: 'note.delete', id: noteId };
  }
  return { op, notes: P.applySyncOp(notes, op) };
}

/* Sliding-window limiter per connection. `bucket` is a plain array of
   timestamps the caller keeps per socket. */
function rateLimited(bucket, now = Date.now()) {
  while (bucket.length && now - bucket[0] > RATE_WINDOW_MS) bucket.shift();
  if (bucket.length >= RATE_MAX_OPS) return true;
  bucket.push(now);
  return false;
}

/* Seed notes: `minutesAgo` / `resolvedMinutesAgo` become real timestamps. */
function stampSeed(P, notes, now = Date.now()) {
  const stamp = o => {
    const c = { ...o };
    if (typeof c.minutesAgo === 'number') { c.createdAt = new Date(now - c.minutesAgo * 60000).toISOString(); delete c.minutesAgo; }
    if (typeof c.resolvedMinutesAgo === 'number') { c.resolvedAt = new Date(now - c.resolvedMinutesAgo * 60000).toISOString(); delete c.resolvedMinutesAgo; }
    return c;
  };
  return notes.map(n => P.sanitizeNote({ ...stamp(n), replies: (n.replies || []).map(stamp) })).filter(Boolean);
}

/* { type, count, viewers } from the full list of { name } entries. */
function presence(list, type = 'presence') {
  const all = Array.isArray(list) ? list : [];
  return { type, count: all.length, viewers: all.slice(0, PRESENCE_NAMES) };
}

function cleanRoom(r) {
  return typeof r === 'string' && r.trim() ? r.trim().slice(0, 200) : 'default';
}

module.exports = { MUTATING, MAX_NOTES, MAX_REPLIES, MAX_SOCKETS, PRESENCE_NAMES,
  identify, applyClientOp, moderate, rateLimited, stampSeed, cleanRoom, presence };
