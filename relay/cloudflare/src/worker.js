/* annotate live relay on Cloudflare: one Durable Object per room.
 *   GET /sync?room=<name>  WebSocket, routed to that room's object (EU jurisdiction)
 *   GET /health
 *   anything else          static demo (dist/)
 */
import core from '../../room-core.js';
export { AnnotateRoom } from './room.js';

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) { console.error('relay error', e && e.stack || String(e)); return new Response('Relay error: ' + (e && e.message), { status: 500 }); }
  },
};

async function route(request, env) {
  {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    // Moderation: /admin/<list|delete|reset>?room=<name>, Bearer ADMIN_TOKEN.
    // No secret configured = the whole path is closed.
    if (url.pathname.startsWith('/admin/')) {
      if (!(await adminAuthorized(request, env))) return new Response('Not found', { status: 404 });
      const room = core.cleanRoom(url.searchParams.get('room'));
      const ns = env.EU_JURISDICTION === 'false' ? env.ROOMS : env.ROOMS.jurisdiction('eu');
      const fwd = new URL(request.url); fwd.searchParams.set('room', room);
      return ns.get(ns.idFromName(room)).fetch(new Request(fwd, request));
    }
    if (url.pathname === '/sync') {
      if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      // Browsers always send Origin. Only pages we serve, or listed origins,
      // may open a socket. Non-browser clients send none.
      const origin = request.headers.get('origin');
      const allowed = new Set([url.origin, ...String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
      if (origin && !allowed.has(origin)) return new Response('Forbidden', { status: 403 });
      const room = core.cleanRoom(url.searchParams.get('room'));
      const ns = env.EU_JURISDICTION === 'false' ? env.ROOMS : env.ROOMS.jurisdiction('eu');
      const stub = ns.get(ns.idFromName(room));
      const fwd = new URL(request.url); fwd.searchParams.set('room', room);
      try { return await stub.fetch(new Request(fwd, request)); }
      catch (e) { console.error('sync routing failed', e && e.stack || String(e)); return new Response('Relay error', { status: 500 }); }
    }
    return env.ASSETS.fetch(request);
  }
}

async function adminAuthorized(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected || expected.length < 32) return false;
  const h = request.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}
