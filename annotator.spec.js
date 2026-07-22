/**
 * Playwright integration tests for the annotate overlay.
 *
 * Run: npx playwright test --config=.claude/skills/annotate/playwright.config.js
 *
 * Uses page.route() to serve fixture HTML from a stable http:// origin
 * (so localStorage works) without needing a real server.
 * The annotator JS is loaded via addScriptTag({ path }) to avoid inline-string
 * size limits.
 */

const { test, expect } = require('@playwright/test');
const path = require('node:path');

const JS_PATH  = path.join(__dirname, 'annotator.js');
const ORIGIN   = 'http://annotator-test.local';
const FIXTURE  = `${ORIGIN}/fixture.html`;

/**
 * Serve a fixture at FIXTURE with the annotator loaded from disk.
 * @param {boolean} withName  Pre-set SM_REVIEWER_NAME to skip the name prompt.
 * @param {boolean} expanded  Expand the overlay after load (fresh artefacts
 *                            start collapsed); pass false to test the
 *                            collapsed default itself.
 */
async function load(page, body = '', { title = 'Test Artefact', withName = true, expanded = true } = {}) {
  await page.route(FIXTURE, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>${body}</body>
</html>`,
    })
  );
  await page.goto(FIXTURE);
  if (withName) {
    // Set localStorage before the script runs so nameSet is true from the start.
    await page.evaluate(() => {
      localStorage.setItem('sm-annotator:reviewer', 'Test Reviewer');
      window.SM_REVIEWER_NAME = 'Test Reviewer';
    });
  }
  await page.addScriptTag({ path: JS_PATH });
  if (expanded) {
    const collapsed = await page.evaluate(() => document.body.classList.contains('annot-ui-collapsed'));
    if (collapsed) await page.keyboard.press('a'); // enter annotate → expands the toolbar (H now hides the whole UI)
  }
}

// ── FAB ───────────────────────────────────────────────────────────────────────

test('FAB renders and hides zero-count', async ({ page }) => {
  await load(page, '<p id="p1">Hello world</p>');
  await expect(page.locator('.annot-fab')).toBeVisible();
  await expect(page.locator('.annot-fab')).not.toContainText('0 notes');
  await expect(page.locator('.annot-fab')).toContainText('Annotate');
});

// ── Annotate mode ─────────────────────────────────────────────────────────────

test('A key enters annotate mode', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>');
  await page.keyboard.press('a');
  await expect(page.locator('body')).toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-fab')).toContainText('Exit annotate mode');
});

test('Esc exits annotate mode', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>');
  await page.keyboard.press('a');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/annot-mode/);
});

// ── Inline identity (first action is the annotation, not a name gate) ──────────

test('first click opens the note composer directly — no name gate', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>', { withName: false });
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  // The note textarea is there and focused immediately…
  await expect(page.locator('.annot-popup textarea')).toBeVisible();
  await expect(page.locator('.annot-popup textarea')).toBeFocused();
  // …and the old blocking "Who are you?" prompt is gone.
  await expect(page.locator('.annot-popup')).not.toContainText('Who are you?');
  // The inline name field is offered as a subtle footer, not a gate.
  await expect(page.locator('.annot-identity-input')).toBeVisible();
});

test('inline name field tags the note and is remembered next time', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>', { withName: false });
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-identity-input').fill('Diogo');
  await page.locator('.annot-popup textarea').fill('Looks good');
  await page.keyboard.press('Meta+Enter');
  // Card is created and attributed to the inline name.
  await expect(page.locator('.annot-card')).toContainText('Diogo');
  await expect(page.locator('.annot-card')).toContainText('Looks good');
  // Second note no longer asks for a name (identity is locked in).
  await page.locator('#p1').click();
  await expect(page.locator('.annot-identity-input')).toHaveCount(0);
});

test('renaming in Options re-stamps this session\'s notes (incl. the default "Reviewer")', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>', { withName: false });
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  // Leave the inline name blank → the note is attributed to the default.
  await page.locator('.annot-popup textarea').fill('Default-author note');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.annot-card')).toContainText('Reviewer');
  // Now set a real name in Options → it should retro-apply to this session.
  await page.locator('.annot-actions-btn').click();
  await page.locator('.annot-reviewer-input').fill('Alice');
  await expect(page.locator('.annot-card')).toContainText('Alice');
  await expect(page.locator('.annot-card')).not.toContainText('Reviewer');
});

test('renaming in Options does NOT touch notes from a previous session or other reviewers', async ({ page }) => {
  // Seed a note authored by someone else in a previous session, then load.
  await page.route(FIXTURE, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><head><title>Test Artefact</title></head><body><p id="p1">One</p><p id="p2">Two</p></body></html>',
    })
  );
  await page.goto(FIXTURE);
  await page.evaluate(() => {
    localStorage.setItem('sm-annotator://fixture.html', JSON.stringify([
      { id: 'old1', localId: 1, page: 'fixture.html', author: 'Bob', comment: "Bob's earlier note", selector: '#p1', replies: [], frozen: false },
    ]));
  });
  await page.addScriptTag({ path: JS_PATH });
  await page.keyboard.press('a'); // expand + enter annotate mode

  // This session: add a fresh note on #p2 (default author).
  await page.locator('#p2').click();
  await page.locator('.annot-popup textarea').fill('My new note');
  await page.keyboard.press('Meta+Enter');

  // Rename in Options.
  await page.locator('.annot-actions-btn').click();
  await page.locator('.annot-reviewer-input').fill('Alice');

  // Only the session note is re-stamped; Bob's previous-session note is intact.
  const cards = page.locator('.annot-card');
  await expect(cards.filter({ hasText: 'My new note' })).toContainText('Alice');
  await expect(cards.filter({ hasText: "Bob's earlier note" })).toContainText('Bob');
  await expect(cards.filter({ hasText: "Bob's earlier note" })).not.toContainText('Alice');
});

// ── Annotation card ───────────────────────────────────────────────────────────

test('saving a note creates a card with the comment', async ({ page }) => {
  await load(page, '<p id="p1">Annotate this</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('My test note');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.annot-card')).toBeVisible();
  await expect(page.locator('.annot-card')).toContainText('My test note');
});

test('FAB note count increments after annotation', async ({ page }) => {
  await load(page, '<p id="p1">Paragraph</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('Note');
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Escape'); // exit annotate mode so FAB shows the count
  await expect(page.locator('.annot-fab')).toContainText('1 note');
});

// ── Badge ─────────────────────────────────────────────────────────────────────

test('badge appears and hover reveals the delete marker', async ({ page }) => {
  await load(page, '<p id="p1">Badge test</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('Note');
  await page.keyboard.press('Meta+Enter');
  const badge = page.locator('.annot-badge');
  await expect(badge).toBeVisible();
  await badge.hover();
  await expect(badge.locator('.annot-badge-del')).toBeVisible();
});

// ── Highlight ─────────────────────────────────────────────────────────────────

test('annotated element gets the annot-target class', async ({ page }) => {
  await load(page, '<p id="p1">Highlight me</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('Check');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('#p1')).toHaveClass(/annot-target/);
});

// ── Inline reply ──────────────────────────────────────────────────────────────

test('clicking a card focuses its reply input', async ({ page }) => {
  await load(page, '<p id="p1">Reply test</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('Original');
  await page.keyboard.press('Meta+Enter');
  await page.locator('.annot-card-comment').click();
  await expect(page.locator('.annot-card-input-row input')).toBeFocused();
});

// ── Resolve ───────────────────────────────────────────────────────────────────

test('resolve adds the resolved class to card and badge', async ({ page }) => {
  await load(page, '<p id="p1">Resolve test</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('Done');
  await page.keyboard.press('Meta+Enter');
  await page.locator('.annot-card .annot-card-btn.resolve').hover();
  await page.locator('.annot-card .annot-card-btn.resolve').click();
  await expect(page.locator('.annot-card')).toHaveClass(/resolved/);
  await expect(page.locator('.annot-badge')).toHaveClass(/resolved/);
});

// ── Fresh page ────────────────────────────────────────────────────────────────

test('fresh page with no stored annotations shows no cards', async ({ page }) => {
  await load(page, '<p id="p1">Clean slate</p>');
  await expect(page.locator('.annot-card')).toHaveCount(0);
});

// ── Hide Annotate UI (H shortcut / ⋮ menu) ───────────────────────────────────

test('H key hides the entire annotator UI', async ({ page }) => {
  await load(page, '<p>Hello</p>');
  await page.keyboard.press('h');
  await expect(page.locator('body')).toHaveClass(/annot-ui-hidden/);
  await expect(page.locator('.annot-fab-row')).toBeHidden();
  await expect(page.locator('.annot-collapser')).toBeHidden();
});

test('H key restores the annotator UI when hidden', async ({ page }) => {
  await load(page, '<p>Hello</p>');
  await page.keyboard.press('h'); // hide
  await page.keyboard.press('h'); // un-hide (same shortcut)
  await expect(page.locator('body')).not.toHaveClass(/annot-ui-hidden/);
  await expect(page.locator('.annot-fab-row')).toBeVisible();
});

test('H key does not hide when focus is inside an input', async ({ page }) => {
  await load(page, '<input id="i1" type="text">');
  await page.locator('#i1').click();
  await page.keyboard.press('h');
  await expect(page.locator('body')).not.toHaveClass(/annot-ui-hidden/);
});

test('Hide Annotate UI menu item hides the overlay; A brings it back', async ({ page }) => {
  await load(page, '<p>Hello</p>');
  await page.locator('.annot-actions-btn').click();
  await page.locator('.annot-menu-item', { hasText: 'Hide Annotate UI' }).click();
  await expect(page.locator('body')).toHaveClass(/annot-ui-hidden/);
  await page.keyboard.press('a');
  await expect(page.locator('body')).not.toHaveClass(/annot-ui-hidden/);
});

// ── Save Version guard ────────────────────────────────────────────────────────

async function addAnnotation(page, selector, text) {
  await page.keyboard.press('a');
  await page.locator(selector).click();
  await page.locator('.annot-popup textarea').fill(text);
  await page.keyboard.press('Meta+Enter');
}

test('Save Version a second time with no new annotations shows already-saved toast', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'First note');
  // First save — handle the file download
  await page.locator('.annot-actions-btn').click();
  const [_download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: 'Save Version' }).click(),
  ]);
  await expect(page.locator('.annot-toast').last()).toContainText('Saved as');
  // Second save — no new annotations
  await page.locator('.annot-actions-btn').click();
  await page.locator('button', { hasText: 'Save Version' }).click();
  await expect(page.locator('.annot-toast').last()).toContainText('Already saved');
});

test('Save Version add-one-delete-one (same count) is not blocked', async ({ page }) => {
  await load(page, '<p id="p1">A</p><p id="p2">B</p>');
  await addAnnotation(page, '#p1', 'Note 1');
  await addAnnotation(page, '#p2', 'Note 2');
  // First save
  await page.locator('.annot-actions-btn').click();
  const [_dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: 'Save Version' }).click(),
  ]);
  // Delete note 1, add note 3 — same count, different IDs
  await page.locator('.annot-card-btn[data-tooltip="More"]').first().click();
  page.once('dialog', d => d.accept());
  await page.locator('.annot-card-menu-item.danger').click();
  await addAnnotation(page, '#p1', 'Note 3');
  // Should NOT be blocked
  await page.locator('.annot-actions-btn').click();
  const [dl2] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: 'Save Version' }).click(),
  ]);
  expect(dl2.suggestedFilename()).toMatch(/_v2\.html$/);
});

// ── Copy / Export .md KEEP comments (persistent — bug-fix !140) ───────────────

test('Copy keeps comments on the page (not cleared)', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'AI note');
  await page.locator('.annot-actions-btn').click();
  await page.locator('.annot-actions-panel button', { hasText: 'Copy' }).click();
  // Bug fix: copying must NOT wipe comments — they stay on the page.
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await expect(page.locator('.annot-toast').last()).toContainText('comments kept');
});

test('Export .md keeps comments and they persist across reload', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'Export note');
  await page.locator('.annot-actions-btn').click();
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.annot-actions-panel button', { hasText: 'Export' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  // Bug fix: exporting must NOT wipe comments — they stay on the page…
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await expect(page.locator('.annot-toast').last()).toContainText('comments kept');
  // …and survive a reload, since they are persisted in localStorage.
  await page.reload();
  await page.addScriptTag({ path: JS_PATH });
  await expect(page.locator('.annot-card')).toHaveCount(1);
});

// ── Confirm guards ────────────────────────────────────────────────────────────

test('Clear all: cancelling confirm leaves annotations intact', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'Keep me');
  page.once('dialog', d => d.dismiss());
  await page.keyboard.press('Shift+C');
  await expect(page.locator('.annot-card')).toHaveCount(1);
});

test('Clear all: confirming removes all annotations', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'Delete me');
  page.once('dialog', d => d.accept());
  await page.keyboard.press('Shift+C');
  await expect(page.locator('.annot-card')).toHaveCount(0);
});

// ── Version advancement from filename ─────────────────────────────────────────

test('Save Version on _v3 file produces _v4 download', async ({ page }) => {
  const fixtureV3 = `${ORIGIN}/fixture_v3.html`;
  await page.route(fixtureV3, route => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head><title>Test v3</title></head><body><p id="p1">Content</p></body></html>`,
  }));
  await page.goto(fixtureV3);
  await page.evaluate(() => {
    localStorage.setItem('sm-annotator:reviewer', 'Test Reviewer');
    window.SM_REVIEWER_NAME = 'Test Reviewer';
  });
  await page.addScriptTag({ path: JS_PATH });
  await addAnnotation(page, '#p1', 'Note on v3');
  await page.locator('.annot-actions-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: 'Save Version' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('fixture_v4.html');
});

// ── First-run onboarding coachmark ───────────────────────────────

test('fresh artefact shows the onboarding overlay spotlighting the bubble', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await expect(page.locator('.annot-onboard-overlay')).toBeVisible();
  await expect(page.locator('.annot-onboard-spot')).toBeVisible();
  await expect(page.locator('.annot-onboard-card')).toContainText('Start Annotating');
  await expect(page.locator('.annot-collapser')).toBeVisible();
  await expect(page.locator('.annot-fab-row')).toBeHidden();
});

test('the slider shows 5 illustrated steps; next arrow and dots navigate', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  const slides = page.locator('.annot-onboard-slide');
  await expect(slides).toHaveCount(5);
  await expect(slides.nth(0)).toHaveClass(/active/);
  await page.locator('.annot-onboard-nav .annot-onboard-arrow').last().click();
  await expect(slides.nth(1)).toHaveClass(/active/);
  await page.locator('.annot-onboard-dot').nth(4).click();
  await expect(slides.nth(4)).toHaveClass(/active/);
});

test('Start Annotating enters annotate mode and never shows the overlay again', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await page.locator('.annot-onboard-start').click();
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-fab-row')).toBeVisible();
  await page.reload();
  await page.addScriptTag({ path: JS_PATH });
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
});

test('clicking the spotlighted bubble starts annotating', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await page.locator('.annot-onboard-spot').click();
  await expect(page.locator('body')).toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
});

test('Skip dismisses the overlay and it stays gone after reload', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await page.locator('.annot-onboard-skip').click();
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-collapser')).toBeVisible();
  await page.reload();
  await page.addScriptTag({ path: JS_PATH });
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
  await expect(page.locator('.annot-collapser')).toBeVisible();
});

test('the × dismisses the overlay without entering annotate mode', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await page.locator('.annot-onboard-x').click();
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
  await expect(page.locator('.annot-fab-row')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/annot-mode/);
});

test('pressing Escape dismisses the onboarding overlay', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await page.keyboard.press('Escape');
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
});

test('pressing A from the overlay starts annotating', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await page.keyboard.press('a');
  await expect(page.locator('body')).toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
});

test('page with an existing annotation skips onboarding and starts expanded', async ({ page }) => {
  await load(page, '<p id="p1">Has notes</p>');
  await addAnnotation(page, '#p1', 'Existing note');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.addScriptTag({ path: JS_PATH });
  await expect(page.locator('.annot-onboard-overlay')).toHaveCount(0);
  await expect(page.locator('.annot-fab-row')).toBeVisible();
  await expect(page.locator('.annot-collapser')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/annot-mode/);
});

test('comment card re-renders after a plain reload (durable anchor, not volatile ref)', async ({ page }) => {
  await load(page, '<p id="p1">Has notes</p>');
  await addAnnotation(page, '#p1', 'Survives reload');
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.addScriptTag({ path: JS_PATH });
  // Regression: the card used to vanish on reload because its only anchor was a
  // data-annot-ref attribute that isn't in the reloaded HTML. The note text + card
  // must come back, resolved via a durable selector.
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await expect(page.locator('.annot-card')).toContainText('Survives reload');
});

// ── Quick-action chips ────────────────────────────────────────────────────────

test('composer shows 3 quick-action chips that prefill the note', async ({ page }) => {
  await load(page, '<p id="p1">Chip target</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await expect(page.locator('.annot-chip')).toHaveCount(3);
  await page.locator('.annot-chip', { hasText: 'Delete this' }).click();
  await expect(page.locator('.annot-popup textarea')).toHaveValue('Delete this');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.annot-card')).toContainText('Delete this');
});

// ── Always-visible Copy button ────────────────────────────────────────────────

test('Copy button is visible but disabled with no annotations', async ({ page }) => {
  await load(page, '<p id="p1">Empty</p>');
  const copy = page.locator('.annot-copy-fab');
  await expect(copy).toBeVisible();
  await expect(copy).toBeDisabled();
  await expect(copy).toHaveAttribute('title', /Annotate something first/);
  await expect(copy.locator('.annot-kbd')).toContainText('⇧C'); // shortcut chip
  // Stacked below the Annotate button
  const fabBox  = await page.locator('.annot-fab').boundingBox();
  const copyBox = await copy.boundingBox();
  expect(copyBox.y).toBeGreaterThan(fabBox.y + fabBox.height - 1);
});

test('Copy button enables after an annotation and copies + clears on click', async ({ page }) => {
  await load(page, '<p id="p1">Copy me</p>');
  await addAnnotation(page, '#p1', 'Note for AI');
  await page.keyboard.press('Escape'); // exit annotate mode
  const copy = page.locator('.annot-copy-fab');
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.locator('.annot-card')).toHaveCount(1); // bug fix: comments kept
  await expect(page.locator('.annot-toast').last()).toContainText('comments kept');
});

// ── Storage lifecycle ─────────────────────────────────────────────────────────

test('overlay survives blocked localStorage (sandboxed viewer) and warns on first write', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage disabled', 'SecurityError'); },
    });
    window.SM_REVIEWER_NAME = 'Test Reviewer';
  });
  await load(page, '<p id="p1">Sandboxed</p>', { withName: false });
  // Boot survived: overlay expanded via load(), FAB present
  await expect(page.locator('.annot-fab')).toBeVisible();
  // Annotating still works in-memory, with a one-time persistence warning
  await addAnnotation(page, '#p1', 'In-memory note');
  await expect(page.locator('.annot-card')).toContainText('In-memory note');
  await expect(page.locator('.annot-toast').filter({ hasText: "won't persist" })).toBeVisible();
});

test('⌘⇧C shortcut copies and keeps comments (persistent)', async ({ page }) => {
  await load(page, '<p id="p1">Shortcut</p>');
  await addAnnotation(page, '#p1', 'Copy via keys');
  await page.keyboard.press('Escape'); // leave annotate mode
  await page.keyboard.press('Meta+Shift+C');
  // Bug fix: copy via keyboard must NOT wipe comments.
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await expect(page.locator('.annot-toast').last()).toContainText('comments kept');
});

// ── Brand token regression guard ──────────────────────────────────────────────

test('--sm-muted resolves to the readable Neutral/400 gray', async ({ page }) => {
  await load(page, '<p>x</p>');
  const val = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--sm-muted').trim()
  );
  expect(val).toBe('#c2c2c2');
});
