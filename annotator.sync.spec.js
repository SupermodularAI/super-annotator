/**
 * Multiplayer e2e: the live-dashboard example served by a real relay, driven
 * from two independent browser contexts (two viewers, separate storage).
 *
 * Run: npx playwright test annotator.sync.spec.js
 */
const { test, expect } = require('@playwright/test');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { createRelay } = require('./relay/server.js');

const EXAMPLE = path.join(__dirname, 'examples', 'live-dashboard');
// ANNOTATE_E2E_BASE=https://… runs the same tests against a deployed relay
// (Cloudflare). Server-internal assertions are skipped there, and every test
// except the seeded one uses its own throwaway room.
const REMOTE = process.env.ANNOTATE_E2E_BASE || '';
const RUN = Date.now().toString(36);
let relay, base;
// Unique per call site AND per run/repeat, so parallel or repeated runs never share a room.
const usedRooms = new Set();
const roomUrl = name => {
  const room = `e2e-${RUN}-${name}-${Math.random().toString(36).slice(2, 7)}`;
  usedRooms.add(room);
  return `${base}?room=${room}`;
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (REMOTE) { base = REMOTE.replace(/\/?$/, '/'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotate-e2e-'));
  relay = createRelay({ root: EXAMPLE, seed: path.join(EXAMPLE, 'seed.json'), data: path.join(dir, 'relay.json') });
  base = `http://127.0.0.1:${await relay.listen(0)}/`;
});
test.afterAll(async () => {
  if (relay) await relay.close();
  // On a deployed relay with an admin token, wipe every throwaway room we made.
  if (REMOTE && process.env.ANNOTATE_ADMIN_TOKEN) {
    for (const room of usedRooms) {
      await fetch(`${base}admin/reset?room=${encodeURIComponent(room)}`, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.ANNOTATE_ADMIN_TOKEN } });
    }
  }
});

async function openViewer(browser, url = base) {
  const ctx  = await browser.newContext({ viewport: { width: 1480, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('.annot-live-chip')).toHaveAttribute('data-status', 'live');
  return { ctx, page };
}
async function identify(page, { name }) {
  const gate = page.locator('.annot-gate');
  await expect(gate).toBeVisible();
  await gate.locator('input[name="name"]').fill(name);
  await gate.locator('.annot-gate-submit').click();
  await expect(gate).toHaveCount(0);
}
async function startAnnotating(page) {
  if (!(await page.evaluate(() => document.body.classList.contains('annot-mode')))) await page.keyboard.press('a');
}

test('desktop: the comment column can scroll clear of the toolbar, and all KPI cards match', async ({ browser }) => {
  const { ctx, page } = await openViewer(browser);
  await expect(page.locator('.annot-card').first()).toBeVisible();
  await expect(page.locator('.annot-fab-row')).toContainText('Annotate mode on');
  const looks = await page.evaluate(() => [...document.querySelectorAll('.kpis .card')].map(e => {
    const s = getComputedStyle(e); return [s.backgroundColor, s.borderRadius, s.borderTopColor, s.borderTopWidth].join(' ');
  }));
  expect(new Set(looks).size).toBe(1);
  expect(looks[0]).toBe('rgb(25, 25, 25) 24px rgb(45, 45, 45) 1px');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => {
    const fab = document.querySelector('.annot-fab-row').getBoundingClientRect();
    return [...document.querySelectorAll('.annot-card')].map(c => c.getBoundingClientRect())
      .filter(r => r.bottom > fab.top && r.top < fab.bottom && r.right > fab.left && r.left < fab.right).length;
  })).toBe(0);
  await ctx.close();
});

test('seeded threads render with author and time on first load', async ({ browser }) => {
  const { ctx, page } = await openViewer(browser);
  if (REMOTE) await expect(page.locator('.annot-card').nth(7)).toBeVisible();
  else await expect(page.locator('.annot-card')).toHaveCount(8);
  const mrr = page.locator('.annot-card', { hasText: 'annual prepay discount' });
  await expect(mrr.locator('.annot-card-author')).toHaveText('Clara Hoffmann');
  await expect(mrr.locator('.annot-card-time')).toHaveText(/ago$/);
  await expect(mrr.locator('.annot-card-reply-item')).toHaveCount(2);
  await expect(page.locator('.annot-card.resolved')).toHaveCount(1);
  await ctx.close();
});

test('commenting is blocked until a name is filled, and no email is asked for', async ({ browser }) => {
  const { ctx, page } = await openViewer(browser, REMOTE ? `${base}?room=halyard-revenue-dashboard` : base);
  await startAnnotating(page);
  await page.click('#kpi-nrr');
  const gate = page.locator('.annot-gate');
  await expect(gate).toBeVisible();
  await expect(page.locator('.annot-popup')).toHaveCount(0);        // composer did not open
  await expect(gate.locator('input[name="email"]')).toHaveCount(0);  // name only
  await expect(gate.locator('input[name="newsletter"]')).toHaveCount(0);

  await gate.locator('.annot-gate-submit').click();                  // empty
  await expect(gate.locator('.annot-gate-error').first()).toHaveText('Enter your name.');
  await expect(gate).toBeVisible();
  await gate.locator('input[name="name"]').fill('   ');               // whitespace only
  await gate.locator('.annot-gate-submit').click();
  await expect(gate.locator('.annot-gate-error').first()).toHaveText('Enter your name.');
  await expect(page.locator('.annot-popup')).toHaveCount(0);

  // A reply from the card input is gated too.
  await gate.locator('button', { hasText: 'Cancel' }).click();
  const card = page.locator('.annot-card', { hasText: 'Default this to Quarter' });
  await card.locator('.annot-card-input-row input').fill('Agreed');
  await card.locator('.annot-card-input-row input').press('Enter');
  await expect(gate).toBeVisible();
  await gate.locator('button', { hasText: 'Cancel' }).click();
  await expect(card.locator('.annot-card-reply-item')).toHaveCount(0);

  // Nothing was written to the relay.
  if (!REMOTE) expect(relay.data.rooms['halyard-revenue-dashboard'].notes).toHaveLength(8);
  await ctx.close();
});

test('a comment, reply and resolve in one viewer appear live in the other', async ({ browser }) => {
  const url = roomUrl('live');
  const A = await openViewer(browser, url);
  const B = await openViewer(browser, url);
  // Toasts are transient; record every one B shows so a slow network can't race the check.
  await B.page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.classList && n.classList.contains('annot-toast')) window.__toasts.push(n.textContent);
    }))).observe(document.body, { childList: true, subtree: true });
  });
  await expect(A.page.locator('.annot-live-chip')).toHaveText('Live · 2 here');

  // Viewer A identifies (name only) and comments.
  await startAnnotating(A.page);
  await A.page.click('#kpi-nrr');
  await identify(A.page, { name: 'Noor Haddad' });
  await expect(A.page.locator('.annot-popup textarea')).toBeVisible();
  await A.page.locator('.annot-popup textarea').fill('Show the NRR target next to the value.');
  await A.page.locator('.annot-popup .annot-btn-primary').click();

  // It appears in B without a reload, with A's name.
  const inB = B.page.locator('.annot-card', { hasText: 'Show the NRR target' });
  await expect(inB).toBeVisible();
  await expect(inB.locator('.annot-card-author')).toHaveText('Noor Haddad');
  await expect(inB.locator('.annot-card-time')).toHaveText('Just now');
  await expect.poll(() => B.page.evaluate(() => window.__toasts.join(' | '))).toContain('Noor Haddad commented');

  // B replies: gate first, then the reply lands in A.
  await inB.locator('.annot-card-input-row input').fill('Target is 115%. I will add it.');
  await inB.locator('.annot-card-input-row input').press('Enter');
  await identify(B.page, { name: 'Elias Brandt' });
  const inA = A.page.locator('.annot-card', { hasText: 'Show the NRR target' });
  await expect(inA.locator('.annot-card-reply-item')).toHaveCount(1);
  await expect(inA.locator('.annot-reply-author')).toHaveText('Elias Brandt');

  // B resolves; A sees it resolved.
  await inB.locator('.annot-card-btn.resolve').click();
  await expect(inA).toHaveClass(/resolved/);

  // B cannot edit or delete A's note; A can.
  await inB.locator('.annot-card-actions .annot-card-btn').last().click();
  await expect(B.page.locator('.annot-card-menu-item', { hasText: 'Delete' })).toHaveCount(0);

  // Nothing personal beyond the chosen name is kept: no email anywhere.
  const aStore = await A.page.evaluate(() => localStorage.getItem('sm-annotator:identity'));
  expect(JSON.parse(aStore)).not.toHaveProperty('email');
  if (!REMOTE) expect(relay.data.people).toEqual({});

  await A.ctx.close(); await B.ctx.close();
});

test('in an empty room, the first live note clears the tour so the gate is reachable', async ({ browser }) => {
  const url = roomUrl('fresh');
  const A = await openViewer(browser, url);
  const B = await openViewer(browser, url);
  await expect(B.page.locator('.annot-onboard-card, .annot-onboard-overlay').first()).toBeVisible();
  await startAnnotating(A.page);
  await A.page.click('#kpi-mrr');
  await identify(A.page, { name: 'Ines Duarte' });
  await A.page.locator('.annot-popup textarea').fill('First note in this room.');
  await A.page.locator('.annot-popup .annot-btn-primary').click();
  const card = B.page.locator('.annot-card', { hasText: 'First note in this room.' });
  await expect(card).toBeVisible();
  await expect(B.page.locator('.annot-onboard-card, .annot-onboard-overlay')).toHaveCount(0);
  await card.locator('.annot-card-input-row input').fill('Seen.');
  await card.locator('.annot-card-input-row input').press('Enter');
  await identify(B.page, { name: 'Rui Tavares' });
  await expect(A.page.locator('.annot-card', { hasText: 'First note' }).locator('.annot-reply-author')).toHaveText('Rui Tavares');
  await A.ctx.close(); await B.ctx.close();
});

test('identity is remembered: a returning viewer is not asked again', async ({ browser }) => {
  const { ctx, page } = await openViewer(browser, roomUrl('remember'));
  await startAnnotating(page);
  await page.click('#kpi-accounts');
  await identify(page, { name: 'Mara Quist' });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.annot-live-chip')).toHaveAttribute('data-status', 'live');
  await startAnnotating(page);
  await page.click('#kpi-churn');
  await expect(page.locator('.annot-gate')).toHaveCount(0);
  await expect(page.locator('.annot-popup textarea')).toBeVisible();
  await ctx.close();
});

test('without SM_ANNOTATE_SYNC the overlay stays single-player: no socket, no gate', async ({ page }) => {
  await page.addInitScript(() => {
    window.__wsOpened = 0;
    const Real = window.WebSocket;
    window.WebSocket = function (...a) { window.__wsOpened++; return new Real(...a); };
  });
  await page.route('http://single.local/', route => route.fulfill({
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><head><title>Plain</title></head><body><p id="p1">Hello</p></body></html>',
  }));
  await page.goto('http://single.local/');
  await page.evaluate(() => { localStorage.setItem('sm-annotator:reviewer', 'Solo'); });
  await page.addScriptTag({ path: path.join(__dirname, 'annotator.js') });
  await page.keyboard.press('a');
  await page.click('#p1');
  await expect(page.locator('.annot-gate')).toHaveCount(0);
  await expect(page.locator('.annot-popup textarea')).toBeVisible();
  await expect(page.locator('.annot-live-chip')).toHaveCount(0);
  expect(await page.evaluate(() => window.__wsOpened)).toBe(0);
});

// Moderation runs on the Cloudflare relay only (its /admin routes).
test('a moderator removes a bad reply and a bad thread, live for everyone', async ({ browser }) => {
  test.skip(!REMOTE || !process.env.ANNOTATE_ADMIN_TOKEN, 'needs ANNOTATE_E2E_BASE + ANNOTATE_ADMIN_TOKEN');
  const room = `e2e-${RUN}-mod`;
  const A = await openViewer(browser, `${base}?room=${room}`);
  await startAnnotating(A.page);
  await A.page.click('#kpi-churn');
  await identify(A.page, { name: 'Spam Bot' });
  await A.page.locator('.annot-popup textarea').fill('Buy cheap followers now');
  await A.page.locator('.annot-popup .annot-btn-primary').click();
  const bad = A.page.locator('.annot-card', { hasText: 'cheap followers' });
  await expect(bad).toBeVisible();
  await bad.locator('.annot-card-input-row input').fill('and more spam');
  await bad.locator('.annot-card-input-row input').press('Enter');
  await expect(bad.locator('.annot-card-reply-item')).toHaveCount(1);

  const auth = { Authorization: 'Bearer ' + process.env.ANNOTATE_ADMIN_TOKEN };
  expect((await (await fetch(`${base}admin/list?room=${room}`)).status)).toBe(404);   // no token, no admin
  const listed = await (await fetch(`${base}admin/list?room=${room}`, { headers: auth })).json();
  const thread = listed.notes.find(n => n.comment.includes('cheap followers'));
  const del = (body) => fetch(`${base}admin/delete?room=${room}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await del({ noteId: thread.id, replyId: thread.replies[0].id })).status).toBe(200);
  await expect(bad.locator('.annot-card-reply-item')).toHaveCount(0);
  expect((await del({ noteId: thread.id })).status).toBe(200);
  await expect(bad).toHaveCount(0);
  const reset = await fetch(`${base}admin/reset?room=${room}`, { method: 'POST', headers: auth });
  expect((await reset.json()).notes).toBe(0);
  await A.ctx.close();
});

test('on a phone, live comments arrive as pins only and open as a full-screen thread', async ({ browser }) => {
  const { defaultBrowserType, ...iphone } = require('@playwright/test').devices['iPhone 13'];
  const url = roomUrl('phone');
  const A = await openViewer(browser, url);                       // desktop author
  const pctx  = await browser.newContext({ ...iphone });
  const phone = await pctx.newPage();
  await phone.goto(url);
  await expect(phone.locator('.annot-live-chip')).toHaveAttribute('data-status', 'live');
  await expect(phone.locator('body')).toHaveClass(/annot-compact/);

  // A comments on desktop; the phone gets a pin, never an expanded card.
  await startAnnotating(A.page);
  await A.page.click('#kpi-mrr');
  await identify(A.page, { name: 'Marta Sousa' });
  await A.page.locator('.annot-popup textarea').fill('Is this MRR net of refunds?');
  await A.page.locator('.annot-popup .annot-btn-primary').click();
  await expect(phone.locator('.annot-badge')).toHaveCount(1);
  const card = phone.locator('.annot-card', { hasText: 'net of refunds' });
  await expect(card).toHaveCount(1);
  await expect(card).toBeHidden();
  await expect(phone.locator('.annot-onboard-card, .annot-onboard-overlay')).toHaveCount(0);

  // A second remote comment: still pins only.
  await A.page.click('#kpi-churn');
  await A.page.locator('.annot-popup textarea').fill('Churn looks low for Q3.');
  await A.page.locator('.annot-popup .annot-btn-primary').click();
  await expect(phone.locator('.annot-badge')).toHaveCount(2);
  for (const c of await phone.locator('.annot-card').all()) await expect(c).toBeHidden();
  // The toolbar fits with 16px gutters, and the demo page has no sideways scroll.
  const fb = await phone.locator('.annot-fab-row').boundingBox();
  expect(Math.round(fb.x)).toBe(16);
  expect(Math.round(fb.x + fb.width)).toBe(phone.viewportSize().width - 16);
  // The demo page itself fits the phone: no sideways scroll.
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.viewportSize().width);

  // Tap the pin: the thread opens full screen.
  await phone.locator('.annot-badge').first().tap();
  const modal = phone.locator('.annot-card.annot-sheet');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('net of refunds');
  const vp = phone.viewportSize();
  await expect.poll(() => phone.evaluate(() => {
    const r = document.querySelector('.annot-card.annot-sheet')?.getBoundingClientRect();
    return r ? [Math.round(r.width), Math.round(r.height)] : null;
  })).toEqual([vp.width - 16, vp.height - 16]);   // 8px inset

  // Reply from the modal: full-screen composer, then the name gate.
  await modal.locator('.annot-card-input-row input').tap();
  await phone.locator('.annot-fullsheet textarea').fill('Yes, refunds are netted out.');
  await phone.locator('.annot-fullsheet .annot-fs-save').tap();
  const gate = phone.locator('.annot-gate');
  await expect(gate).toBeVisible();
  await gate.locator('input[name="name"]').fill('Joana Reis');
  await gate.locator('.annot-gate-submit').tap();
  await expect(gate).toHaveCount(0);
  const inA = A.page.locator('.annot-card', { hasText: 'net of refunds' });
  await expect(inA.locator('.annot-reply-author')).toHaveText('Joana Reis');
  await expect(modal).toContainText('refunds are netted out');

  // While the modal is open, A's live reply updates it in place.
  await inA.locator('.annot-card-input-row input').fill('Thanks, makes sense.');
  await inA.locator('.annot-card-input-row input').press('Enter');
  await expect(modal).toContainText('Thanks, makes sense.');
  await expect(phone.locator('.annot-card.annot-sheet')).toHaveCount(1);

  // Resolve from the phone, seen on desktop.
  await modal.locator('.annot-card-btn.resolve').tap();
  await expect(inA).toHaveClass(/resolved/);

  // A deletes the thread: the open modal closes on the phone.
  await inA.hover();
  await inA.locator('.annot-card-actions .annot-card-btn').last().click();
  await A.page.locator('.annot-card-menu-item', { hasText: 'Delete' }).click();
  await A.page.locator('.annot-confirm-pop .annot-confirm-yes').click();
  await expect(inA).toHaveCount(0);
  await expect(phone.locator('.annot-card.annot-sheet')).toHaveCount(0);
  await expect(phone.locator('body')).not.toHaveClass(/annot-sheet-open/);
  await expect(phone.locator('.annot-badge')).toHaveCount(1);
  await A.ctx.close(); await pctx.close();
});
