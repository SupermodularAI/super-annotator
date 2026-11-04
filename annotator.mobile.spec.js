/**
 * Mobile (touch) integration tests for the annotate overlay.
 *
 * Run: npx playwright test 
 *
 * Emulates an iPhone 13 (390x664, hasTouch, isMobile) in Chromium and drives
 * the overlay with tap(), not click(), so touch-only paths are exercised:
 * ghost clicks, hover-only affordances, bottom sheets, clipboard fallbacks.
 */

const { test, expect, devices } = require('@playwright/test');
const path = require('node:path');

const JS_PATH = path.join(__dirname, 'annotator.js');
const ORIGIN  = 'http://annotator-test.local';
const FIXTURE = `${ORIGIN}/mobile.html`;

// Device descriptor minus defaultBrowserType: stay on the configured Chromium.
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
test.use({ ...iphone });

// Host CSS that out-ranks a single class selector — real sites ship this.
const HOSTILE_CSS = 'button:not(:disabled){position:relative;margin:6px}';

async function load(page, body = '', { css = '', withName = true, onboarding = false, init } = {}) {
  await page.route(FIXTURE, route => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mobile Artefact</title><style>body{margin:0;font-family:Georgia,serif}main{padding:16px}${css}</style></head>
<body><main>${body}</main></body></html>`,
  }));
  if (init) await page.addInitScript(init);
  await page.goto(FIXTURE);
  await page.evaluate(({ withName, onboarding }) => {
    if (withName) { localStorage.setItem('sm-annotator:reviewer', 'Phone Reviewer'); window.SM_REVIEWER_NAME = 'Phone Reviewer'; }
    if (!onboarding) localStorage.setItem('sm-annotator:hint-dismissed', '1');
  }, { withName, onboarding });
  await page.addScriptTag({ path: JS_PATH });
}

async function inViewport(page, selector) {
  const b = await page.locator(selector).boundingBox();
  const vp = page.viewportSize();
  return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
}

async function annotateByTap(page, selector, text) {
  if (!(await page.locator('body').evaluate(b => b.classList.contains('annot-mode')))) {
    await page.locator('.annot-collapser').tap();
  }
  await page.locator(selector).tap();
  await page.locator('.annot-popup textarea').fill(text);
  await page.locator('.annot-popup .annot-fs-save').tap();
}

test('bubble stays fixed and on-screen when host CSS repositions buttons', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>', { css: HOSTILE_CSS });
  const pos = await page.locator('.annot-collapser').evaluate(el => getComputedStyle(el).position);
  expect(pos).toBe('fixed');
  expect(await inViewport(page, '.annot-collapser')).toBe(true);
});

test('tapping the bubble enters annotate mode (no ghost click on the banner ✕)', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>');
  await page.locator('.annot-collapser').tap();
  await expect(page.locator('body')).toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-fab-row')).toBeVisible();
  await expect(page.locator('.annot-fab-row')).toContainText('Tap to annotate');
  // Banner controls are finger-sized.
  const b = await page.locator('.annot-share-btn').boundingBox();
  expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
});

test('onboarding fits the phone, speaks "tap", and is dismissable', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>', { onboarding: true });
  await expect(page.locator('.annot-onboard-card')).toBeVisible();
  expect(await inViewport(page, '.annot-onboard-card')).toBe(true);
  await expect(page.locator('.annot-onboard-cap-body')).toContainText('Tap the lemon bubble');
  await expect(page.locator('.annot-onboard-tag')).toContainText('Tap here');
  await page.locator('.annot-onboard-x').tap();
  await expect(page.locator('.annot-onboard-card')).toHaveCount(0);
});

// Simulated iOS keyboard: shrink only the *visual* viewport, as Safari does.
const FAKE_VV = () => {
  class FakeVV extends EventTarget {
    constructor() { super(); this.offsetTop = 0; this.offsetLeft = 0; this.scale = 1; this._h = null; }
    get width() { return innerWidth; } get height() { return this._h == null ? innerHeight : this._h; }
  }
  const vv = new FakeVV();
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__kb = (h) => { vv._h = innerHeight - h; vv.dispatchEvent(new Event('resize')); };
  window.__kbOff = () => { vv._h = null; vv.dispatchEvent(new Event('resize')); };
};

test('tap an element → full-screen composer: actions in the top bar, one 16px+ field, no extras', async ({ page }) => {
  await load(page, '<p id="p1">Tap me</p><p id="p2">Other</p>', { withName: false });
  await page.locator('.annot-collapser').tap();
  await page.locator('#p1').tap();
  const sheet = page.locator('.annot-popup.annot-fullsheet');
  await expect(sheet).toBeVisible();
  const vp = page.viewportSize();
  const box = await sheet.boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
  await expect(sheet.locator('.annot-fs-label')).toContainText('Tap me');
  // Only the textarea — chips, selector pill and identity row are desktop-only.
  await expect(sheet.locator('.annot-chips, .annot-el-id, .annot-identity-row, .annot-popup-actions')).toHaveCount(0);
  const ta = sheet.locator('textarea');
  await expect(ta).toBeFocused();
  expect(parseFloat(await ta.evaluate(e => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  const save = await sheet.locator('.annot-fs-save').boundingBox();
  expect(save.y + save.height).toBeLessThan(80);   // top bar, never at the bottom
  await ta.fill('Shorter please');
  await sheet.locator('.annot-fs-save').tap();
  await expect(page.locator('.annot-popup')).toHaveCount(0);
  await expect(page.locator('.annot-badge')).toHaveCount(1);
});

for (const [name, device, kb] of [['portrait', iphone, 380], ['landscape', (({ defaultBrowserType, ...d }) => d)(devices['iPhone 13 landscape']), 230]]) {
  test.describe(`keyboard (${name})`, () => {
    test.use({ ...device });
    test('composer fits above the keyboard; Done (blur) keeps the draft open', async ({ page }) => {
      await load(page, '<p id="p1">Tap me</p>', { init: FAKE_VV });
      await page.locator('.annot-collapser').tap();
      await page.locator('#p1').tap();
      await page.evaluate(h => window.__kb(h), kb);
      const vvH = await page.evaluate(() => visualViewport.height);
      const sheet = page.locator('.annot-fullsheet');
      await expect.poll(async () => (await sheet.boundingBox()).height).toBe(vvH);
      const save = await sheet.locator('.annot-fs-save').boundingBox();
      expect(save.y + save.height).toBeLessThanOrEqual(vvH);
      expect((await sheet.locator('textarea').boundingBox()).height).toBeGreaterThan(40);
      await sheet.locator('textarea').fill('Draft survives Done');
      // iOS ✓ Done = blur + keyboard down. Must not close or clear the note.
      await page.evaluate(() => { document.activeElement.blur(); window.__kbOff(); });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('textarea')).toHaveValue('Draft survives Done');
      await sheet.locator('.annot-fs-save').tap();
      await expect(page.locator('.annot-badge')).toHaveCount(1);
    });
  });
}

test('reply and edit on an opened note use the same full-screen composer', async ({ page }) => {
  await load(page, '<p id="p1">Tap me</p>');
  await annotateByTap(page, '#p1', 'Original');
  await page.locator('.annot-badge').tap();
  await page.locator('.annot-card.annot-sheet .annot-card-input-row input').tap();
  const sheet = page.locator('.annot-fullsheet');
  await expect(sheet.locator('.annot-fs-label')).toContainText('Reply #1');
  await sheet.locator('textarea').fill('A reply');
  await sheet.locator('.annot-fs-save').tap();
  await expect(page.locator('.annot-card.annot-sheet')).toContainText('A reply');
  await page.locator('.annot-card.annot-sheet .annot-card-btn[data-tooltip="More"]').tap();
  await page.locator('.annot-card-menu-item', { hasText: 'Edit' }).tap();
  await expect(sheet.locator('.annot-fs-label')).toContainText('Edit #1');
  await expect(sheet.locator('textarea')).toHaveValue('Original');
  await sheet.locator('textarea').fill('Edited');
  await sheet.locator('.annot-fs-save').tap();
  await expect(page.locator('.annot-card.annot-sheet')).toContainText('Edited');
});

test('badge tap opens the note as a full-screen modal (never a delete prompt); close button and Escape close it', async ({ page }) => {
  await load(page, '<p id="p1">Tap me</p><p id="p2" style="margin-top:300px">Far away</p>');
  await annotateByTap(page, '#p1', 'First');
  // Margin cards are hidden on a phone; the badge is the entry point.
  await expect(page.locator('.annot-card')).toBeHidden();
  await page.locator('.annot-badge').tap();
  await expect(page.locator('.annot-confirm-pop')).toHaveCount(0);
  const modal = page.locator('.annot-card.annot-sheet');
  await expect(modal).toBeVisible();
  // Full screen: covers the whole viewport.
  const vp = page.viewportSize();
  // Re-renders swap the element, so read the rect inside the page and retry.
  await expect.poll(() => page.evaluate(() => {
    const r = document.querySelector('.annot-card.annot-sheet')?.getBoundingClientRect();
    return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null;
  })).toEqual([8, 8, vp.width - 16, vp.height - 16]);   // 8px inset, rounded
  await expect(modal.locator('.annot-sheet-title')).toContainText('Comment #1');
  await expect(modal.locator('.annot-card-actions')).toHaveCSS('opacity', '1');
  // A clear, finger-sized close button at the top.
  const close = modal.locator('.annot-sheet-bar .annot-card-close');
  const cb = await close.boundingBox();
  expect(Math.min(cb.width, cb.height)).toBeGreaterThanOrEqual(44);
  expect(cb.y).toBeLessThan(60);
  await close.tap();
  await expect(page.locator('.annot-card.annot-sheet')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/annot-sheet-open/);
  await page.locator('.annot-badge').tap();
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.annot-card.annot-sheet')).toHaveCount(0);
  await expect(page.locator('.annot-popup')).toHaveCount(0);
});

test('several notes show as pins only; the modal opens one thread and resolves it there', async ({ page }) => {
  await load(page, '<p id="p1">One</p><p id="p2">Two</p><p id="p3">Three</p>');
  await annotateByTap(page, '#p1', 'Note one');
  await annotateByTap(page, '#p2', 'Note two');
  await annotateByTap(page, '#p3', 'Note three');
  await expect(page.locator('.annot-badge')).toHaveCount(3);
  for (const c of await page.locator('.annot-card').all()) await expect(c).toBeHidden();
  await page.locator('.annot-badge').nth(1).tap();
  const modal = page.locator('.annot-card.annot-sheet');
  await expect(modal).toHaveCount(1);
  await expect(modal).toContainText('Note two');
  await modal.locator('.annot-card-btn[data-tooltip="Resolve"]').tap();
  await expect(modal).toHaveClass(/resolved/);
  await modal.locator('.annot-sheet-bar .annot-card-close').tap();
  for (const c of await page.locator('.annot-card').all()) await expect(c).toBeHidden();
});

test('Copy falls back to a Markdown sheet when the clipboard is blocked', async ({ page }) => {
  await load(page, '<p id="p1">Tap me</p>', {
    init: () => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('NotAllowed')) }, configurable: true });
      const orig = document.execCommand.bind(document);
      document.execCommand = (c, ...r) => (c === 'copy' ? false : orig(c, ...r));
    },
  });
  await annotateByTap(page, '#p1', 'Copy me');
  await page.locator('.annot-share-btn').tap();
  await page.locator('.annot-actions-panel .annot-menu-item', { hasText: 'Copy Comments' }).tap();
  const sheet = page.locator('.annot-md-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('textarea')).toHaveValue(/Copy me/);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    sheet.locator('button', { hasText: 'Download .md' }).tap(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.md$/);
});

test('Export hands the .md to the native share sheet when files can be shared', async ({ page }) => {
  await load(page, '<p id="p1">Tap me</p>', {
    init: () => {
      window.__shared = null;
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__shared = (d.files || []).map(f => f.name); return Promise.resolve(); };
    },
  });
  await annotateByTap(page, '#p1', 'Ship it');
  await page.locator('.annot-share-btn').tap();
  await page.locator('.annot-actions-panel .annot-menu-item', { hasText: 'Export as Markdown' }).tap();
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([expect.stringMatching(/annotations-.*\.md$/)]);
  await expect(page.locator('.annot-toast').last()).toContainText('comments kept');
});

test('a full-width annotated element never causes horizontal page scroll', async ({ page }) => {
  await load(page, '<div id="wide" style="width:100%;background:#eee">Edge to edge</div>');
  await annotateByTap(page, '#wide', 'Wide');
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(vw);
  expect(await inViewport(page, '.annot-badge')).toBe(true);
});

test.describe('desktop width', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('stays on the floating popover + margin cards (no compact layout)', async ({ page }) => {
    await load(page, '<p id="p1">Desktop</p>');
    await expect(page.locator('body')).not.toHaveClass(/annot-compact/);
  });
});

test('annotated elements keep their own surface; the pin is the only mark', async ({ page }) => {
  await load(page, '<div id="box" style="background:rgb(25,25,25);border-radius:24px;padding:20px">Card</div>');
  await annotateByTap(page, '#box', 'A note');
  await expect(page.locator('.annot-badge')).toHaveCount(1);
  await expect(page.locator('#box')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(page.locator('#box')).toHaveCSS('border-radius', '24px');
});

test('the phone toolbar fits the screen with 16px side gutters', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>');
  await page.locator('.annot-collapser').tap();
  const b = await page.locator('.annot-fab-row').boundingBox();
  const vw = page.viewportSize().width;
  expect(Math.round(b.x)).toBe(16);
  expect(Math.round(b.x + b.width)).toBe(vw - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
});

test('notes on one element fan out, and past three become one stack pin with a list', async ({ page }) => {
  await load(page, '<p id="p1">Two notes here</p><p id="p2" style="margin-top:200px">Four notes here</p>');
  await annotateByTap(page, '#p1', 'One');
  await annotateByTap(page, '#p1', 'Two');
  // Two separate pins side by side, never on top of each other.
  await expect(page.locator('.annot-badge')).toHaveCount(2);
  const [a, b] = await Promise.all([0, 1].map(i => page.locator('.annot-badge').nth(i).boundingBox()));
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);

  for (const t of ['Three', 'Four', 'Five', 'Six']) await annotateByTap(page, '#p2', t);
  const stack = page.locator('.annot-badge-stack');
  await expect(stack).toHaveCount(1);
  await expect(stack).toContainText('+3');
  await expect(page.locator('.annot-badge')).toHaveCount(3);
  // Works in annotate mode too (the mode is still on after the last note).
  await stack.tap();
  const list = page.locator('.annot-stack-list');
  await expect(list).toBeVisible();
  await expect(list.locator('.annot-stack-row')).toHaveCount(4);
  await expect(list).toContainText('4 comments here');
  await list.locator('.annot-stack-row', { hasText: 'Five' }).tap();
  await expect(list).toHaveCount(0);
  await expect(page.locator('.annot-card.annot-sheet')).toContainText('Five');
});
