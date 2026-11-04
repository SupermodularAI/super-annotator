/**
 * Playwright integration tests for the annotate overlay.
 *
 * Run: npx playwright test 
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

test('banner renders with no note count', async ({ page }) => {
  await load(page, '<p id="p1">Hello world</p>');
  await expect(page.locator('.annot-fab-row')).toBeVisible();
  await expect(page.locator('.annot-fab-row')).not.toContainText('0 notes');
  await expect(page.locator('.annot-fab-row')).toContainText('Annotate mode on');
});

// ── Annotate mode ─────────────────────────────────────────────────────────────

test('A key enters annotate mode', async ({ page }) => {
  await load(page, '<p id="p1">Hello</p>');
  await page.keyboard.press('a');
  await expect(page.locator('body')).toHaveClass(/annot-mode/);
  await expect(page.locator('.annot-fab-row')).toContainText('Annotate mode on');
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

test('a numbered badge appears after annotation and survives exiting annotate mode', async ({ page }) => {
  await load(page, '<p id="p1">Paragraph</p>');
  await page.keyboard.press('a');
  await page.locator('#p1').click();
  await page.locator('.annot-popup textarea').fill('Note');
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Escape'); // exit annotate mode
  await expect(page.locator('.annot-badge')).toHaveCount(1);
  await expect(page.locator('.annot-badge')).toContainText('#1');
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
  // First save (⌘S) — handle the file download
  const [_download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Meta+s'),
  ]);
  await expect(page.locator('.annot-toast').last()).toContainText('Saved as');
  // Second save — no new annotations
  await page.keyboard.press('Meta+s');
  await expect(page.locator('.annot-toast').last()).toContainText('Already saved');
});

test('Save Version add-one-delete-one (same count) is not blocked', async ({ page }) => {
  await load(page, '<p id="p1">A</p><p id="p2">B</p>');
  await addAnnotation(page, '#p1', 'Note 1');
  await addAnnotation(page, '#p2', 'Note 2');
  // First save
  const [_dl] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Meta+s'),
  ]);
  // Delete note 1, add note 3 — same count, different IDs. Move the mouse off
  // #p2 first so its hover path-copier pill isn't covering the card menu.
  await page.mouse.move(5, 5);
  await expect(page.locator('.annot-path-copier')).toBeHidden();
  await page.locator('.annot-card-btn[data-tooltip="More"]').first().click();
  await page.locator('.annot-card-menu-item.danger').click();
  await page.locator('.annot-confirm-pop button', { hasText: 'Delete' }).click();
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await addAnnotation(page, '#p1', 'Note 3');
  // Should NOT be blocked
  const [dl2] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Meta+s'),
  ]);
  expect(dl2.suggestedFilename()).toMatch(/_v2\.html$/);
});

// ── Copy / Export .md KEEP comments (persistent — bug-fix !140) ───────────────

test('Copy keeps comments on the page (not cleared)', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'AI note');
  await page.locator('.annot-share-btn').click();
  await page.locator('.annot-actions-panel button', { hasText: 'Copy Comments' }).click();
  // Bug fix: copying must NOT wipe comments — they stay on the page.
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await expect(page.locator('.annot-toast').last()).toContainText('comments kept');
});

test('Export .md keeps comments and they persist across reload', async ({ page }) => {
  await load(page, '<p id="p1">Content</p>');
  await addAnnotation(page, '#p1', 'Export note');
  await page.locator('.annot-share-btn').click();
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.annot-actions-panel button', { hasText: 'Export as Markdown' }).click(),
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
  await page.keyboard.press('Shift+C');
  await page.locator('.annot-modal button', { hasText: 'Clear all' }).click();
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
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Meta+s'),
  ]);
  expect(download.suggestedFilename()).toBe('fixture_v4.html');
});

// ── First-run onboarding coachmark ───────────────────────────────

test('fresh artefact shows the onboarding overlay spotlighting the bubble', async ({ page }) => {
  await load(page, '<p id="p1">Untouched</p>', { expanded: false });
  await expect(page.locator('.annot-onboard-overlay')).toBeVisible();
  await expect(page.locator('.annot-onboard-spot')).toBeVisible();
  // Step 1 of the tour: "Next" walks the slider; "Start Annotating" is the last step.
  await expect(page.locator('.annot-onboard-start')).toContainText('Next');
  await expect(page.locator('.annot-onboard-card')).toContainText('Skip tour');
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
  await page.locator('.annot-onboard-dot').nth(4).click();   // last step
  await expect(page.locator('.annot-onboard-start')).toContainText('Start Annotating');
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

// ── Share menu (Copy / Export) ────────────────────────────────────────────────

test('share menu offers Copy + Export with shortcut chips; Copy with no notes says so', async ({ page }) => {
  await load(page, '<p id="p1">Empty</p>');
  await page.locator('.annot-share-btn').click();
  const items = page.locator('.annot-actions-panel .annot-menu-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Copy Comments');
  await expect(items.nth(0).locator('.annot-kbd')).toContainText('⇧C'); // shortcut chip
  await expect(items.nth(1)).toContainText('Export as Markdown');
  await items.nth(0).click();
  await expect(page.locator('.annot-toast').last()).toContainText('No annotations yet');
});

test('Copy from the share menu after an annotation copies and keeps comments', async ({ page }) => {
  await load(page, '<p id="p1">Copy me</p>');
  await addAnnotation(page, '#p1', 'Note for AI');
  await page.locator('.annot-share-btn').click();
  await page.locator('.annot-actions-panel .annot-menu-item', { hasText: 'Copy Comments' }).click();
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
  // Boot survived: overlay expanded via load(), banner present
  await expect(page.locator('.annot-fab-row')).toBeVisible();
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

// ── Inline edit focus regression guard ────────────────────────────────────────

test('clicking into the inline edit textarea keeps focus there, not the reply input', async ({ page }) => {
  await load(page, '<p id="p1">Editable</p>');
  await addAnnotation(page, '#p1', 'Original comment');
  await page.locator('.annot-card-btn[data-tooltip="More"]').first().click();
  await page.locator('.annot-card-menu-item', { hasText: 'Edit' }).click();
  const cardTextarea = page.locator('.annot-card textarea');
  await expect(cardTextarea).toBeVisible();
  // Drive this via dispatched events rather than Playwright's pointer-based
  // click: the card's hover-triggered translateX transition makes the
  // built-in actionability/stability wait flaky under headless software
  // rendering, which is unrelated to the focus-stealing bug under test here.
  // This still exercises the real regression: a click bubbling from inside
  // the editor up to the card's onclick handler, which used to unconditionally
  // steal focus to the reply input.
  const stillFocused = await page.evaluate(() => {
    const ta = document.querySelector('.annot-card textarea');
    ta.focus();
    ta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return document.activeElement === ta;
  });
  expect(stillFocused).toBe(true);
  await cardTextarea.fill('Edited comment');
  await page.evaluate(() => {
    [...document.querySelectorAll('.annot-card button')]
      .find(b => b.textContent.includes('Save'))
      .click();
  });
  await expect(page.locator('.annot-card-comment')).toContainText('Edited comment');
});

// ── Brand token regression guard ──────────────────────────────────────────────

test('--sm-muted resolves to the design system muted-foreground (Neutral/300)', async ({ page }) => {
  await load(page, '<p>x</p>');
  const val = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--sm-muted').trim()
  );
  expect(val).toBe('#cccccc');
});

// ── Anchor resolution: fail closed, never re-bind to the wrong element ────────
//
// The overlay resolves a saved comment back to a live element in two ways:
// the volatile data-annot-ref (same session only) and the durable anchor
// (selector + tagName + 180-char text snapshot). These tests exercise the
// durable path by re-serving the fixture with *changed* markup, which is what
// happens for real when the author regenerates the artefact.

/** Re-serve the fixture with different markup and reload — simulates the
 *  author editing the artefact between review sessions. */
async function reloadWith(page, body, { title = 'Test Artefact' } = {}) {
  await page.unroute(FIXTURE);
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
  await page.addScriptTag({ path: JS_PATH });
}

/** The durable anchor persisted for the first annotation on the page. */
function storedAnchor(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('sm-annotator://fixture.html');
    return raw ? JSON.parse(raw)[0].anchor : null;
  });
}

test('anchors on a unique #id and re-resolves it after reload', async ({ page }) => {
  await load(page, '<p id="alpha">Alpha copy</p><p id="beta">Beta copy</p>');
  await addAnnotation(page, '#beta', 'About beta');
  expect(await storedAnchor(page)).toMatchObject({ selector: '#beta', tagName: 'p' });

  await page.keyboard.press('Escape');
  await reloadWith(page, '<p id="alpha">Alpha copy</p><p id="beta">Beta copy</p>');
  await expect(page.locator('#beta')).toHaveClass(/annot-target/);
  await expect(page.locator('#alpha')).not.toHaveClass(/annot-target/);
});

test('an #id anchor survives a copy edit — the id is the identity, not the text', async ({ page }) => {
  await load(page, '<p id="alpha">Alpha copy</p><p id="beta">Beta copy</p>');
  await addAnnotation(page, '#beta', 'About beta');
  await page.keyboard.press('Escape');
  await reloadWith(page, '<p id="alpha">Alpha copy</p><p id="beta">Beta copy, rewritten</p>');
  await expect(page.locator('#beta')).toHaveClass(/annot-target/);
  await expect(page.locator('.annot-card')).toContainText('About beta');
});

test('inserting a sibling above an annotated item does NOT move the comment', async ({ page }) => {
  await load(page, '<ul id="list"><li>One</li><li>Two</li><li>Three</li></ul>');
  await addAnnotation(page, 'li:nth-of-type(2)', 'This one is wrong');
  await page.keyboard.press('Escape');

  // "Zero" shifts every :nth-of-type index by one. The old positional-only
  // selector re-bound the note to "One" without telling anybody; the text
  // snapshot now catches the shift and the anchor is rejected instead.
  await reloadWith(page, '<ul id="list"><li>Zero</li><li>One</li><li>Two</li><li>Three</li></ul>');
  await expect(page.locator('li.annot-target')).toHaveCount(0);

  // The comment itself is never destroyed — it stays in storage.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sm-annotator://fixture.html')));
  expect(stored).toHaveLength(1);
  expect(stored[0].comment).toBe('This one is wrong');
});

test('inserting a sibling below an annotated item keeps the comment bound', async ({ page }) => {
  await load(page, '<ul id="list"><li>One</li><li>Two</li><li>Three</li></ul>');
  await addAnnotation(page, 'li:nth-of-type(2)', 'Still about Two');
  await page.keyboard.press('Escape');
  await reloadWith(page, '<ul id="list"><li>One</li><li>Two</li><li>Three</li><li>Four</li></ul>');
  await expect(page.locator('li.annot-target')).toHaveCount(1);
  await expect(page.locator('li.annot-target')).toHaveText('Two');
});

test('a reworded weak-anchor element orphans instead of keeping a stale note', async ({ page }) => {
  await load(page, '<p class="lead">Original headline copy</p><p class="sub">Sub</p>');
  await addAnnotation(page, '.lead', 'Too long');
  const anchor = await storedAnchor(page);
  expect(anchor.selector).toBe('p.lead');
  expect(anchor.text).toBe('Original headline copy');

  await page.keyboard.press('Escape');
  await reloadWith(page, '<p class="lead">Completely different headline</p><p class="sub">Sub</p>');
  await expect(page.locator('p.annot-target')).toHaveCount(0);
});

test('an annotated image anchors on its src, with no text to snapshot', async ({ page }) => {
  const img = '<img id="" src="/logo-a.png" alt="A"><img src="/logo-b.png" alt="B">';
  await load(page, img);
  await addAnnotation(page, 'img[src="/logo-b.png"]', 'Swap this logo');
  expect(await storedAnchor(page)).toMatchObject({ selector: 'img[src="/logo-b.png"]', tagName: 'img', text: '' });

  await page.keyboard.press('Escape');
  await reloadWith(page, img);
  await expect(page.locator('img[src="/logo-b.png"]')).toHaveClass(/annot-target/);
  await expect(page.locator('img[src="/logo-a.png"]')).not.toHaveClass(/annot-target/);
});

test('a text-less element with no identity gets no anchor rather than a guessable one', async ({ page }) => {
  const dot = '<span class="dot" style="display:inline-block;width:24px;height:24px;background:#333"></span>';
  await load(page, `<div id="icons">${dot}${dot}</div>`);
  await addAnnotation(page, '#icons span:nth-of-type(2)', 'Second dot');
  // No text to verify and no author-controlled identity: shipping a positional
  // anchor here would silently validate the *other* dot after any edit.
  expect(await storedAnchor(page)).toBeNull();
  await expect(page.locator('.annot-card')).toContainText('Second dot');
});

test('generated (hashed) class names are never used as an anchor rung', async ({ page }) => {
  // Build-hash classes (CSS modules, styled-components, Tailwind JIT) change on
  // every rebuild — an anchor pinned to one is stale before the reviewer replies.
  const hashed = 'a1b2c3d4e5f6';                     // pure hex, 8+ chars
  const long   = 'x'.repeat(40);                      // absurdly long => generated
  await load(page, `<p class="${hashed} ${long} prose">Hashed class copy</p><p>Other</p>`);
  await addAnnotation(page, '.prose', 'Note');
  const anchor = await storedAnchor(page);
  expect(anchor.selector).not.toContain(hashed);
  expect(anchor.selector).not.toContain(long);
  expect(anchor.selector).toBe('p.prose');
});

test('overlay-owned annot-* classes never leak into a durable anchor', async ({ page }) => {
  // Annotating adds .annot-target to the element; a second annotation must not
  // pick that up as a "meaningful" class, because it disappears on reload.
  await load(page, '<section class="hero"><p class="copy">Hero copy</p></section>');
  await addAnnotation(page, '.copy', 'First');
  await page.keyboard.press('Escape');
  const anchor = await storedAnchor(page);
  expect(anchor.selector).not.toContain('annot');
});

test('an anchor is verified against the live DOM before it is stored', async ({ page }) => {
  await load(page, '<div class="row"><span>A</span></div><div class="row"><span>B</span></div>');
  await addAnnotation(page, '.row:nth-of-type(2) span', 'About B');
  const anchor = await storedAnchor(page);
  // Whatever rung won, it must uniquely select the element it came from.
  const unique = await page.evaluate(sel => {
    const m = document.querySelectorAll(sel);
    return m.length === 1 && m[0].textContent === 'B';
  }, anchor.selector);
  expect(unique).toBe(true);
});

// ── Orphaned annotations ─────────────────────────────────────────────────────
//
// When an anchor no longer resolves the comment is kept and shown as an orphan
// card, not silently dropped. Dropping it made the note look deleted while it
// was still sitting in localStorage, and hid the fact that the artefact had
// changed underneath the review.

test('a removed element leaves an orphan card, not a vanished comment', async ({ page }) => {
  await load(page, '<p id="keep">Keep me</p><p id="gone">Delete me</p>');
  await addAnnotation(page, '#gone', 'This section should go');
  await page.keyboard.press('Escape');

  await reloadWith(page, '<p id="keep">Keep me</p>');
  const card = page.locator('.annot-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/orphaned/);
  await expect(card).toContainText('This section should go');
  await expect(card.locator('.annot-orphan-note')).toContainText('Element not found on this page');
});

test('the orphan card names the element the note was written about', async ({ page }) => {
  await load(page, '<section id="pricing"><p>Old pricing copy</p></section>');
  await addAnnotation(page, '#pricing p', 'Numbers are wrong');
  await page.keyboard.press('Escape');
  await reloadWith(page, '<section id="pricing"></section>');
  await expect(page.locator('.annot-orphan-note code')).toContainText('pricing');
  // The quoted snippet is what makes an orphan actionable — it's the only
  // record of what the reviewer was actually looking at.
  await expect(page.locator('.annot-card-snippet')).toContainText('Old pricing copy');
});

test('a shifted list surfaces an orphan instead of a comment on the wrong item', async ({ page }) => {
  await load(page, '<ul id="list"><li>One</li><li>Two</li><li>Three</li></ul>');
  await addAnnotation(page, 'li:nth-of-type(2)', 'Reword this one');
  await page.keyboard.press('Escape');
  await reloadWith(page, '<ul id="list"><li>Zero</li><li>One</li><li>Two</li><li>Three</li></ul>');

  await expect(page.locator('li.annot-target')).toHaveCount(0);   // never mis-bound
  await expect(page.locator('.annot-card.orphaned')).toHaveCount(1);
  await expect(page.locator('.annot-card.orphaned')).toContainText('Reword this one');
});

test('orphan cards park below the anchored ones', async ({ page }) => {
  await load(page, '<p id="a">Alpha</p><div style="height:600px"></div><p id="b">Bravo</p><p id="c">Charlie</p>');
  await addAnnotation(page, '#c', 'Orphan soon');
  await page.keyboard.press('Escape');
  await addAnnotation(page, '#a', 'Stays anchored');
  await page.keyboard.press('Escape');
  await addAnnotation(page, '#b', 'Also anchored');
  await page.keyboard.press('Escape');

  await reloadWith(page, '<p id="a">Alpha</p><div style="height:600px"></div><p id="b">Bravo</p>');
  await expect(page.locator('.annot-card')).toHaveCount(3);

  const tops = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.annot-card')).map(c => ({
      orphan: c.classList.contains('orphaned'),
      top: parseFloat(c.style.top),
    }))
  );
  const orphanTop  = Math.min(...tops.filter(t => t.orphan).map(t => t.top));
  const anchoredMax = Math.max(...tops.filter(t => !t.orphan).map(t => t.top));
  expect(orphanTop).toBeGreaterThan(anchoredMax);
});

test('an orphan can still be replied to and deleted', async ({ page }) => {
  await load(page, '<p id="gone">Delete me</p>');
  await addAnnotation(page, '#gone', 'Original note');
  await page.keyboard.press('Escape');
  await reloadWith(page, '<p id="other">Something else</p>');

  const card = page.locator('.annot-card.orphaned');
  await card.locator('.annot-card-input-row input').fill('Still replying');
  await page.keyboard.press('Enter');
  await expect(page.locator('.annot-card.orphaned')).toContainText('Still replying');

  await card.locator('.annot-card-btn').last().click();
  await page.locator('.annot-card-menu-item.danger').click();
  await page.locator('.annot-confirm-pop button', { hasText: 'Delete' }).click();
  await expect(page.locator('.annot-card')).toHaveCount(0);
});

test('the markdown export flags an orphaned note as possibly stale', async ({ page }) => {
  await load(page, '<p id="keep">Keep</p><p id="gone">Gone soon</p>');
  await addAnnotation(page, '#keep', 'Anchored note');
  await page.keyboard.press('Escape');
  await addAnnotation(page, '#gone', 'Orphan note');
  await page.keyboard.press('Escape');
  await reloadWith(page, '<p id="keep">Keep</p>');

  // Stub the clipboard so the assertion doesn't depend on browser permissions.
  await page.evaluate(() => {
    window.__copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { window.__copied = t; } },
    });
  });
  await page.keyboard.press('Meta+Shift+C');

  const md = await page.evaluate(() => window.__copied);
  expect(md).toContain('Anchored note');
  expect(md).toContain('Orphan note');
  expect(md).toContain('Element not found in the current page');
  // Only the orphan is flagged.
  expect(md.match(/Element not found in the current page/g)).toHaveLength(1);
});

test('pins follow the page when it reflows without a scroll (fonts, images, grid)', async ({ page }) => {
  await load(page, '<div id="wrap" style="width:300px"><p id="p1" style="margin:0">Reflow me</p></div>');
  await addAnnotation(page, '#p1', 'Follow the element');
  await page.keyboard.press('Escape');
  const before = (await page.locator('.annot-badge').boundingBox()).x;
  await page.evaluate(() => { document.getElementById('wrap').style.width = '500px'; });
  await expect.poll(async () => Math.round((await page.locator('.annot-badge').boundingBox()).x - before)).toBe(200);
});
