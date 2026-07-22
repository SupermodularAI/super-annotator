---
name: super-annotator
description: Inline a click-to-annotate overlay into any HTML file so reviewers can leave inline notes and export them as markdown to paste into an AI prompt. Use when the user asks to add feedback/annotation/review capability to a prototype, deck, report, or any standalone HTML page, or to retrofit an existing file with it. HTML only.
---

# Super Annotator

Self-contained JS overlay, zero dependencies. Annotation cards float inline next
to each element (Notion-style, no sidebar). Click any element → type a note →
the card appears in the right margin. Export copies everything as markdown —
paste it straight into your next AI prompt and it knows exactly what to fix.

Canonical source: `annotator.js` in this repo — always read from here, never
re-implement.

### Default behavior

- **Starts hidden on untouched pages** — a fresh page shows the 💬 bubble plus a
  one-time onboarding coachmark. "Start Annotating" enters annotate mode; Skip / ×
  dismiss it. The choice persists in `localStorage` so it never reappears.
- **Copy is always visible** next to the Annotate button — disabled with a nudge
  tooltip until the first annotation exists.
- **Quick-action chips** in the composer (`Delete this` / `Reword this` /
  `Shorten this`) prefill the note so common feedback is one click + Save.
- **Hide Annotate UI** (the `⋮` menu or the `H` key) tucks away all overlay
  chrome so the page reads clean. `H` brings it back.

---

## Installing it (what "ask Claude Code to install this" does)

When a user points Claude Code at this repo and asks to install Super Annotator
on their project:

1. Read `annotator.js` from this repo.
2. Insert it immediately before `</body>` in the target file(s), wrapped in:

```html
<!-- annotate:v1 START -->
<script>
…full contents of annotator.js…
</script>
<!-- annotate:v1 END -->
```

- **Idempotent:** if the target already has `<!-- annotate:v1 START -->`, replace
  only the block between `START` and `END`.
- **Always inline** — never link a sibling file. Pages travel (get emailed,
  copied, deployed); a missing sibling silently breaks the overlay.

If Node.js is available, prefer running `inject-annotate.js` from this repo
instead of hand-rolling the block (same result, less error-prone):

```bash
node inject-annotate.js <path-to-file-or-folder> [--key=] [--name=] [--reviewer=] [--plugin] [--recursive]
```

See `README.md` for the full flag reference.

---

## Optional overrides (insert in a `<script>` block above the annotator)

```js
window.SM_ARTEFACT_KEY  = 'project-key';    // shared localStorage key across a multi-file site
window.SM_ARTEFACT_NAME = 'Project title';  // display name in export
window.SM_REVIEWER_NAME = 'Jane Doe';       // pre-fill reviewer name
window.SM_ANNOTATE_PLUGIN = true;           // ship dormant, activate via ?=annotate
```

## Plugin mode (`?=annotate`)

Set `window.SM_ANNOTATE_PLUGIN = true` above the injected block to ship the
overlay **dormant**: no bubble, no hint, no key listeners — the page looks
untouched. A reviewer turns it on by appending **`?=annotate`** to the URL
(e.g. `my-app.vercel.app/?=annotate`):

- **Sticky** — activation is stored in `localStorage` (per origin), so it
  survives reloads and carries across every page of the app.
- **Shareable** — sending someone a `?=annotate` link turns it on for them on
  first load.
- **Off switch** — appending `?=annotate-off` clears the flag.

Use this mode for a live app you want to keep looking finished by default —
skip it for decks/reports/one-pagers, which should keep the always-visible
bubble so they're self-explanatory when emailed or shared.

---

## Reprompting your AI with the export

Click **Copy** (or **Download**) once a page has annotations. The markdown
export lists every note grouped by element, e.g.:

```
## button.btn-primary "Get Started"
- Make this bigger and move it above the fold

## p.hero-subtitle
- Shorten this — it's too long
```

Paste that directly into Claude (or any AI coding assistant) alongside the
file it applies to — the notes are already scoped to specific elements, so
the AI doesn't have to guess what you mean.

---

## When to use / skip

**Use** on any standalone HTML page a human will review or give feedback on:
prototypes, one-pagers, decks, reports, AI-generated pages, marketing sites.

**Skip** when the output is markdown, PDF, image, or a non-HTML format.
