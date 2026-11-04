---
name: super-annotator
description: Inline a click-to-annotate overlay into any HTML file so reviewers can leave inline notes, alone or live with their team, and export them as markdown to paste into an AI prompt. Use when the user asks to add feedback/annotation/review capability to a prototype, deck, report, or any standalone HTML page, or to retrofit an existing file with it. HTML only.
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

## Choose a mode first: single-player or multiplayer

Ask once per page (one answer covers every file in a run). Skip the question
when the user already said ("live", "multiplayer", "just me"), when the file
already has an `SM_ANNOTATE_SYNC` block (keep it), or when nobody is there to
ask (use single-player and say so).

| | Single-player (light) | Multiplayer (live) |
|---|---|---|
| Reviewers get | Notes in their own browser. Feedback travels as Markdown export or a saved copy. Works from `file://`, offline, emailed. | Everyone on the page sees each other's comments, replies and resolves live, with names and `Live · N here`. |
| Setup | None. | A relay (see `relay/`), a room name, and a page served over http(s). Anyone with the link can comment, so you also moderate. |
| Pick when | One reviewer, or feedback that comes back to you for the AI. Most pages. | Several people reviewing together: a team review, a client walkthrough, a demo. |

For multiplayer, pick where the relay runs, then add the sync config (or pass
`--sync` / `--room` to `inject-annotate.js`):

1. **Local session:** `npm run demo`-style: `node relay/server.js --root <dir>`
   serves the page with the overlay inlined and the relay on the same origin.
   Nothing to deploy; it lives as long as the process.
2. **Cloudflare:** deploy `relay/cloudflare/` (one Durable Object per room,
   fits the Workers free plan). Pages on other origins must be listed in its
   `ALLOWED_ORIGINS`.
3. **Your own transport:** pass `{ adapter, room }` (see Sync adapter contract).

A `file://` page has no usable origin, so a hosted relay refuses it. For a file
that will be emailed, use single-player.

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

## Multiplayer (opt-in, live comments)

Off by default: with no `SM_ANNOTATE_SYNC` the overlay opens no network
connection. Turn it on above the injected block:

```js
window.SM_ANNOTATE_SYNC = {
  url:  (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/sync',
  room: 'q4-dashboard-review',   // everyone in the same room sees the same threads
};
```

- **Live:** comments, replies, edits, resolves and deletes reach everyone in the room without a reload. `Live · N here` shows who is on the page.
- **Name only:** the first comment, reply or resolve asks for a name, saved in `localStorage`. No account, no email. (An email field plus an unchecked newsletter opt-in exists behind `collectEmail: true` on the page and `COLLECT_EMAIL=on` on the relay, both off.)
- **Ownership:** only the author can edit or delete a thread (the relay enforces it). Anyone can reply or resolve.
- **Crowds:** up to 3 comments on one element fan out as separate pins; more become one `#4 +8` pin that opens a list.
- **Offline-safe:** changes apply locally first and queue while offline; every op is idempotent, so the relay's echo converges.

### Relay

- `relay/server.js`: zero-dependency Node relay (Node 22+), WebSocket at `/sync`, JSON file persistence, optional static hosting that inlines the current `annotator.js`. `npm run demo` starts it with `examples/live-dashboard` (a fictional company) at http://localhost:4620.
- `relay/cloudflare/`: the same room rules (`relay/room-core.js`) as a Cloudflare Worker + SQLite Durable Object per room. `npm install && npm run deploy`. Secrets: `ADMIN_TOKEN` for moderation (`ANNOTATE_RELAY=… ANNOTATE_ADMIN_TOKEN=… ./admin.sh list|delete|reset`).
- Both relays load their reducer from the `sync-protocol` block of `annotator.js`, so client and relay never drift. Limits: 30 ops per 10s per connection; 500 threads, 200 replies per thread and 500 connections per room.

### Sync adapter contract

Pass `{ adapter, room }` instead of `{ url }` to use any transport:

```js
{
  connect({ onMessage, onStatus }),  // onStatus('connecting' | 'live' | 'offline')
  send(op),                          // queue while offline
  identify(identity),                // send { type: 'hello', identity } now and on every reconnect
  resync(),                          // optional: ask for a fresh snapshot
  close(),
}
```

Ops: `note.add`, `note.update`, `note.resolve`, `note.delete`, `reply.add`. The client also sends `join {room}` and `hello {identity}`, and expects `snapshot {notes, viewers, count}`, `op {op, actor}`, `presence {viewers, count}`, `welcome` and `error {code, message}`.

## Phones (automatic)

On a phone-sized screen the overlay switches to pins only. Tapping a pin opens
the whole thread in a near-full-screen sheet; writing uses a full-screen
composer with Save at the top, above the keyboard. Live comments arrive as pins.

---

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
