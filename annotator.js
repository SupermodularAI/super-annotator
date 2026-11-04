/* annotate v2
 * Canonical source: annotator.js in github.com/SupermodularAI/super-annotator
 * Drop inline into any HTML — zero config required.
 *
 * Annotation cards float next to each annotated element (Notion-style).
 * No sidebar. A compact ⋮ panel holds Save Version / export actions.
 *
 * Optional overrides (set before this script runs):
 *   window.SM_ARTEFACT_KEY   — storage key shared across sibling pages
 *   window.SM_ARTEFACT_NAME  — display name in export title
 *   window.SM_REVIEWER_NAME  — reviewer name (skips localStorage lookup)
 *   window.SM_ANNOTATE_PLUGIN — prototype plugin mode: ship dormant, activate
 *                               by appending `=annotate` to the URL (sticky;
 *                               `=annotate-off` turns it off)
 *   window.SM_ANNOTATE_SYNC  : opt-in multiplayer. Omit it and the overlay is
 *                               single-player with no network, exactly as
 *                               before. Set { url: 'ws://host/sync', room }
 *                               for the bundled relay (relay/server.js), or
 *                               { adapter, room } for any custom transport
 *                               (see "Sync adapter contract" in SKILL.md).
 */
(function () {
  'use strict';

  /* ── config ──────────────────────────────────────────────────────── */
  const PAGE   = decodeURIComponent(location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const FOLDER = decodeURIComponent(location.pathname.split('/').slice(0, -1).join('/')) || '/';

  const STORAGE_KEY  = (typeof window.SM_ARTEFACT_KEY === 'string' && window.SM_ARTEFACT_KEY)
    ? 'sm-annotator:' + window.SM_ARTEFACT_KEY
    : 'sm-annotator:' + FOLDER + '/' + PAGE;
  // Version counter persisted per base file (strips _vN suffix) so it advances
  // correctly across sessions and across opening different _vN.html copies.
  const BASE_FILE       = PAGE.replace(/(_v\d+)?\.html$/i, '');
  const VERSION_KEY     = 'sm-annotator-ver:' + FOLDER + '/' + BASE_FILE;
  const FILE_VERSION    = parseInt((PAGE.match(/_v(\d+)\.html$/i) || [])[1] || '0', 10) || 0;
  const REVIEWER_KEY    = 'sm-annotator:reviewer';
  const AVATAR_SEED_KEY = 'sm-annotator:avatar-seed:';
  const CORNER_KEY      = 'sm-annotator:fab-corner';
  // Banner snap spots: 4 corners + 4 edge middles. The banner opens at the
  // bubble's corner; dragging snaps to any of these for the session.
  // Offsets include the device safe-area insets (notch / home indicator on
  // phones with viewport-fit=cover); env() resolves to 0 on desktop.
  const SAFE_T = 'calc(20px + env(safe-area-inset-top, 0px))';
  const SAFE_R = 'calc(20px + env(safe-area-inset-right, 0px))';
  const SAFE_B = 'calc(20px + env(safe-area-inset-bottom, 0px))';
  const SAFE_L = 'calc(20px + env(safe-area-inset-left, 0px))';
  const BANNER_SPOTS = {
    tl: { top: SAFE_T,  left: SAFE_L },
    tc: { top: SAFE_T,  left: '50%',   tx: '-50%' },
    tr: { top: SAFE_T,  right: SAFE_R },
    rc: { right: SAFE_R, top: '50%',   ty: '-50%' },
    br: { bottom: SAFE_B, right: SAFE_R },
    bc: { bottom: SAFE_B, left: '50%', tx: '-50%' },
    bl: { bottom: SAFE_B, left: SAFE_L },
    lc: { left: SAFE_L,  top: '50%',   ty: '-50%' },
  };
  // First-run hint: shown once (baked into the collapsed bubble) until the
  // reviewer dismisses it with × — the choice is remembered per origin so it
  // never nags again.
  const HINT_KEY        = 'sm-annotator:hint-dismissed';

  /* One-click presets offered in the composer so reviewers don't retype
     the most common feedback. Keep to 3 max — they share one row. */
  const QUICK_ACTIONS = ['Delete this', 'Reword this', 'Shorten this'];

  /* Illustrated first-run tour shown in the onboarding coachmark. 5 steps,
     each an inline animated SVG (a looping "gif" that travels with the
     artefact — no external images). Backgrounds are brand yellow so the
     illustration panel stands out from the dark card. Each SVG carries its
     own <style> with UNIQUE per-step prefixes (aobN-*) because inline SVG
     styles are NOT scoped — generic names would leak across slides + page. */
  const ONBOARD_STEPS = [
    { title: '1 · Turn it on', kbd: 'A',
      body: 'Click the lemon bubble in the corner or press A to enter annotate mode — your cursor turns into a crosshair.',
      touchBody: 'Tap the lemon bubble in the corner to enter annotate mode. Tap ✕ on the bar to go back to browsing (e.g. to change slides).',
      svg: `<svg class="annot-onboard-img" viewBox="0 0 400 176" xmlns="http://www.w3.org/2000/svg"><style>
        @keyframes aob1ring{0%{transform:scale(.6);opacity:.6}70%{transform:scale(1.7);opacity:0}100%{opacity:0}}
        @keyframes aob1pop{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
        @keyframes aob1key{0%,55%,100%{transform:translateY(0)}65%{transform:translateY(3px)}}
        .aob1-ring{transform-box:fill-box;transform-origin:center;animation:aob1ring 1.8s ease-out infinite}
        .aob1-bub{transform-box:fill-box;transform-origin:center;animation:aob1pop 1.8s ease-in-out infinite}
        .aob1-key{transform-box:fill-box;transform-origin:center;animation:aob1key 1.8s ease-in-out infinite}
      </style><rect width="400" height="176" fill="#f6ff9a"/><rect x="44" y="22" width="312" height="132" rx="11" fill="#17171a" stroke="#000" stroke-opacity=".12"/><rect x="64" y="46" width="150" height="10" rx="5" fill="#3a3a3a"/><rect x="64" y="70" width="232" height="7" rx="3.5" fill="#2b2b2b"/><rect x="64" y="85" width="196" height="7" rx="3.5" fill="#2b2b2b"/><g class="aob1-key"><rect x="150" y="106" width="34" height="30" rx="7" fill="#242424" stroke="#f6ff9a" stroke-width="1.5"/><text x="167" y="127" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="700" fill="#f6ff9a" text-anchor="middle">A</text></g><circle class="aob1-ring" cx="320" cy="118" r="19" fill="#f6ff9a" fill-opacity=".55"/><g class="aob1-bub"><circle cx="320" cy="118" r="18" fill="#f6ff9a"/><path d="M311 116a8 8 0 0 1 16 0 7.6 7.6 0 0 1-8 7.5 8 8 0 0 1-3.4-.8l-4 1.1 1.1-3.4a7.5 7.5 0 0 1-1.7-4.4z" fill="#17171a"/></g></svg>` },
    { title: '2 · Click anything', touchTitle: '2 · Tap anything',
      body: 'Click any heading, paragraph, image, or card on the page to attach a note exactly where it matters.',
      touchBody: 'Tap any heading, paragraph, image, or card on the page to attach a note exactly where it matters.',
      svg: `<svg class="annot-onboard-img" viewBox="0 0 400 176" xmlns="http://www.w3.org/2000/svg"><style>
        @keyframes aob2hi{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes aob2cur{0%,100%{transform:translate(2px,2px)}50%{transform:translate(-3px,-3px)}}
        @keyframes aob2rip{0%{transform:scale(.4);opacity:.8}80%{transform:scale(2.4);opacity:0}100%{opacity:0}}
        .aob2-hi{animation:aob2hi 1.6s ease-in-out infinite}
        .aob2-cur{transform-box:fill-box;transform-origin:center;animation:aob2cur 1.6s ease-in-out infinite}
        .aob2-rip{transform-box:fill-box;transform-origin:center;animation:aob2rip 1.6s ease-out infinite}
      </style><rect width="400" height="176" fill="#f6ff9a"/><rect x="44" y="22" width="312" height="132" rx="11" fill="#17171a" stroke="#000" stroke-opacity=".12"/><rect x="64" y="44" width="150" height="9" rx="4.5" fill="#3a3a3a"/><rect class="aob2-hi" x="60" y="72" width="280" height="42" rx="7" fill="#f6ff9a" fill-opacity=".14" stroke="#f6ff9a" stroke-width="1.5" stroke-dasharray="6 4"/><rect x="74" y="85" width="220" height="6" rx="3" fill="#6f6f3c"/><rect x="74" y="98" width="168" height="6" rx="3" fill="#6f6f3c"/><circle class="aob2-rip" cx="298" cy="104" r="7" fill="none" stroke="#f6ff9a" stroke-width="2"/><path class="aob2-cur" d="M298 104l30 12-12 4-4 12z" fill="#fff" stroke="#17171a" stroke-width="1.5" stroke-linejoin="round"/></svg>` },
    { title: '3 · Write your note',
      body: 'Type your feedback. Quick chips — Delete / Reword / Shorten — prefill the most common asks so you can fire off notes fast.',
      svg: `<svg class="annot-onboard-img" viewBox="0 0 400 176" xmlns="http://www.w3.org/2000/svg"><style>
        @keyframes aob3type{0%,10%{width:0}55%,100%{width:128px}}
        @keyframes aob3send{0%,60%,100%{transform:scale(1)}75%{transform:scale(1.15)}}
        .aob3-line{animation:aob3type 2.2s ease-in-out infinite}
        .aob3-send{transform-box:fill-box;transform-origin:center;animation:aob3send 2.2s ease-in-out infinite}
      </style><rect width="400" height="176" fill="#f6ff9a"/><rect x="96" y="26" width="208" height="124" rx="12" fill="#17171a" stroke="#000" stroke-opacity=".12"/><rect x="112" y="42" width="120" height="7" rx="3.5" fill="#3a3a3a"/><rect x="112" y="58" width="176" height="40" rx="7" fill="#0f0f0f" stroke="#3c3c3c"/><rect class="aob3-line" x="122" y="70" width="128" height="6" rx="3" fill="#cfcf8a"/><rect x="112" y="106" width="44" height="16" rx="8" fill="#242424" stroke="#3c3c3c"/><rect x="160" y="106" width="48" height="16" rx="8" fill="#242424" stroke="#3c3c3c"/><rect x="212" y="106" width="52" height="16" rx="8" fill="#242424" stroke="#3c3c3c"/><g class="aob3-send"><rect x="248" y="128" width="40" height="15" rx="7.5" fill="#f6ff9a"/></g></svg>` },
    { title: '4 · Notes live in the margin',
      body: 'Each note becomes a card beside its element. Reply in a thread, edit it, or tick the check to resolve.',
      touchBody: 'Each note gets a numbered badge on its element. Tap the badge to open the note, reply, edit, or resolve it.',
      svg: `<svg class="annot-onboard-img" viewBox="0 0 400 176" xmlns="http://www.w3.org/2000/svg"><style>
        @keyframes aob4badge{0%,12%{transform:scale(0)}28%{transform:scale(1.25)}40%,100%{transform:scale(1)}}
        @keyframes aob4card{0%,12%{transform:translateX(14px);opacity:0}34%,100%{transform:translateX(0);opacity:1}}
        @keyframes aob4check{0%,55%{stroke-dashoffset:14}75%,100%{stroke-dashoffset:0}}
        .aob4-badge{transform-box:fill-box;transform-origin:center;animation:aob4badge 2.4s ease-in-out infinite}
        .aob4-card{transform-box:fill-box;transform-origin:center;animation:aob4card 2.4s ease-in-out infinite}
        .aob4-check{stroke-dasharray:14;animation:aob4check 2.4s ease-in-out infinite}
      </style><rect width="400" height="176" fill="#f6ff9a"/><rect x="34" y="24" width="210" height="128" rx="11" fill="#17171a" stroke="#000" stroke-opacity=".12"/><rect x="52" y="46" width="150" height="9" rx="4.5" fill="#3a3a3a"/><rect x="52" y="84" width="150" height="14" rx="4" fill="#f6ff9a" fill-opacity=".18"/><rect x="52" y="112" width="160" height="6" rx="3" fill="#2b2b2b"/><rect x="52" y="126" width="120" height="6" rx="3" fill="#2b2b2b"/><g class="aob4-badge"><circle cx="202" cy="91" r="10" fill="#f6ff9a"/><text x="202" y="95" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700" fill="#17171a" text-anchor="middle">1</text></g><g class="aob4-card"><rect x="266" y="40" width="104" height="100" rx="10" fill="#1d1d1d" stroke="#3c3c3c"/><circle cx="284" cy="60" r="9" fill="#f6ff9a"/><rect x="299" y="54" width="44" height="6" rx="3" fill="#3a3a3a"/><rect x="299" y="64" width="26" height="5" rx="2.5" fill="#2b2b2b"/><rect x="280" y="82" width="76" height="5" rx="2.5" fill="#3a3a3a"/><rect x="280" y="92" width="62" height="5" rx="2.5" fill="#3a3a3a"/><circle cx="350" cy="122" r="9" fill="none" stroke="#64de3c" stroke-width="1.5"/><path class="aob4-check" d="M346 122l3 3 5-6" fill="none" stroke="#64de3c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g></svg>` },
    { title: '5 · Hand off your feedback',
      body: 'Copy or export every note as Markdown to paste into your AI assistant — or save a versioned snapshot to share for review.',
      touchBody: 'Tap the share icon on the bar to copy your notes, or send them as a Markdown file from your phone’s share sheet.',
      svg: `<svg class="annot-onboard-img" viewBox="0 0 400 176" xmlns="http://www.w3.org/2000/svg"><style>
        @keyframes aob5flow{to{stroke-dashoffset:-24}}
        @keyframes aob5twk{0%,100%{transform:scale(.7);opacity:.5}50%{transform:scale(1.1);opacity:1}}
        .aob5-flow{stroke-dasharray:6 6;animation:aob5flow 1s linear infinite}
        .aob5-twk{transform-box:fill-box;transform-origin:center;animation:aob5twk 1.6s ease-in-out infinite}
      </style><rect width="400" height="176" fill="#f6ff9a"/><rect x="34" y="44" width="120" height="88" rx="11" fill="#1d1d1d" stroke="#3c3c3c"/><circle cx="54" cy="64" r="8" fill="#f6ff9a"/><rect x="68" y="59" width="62" height="6" rx="3" fill="#3a3a3a"/><rect x="52" y="82" width="88" height="5" rx="2.5" fill="#3a3a3a"/><rect x="52" y="92" width="74" height="5" rx="2.5" fill="#3a3a3a"/><rect x="52" y="102" width="82" height="5" rx="2.5" fill="#2b2b2b"/><path class="aob5-flow" d="M168 89h54" stroke="#17171a" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M220 82l9 7-9 7z" fill="#17171a"/><rect x="246" y="46" width="80" height="92" rx="10" fill="#17171a" stroke="#000" stroke-opacity=".12"/><text x="286" y="84" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="800" fill="#f6ff9a" text-anchor="middle">.md</text><rect x="262" y="100" width="48" height="5" rx="2.5" fill="#2b2b2b"/><rect x="262" y="110" width="34" height="5" rx="2.5" fill="#2b2b2b"/><path class="aob5-twk" d="M350 58l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#17171a"/></svg>` },
  ];

  /* ── safe storage ────────────────────────────────────────────────────
     Sandboxed viewers (Teams/SharePoint/intranet HTML previews) throw
     SecurityError on any localStorage access, and writes can throw
     QuotaExceededError. Fall back to an in-memory Map so the overlay still
     works — notes just don't survive a reload — and warn once on the first
     write that doesn't persist. */
  const store = (() => {
    let mem = null;      // Map fallback when persistent storage is unavailable
    let warned = false;
    function fallback() {
      if (!mem) mem = new Map();
      if (!warned) {
        warned = true;
        try { toast("Notes won't persist here — storage is blocked in this view"); } catch {}
      }
    }
    try { localStorage.getItem('sm-annotator:probe'); }
    catch { mem = new Map(); }   // denied at boot: silent fallback, warn on first write
    return {
      get(k) {
        if (mem) return mem.has(k) ? mem.get(k) : null;
        try { return localStorage.getItem(k); } catch { fallback(); return null; }
      },
      set(k, v) {
        v = String(v);
        if (mem) { fallback(); mem.set(k, v); return; }
        try { localStorage.setItem(k, v); } catch { fallback(); mem.set(k, v); }
      },
    };
  })();

  /* ── prototype plugin activation ───────────────────────────────────────
     In a prototype the annotator ships pre-installed but DORMANT: set
     window.SM_ANNOTATE_PLUGIN = true before this script and nothing renders
     (no bubble, no hint, no key listeners) until a reviewer appends
     `=annotate` to the URL. The choice is sticky (localStorage, per origin) so
     it carries across page navigation and reloads; `=annotate-off` turns it
     back off. Standalone artefacts (decks, one-pagers, reports) leave the flag
     unset and keep the default always-visible bubble. */
  const PLUGIN_MODE = !!(typeof window !== 'undefined' && window.SM_ANNOTATE_PLUGIN);
  const PLUGIN_ACTIVE_KEY = 'sm-annotator:plugin-active';
  if (PLUGIN_MODE) {
    const href = String((typeof location !== 'undefined' && location.href) || '');
    if (/=annotate-off\b/i.test(href))   store.set(PLUGIN_ACTIVE_KEY, '0');
    else if (/=annotate\b/i.test(href))  store.set(PLUGIN_ACTIVE_KEY, '1');
    // Strip the marker from the address bar so the localStorage flag is the
    // single source of truth and shared links don't re-toggle every visit.
    try {
      if (/=annotate(-off)?\b/i.test(href) && typeof history !== 'undefined' && history.replaceState) {
        let cleaned = href.replace(/[?#&]=annotate(-off)?\b/ig, '');
        cleaned = cleaned.replace(/\?&/, '?').replace(/[?#&]$/, '');
        history.replaceState(null, '', cleaned);
      }
    } catch (e) {}
  }
  // Dormant: render nothing, attach no listeners, leave the prototype untouched.
  if (PLUGIN_MODE && store.get(PLUGIN_ACTIVE_KEY) !== '1') return;

  const ARTEFACT_NAME = (typeof window.SM_ARTEFACT_NAME === 'string' && window.SM_ARTEFACT_NAME)
    ? window.SM_ARTEFACT_NAME
    : deriveArtefactName();

  const PAGE_TITLE = (document.title || PAGE).replace(/\s*[—·|–-]\s*.*$/, '').trim() || PAGE;
  const isMac      = /mac|iphone|ipad|ipod/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || ''
  );
  // Touch-first device (phone / tablet): no hover, coarse pointer. Drives the
  // tap wording, always-visible actions and the share-sheet export. Desktop
  // (mouse) behaviour is unchanged.
  const mq = (q) => { try { return typeof window.matchMedia === 'function' && window.matchMedia(q).matches; } catch { return false; } };
  const IS_TOUCH = mq('(hover: none) and (pointer: coarse)');
  // Compact layout = phone-sized viewport: the composer and note cards become
  // bottom sheets pinned above the on-screen keyboard instead of floating
  // popovers / margin cards (there is no margin on a 390px screen).
  function isCompact() {
    const w = window.innerWidth || 0, h = window.innerHeight || 0;
    if (w <= 600 || (IS_TOUCH && Math.min(w, h) <= 600)) return true;
    // A page wider than the phone makes the browser zoom out, so innerWidth
    // can read 900+ on a 390px screen. On touch, trust the device screen.
    const sw = (window.screen && window.screen.width) || 0, sh = (window.screen && window.screen.height) || 0;
    return IS_TOUCH && sw > 0 && Math.min(sw, sh) <= 600;
  }
  // Last pointer type seen — a tap fires emulated mouseenter/hover, which must
  // not trigger hover-only affordances (tooltips, badge delete ×).
  let lastPointerType = IS_TOUCH ? 'touch' : 'mouse';
  /* ── state ───────────────────────────────────────────────────────── */
  let mode         = false;
  let actionsOpen  = false;
  let activePopup  = null;
  let activeModal  = null;
  let uiCollapsed  = false;
  let uiHidden     = false;
  let onboardingEls = null, onboardingIndex = 0;
  let savedVersion  = parseInt(store.get(VERSION_KEY) || '0', 10) || 0;
  let savedAnnotIds = null;
  let reviewerName = loadReviewerName();
  let nameSet      = !!store.get(REVIEWER_KEY) ||
                     !!(typeof window.SM_REVIEWER_NAME === 'string' && window.SM_REVIEWER_NAME);
  // IDs of notes + replies authored in *this* page session. Renaming the
  // reviewer in Options retroactively re-stamps the author on only these —
  // never notes from a previous session or written by other reviewers.
  const sessionNoteIds = new Set();

  /* ── multiplayer (opt-in) ────────────────────────────────────────────
     With no window.SM_ANNOTATE_SYNC this whole block is inert: SYNC is null,
     no socket is opened, no identity gate is shown, and notes live in
     localStorage under STORAGE_KEY exactly as in single-player.
     With sync on, the server is the source of truth. localStorage keeps only
     a per-room cache (so a reload paints instantly) plus the viewer's own
     identity. Other viewers only ever receive the name, never the email. */
  const IDENTITY_KEY = 'sm-annotator:identity';
  const SYNC_CFG = resolveSyncAdapter(
    typeof window.SM_ANNOTATE_SYNC === 'object' ? window.SM_ANNOTATE_SYNC : null,
    { defaultRoom: STORAGE_KEY.replace(/^sm-annotator:/, '') }
  );
  const SYNC      = SYNC_CFG ? SYNC_CFG.adapter : null;
  const LIVE_KEY  = SYNC ? 'sm-annotator:sync-cache:' + SYNC_CFG.room : STORAGE_KEY;
  const COLLECT_EMAIL = !!(SYNC_CFG && SYNC_CFG.collectEmail);
  let identity    = SYNC ? loadIdentity() : null;
  let syncStatus  = 'offline';
  let viewers     = [];
  let snapshotSeen = false;
  let expandedOnce = false;   // auto-expand for notes happens once; after that the viewer's collapse sticks
  if (identity) { reviewerName = identity.name; nameSet = true; }

  const { frozenAnnotations, frozenVersion } = loadFrozen();
  let annotations = loadLive();

  /* ── styles ──────────────────────────────────────────────────────── */
  const css = `
    :root {
      --sm-brand:  #f6ff9a;
      --sm-bg:     #000000;
      --sm-bg-1:   #191919;
      --sm-bg-2:   #2d2d2d;
      --sm-border: #3c3c3c;
      --sm-border-strong: #6b6b6b;
      --sm-text:   #ffffff;
      --sm-text-2: #f2f2f2;
      --sm-muted:  #cccccc;   /* DS muted-foreground (neutral-300) */
      --sm-subtle: #6b6b6b;   /* DS text-muted (neutral-500) */
      --sm-danger: #f04758;
      --sm-success: #64de3c;
      /* Brand type: Denim INK for text, Aeonik Fono for code. Hosts that do
         not load the brand fonts fall back to the system UI font. */
      --sm-sans: 'Denim INK', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --sm-mono: 'Aeonik Fono', ui-monospace, Menlo, Monaco, Consolas, monospace;
    }

    /* ── annotate-mode banner ──
       Collapsed = one draggable chat icon. Expanded (annotate mode) = a
       draggable pill banner: "● Annotate Mode Enabled" + ⋮ comments/options
       + ✕ exit. Snaps to 4 corners + 4 edge middles. */
    .annot-fab-row {
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      z-index: 999998;
      display: flex; align-items: center; gap: 4px;
      padding: 6px 8px 6px 14px;
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,0.45);
      cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
      transition: box-shadow 0.15s ease;
    }
    .annot-fab-row.dragging {
      cursor: grabbing; transition: none;
      box-shadow: 0 12px 38px rgba(0,0,0,0.6);
    }
    .annot-banner-label {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: var(--sm-sans);
      font-size: 13px; font-weight: 600; letter-spacing: -0.01em;
      color: var(--sm-text); white-space: nowrap; padding-right: 6px;
      pointer-events: none;
    }
    .annot-banner-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      background: var(--sm-brand); box-shadow: 0 0 0 3px rgba(246,255,154,0.18);
      animation: annot-banner-pulse 2s ease-in-out infinite;
    }
    @keyframes annot-banner-pulse {
      0%,100% { box-shadow: 0 0 0 3px rgba(246,255,154,0.18); }
      50%     { box-shadow: 0 0 0 5px rgba(246,255,154,0.05); }
    }
    .annot-banner-btn {
      width: 30px; height: 30px; padding: 0; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: transparent; color: var(--sm-text-2);
      border: 1px solid transparent; cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .annot-banner-btn:hover { background: var(--sm-bg-2); color: var(--sm-text); }
    .annot-banner-btn svg { width: 16px; height: 16px; display: block; pointer-events: none; }
    .annot-banner-btn.exit:hover { color: var(--sm-danger); border-color: var(--sm-danger); background: var(--sm-bg-2); }
    .annot-banner-btn.open { background: var(--sm-brand); color: var(--sm-bg); border-color: var(--sm-brand); }
    .annot-banner-btn:focus { outline: none; }

    /* ── actions panel ── */
    .annot-actions-panel {
      position: fixed; right: 20px; bottom: 160px; z-index: 999997;
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 12px; padding: 10px 12px;
      font-family: var(--sm-sans);
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; gap: 6px;
      min-width: 200px; max-width: 280px; width: max-content;
      transform-origin: bottom right;
      animation: annot-panel-in 0.15s ease;
    }
    @keyframes annot-panel-in {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    .annot-panel-row {
      display: flex; align-items: center; gap: 8px;
    }
    .annot-panel-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sm-muted);
      padding-bottom: 4px; border-bottom: 1px solid var(--sm-bg-2);
    }
    .annot-reviewer-input {
      flex: 1; background: var(--sm-bg); color: var(--sm-text);
      border: 1px solid var(--sm-border); border-radius: 5px;
      padding: 5px 8px; font-size: 12px; font-family: var(--sm-sans);
      outline: none;
    }
    .annot-reviewer-input:focus { border-color: var(--sm-brand); }
    .annot-reviewer-avatar {
      border-radius: 50%; flex-shrink: 0; display: block;
      transition: transform 0.15s ease;
    }
    .annot-avatar-btn {
      position: relative; flex-shrink: 0; cursor: pointer;
      border-radius: 50%; border: none; background: none; padding: 0;
      display: block; transition: transform 0.15s ease;
    }
    .annot-avatar-btn:hover { transform: scale(1.1); }
    .annot-avatar-btn::after {
      content: '↻';
      position: absolute; inset: 0; border-radius: 50%;
      background: rgba(0,0,0,0.55); color: #fff;
      font-size: 13px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.15s ease;
    }
    .annot-avatar-btn:hover::after { opacity: 1; }
    .annot-panel-actions { display: flex; flex-direction: column; gap: 6px; }
    .annot-panel-actions-row { display: flex; gap: 4px; }
    .annot-panel-actions-row + .annot-panel-actions-row {
      padding-top: 6px; border-top: 1px solid var(--sm-bg-2);
    }
    .annot-panel-actions-row .annot-btn-mini { flex: 1; justify-content: center; }

    /* ── ⋮ menu options (one per line) ── */
    .annot-menu-items {
      display: flex; flex-direction: column; gap: 2px;
      margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--sm-bg-2);
    }
    .annot-menu-item {
      font-family: var(--sm-sans); font-size: 13px; font-weight: 500;
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      width: 100%; text-align: left;
      background: none; border: none; color: var(--sm-text-2);
      padding: 8px; border-radius: 7px; cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .annot-menu-item:hover { background: var(--sm-bg-2); color: var(--sm-text); }
    .annot-menu-item .annot-kbd { margin-left: 0; }
    .annot-menu-item.danger { color: var(--sm-danger); }
    .annot-menu-item.danger:hover { background: rgba(240,71,88,0.15); color: var(--sm-danger); }

    /* ── hover tooltip (FABs) ── */
    .annot-tooltip {
      position: fixed; z-index: 1000001; pointer-events: none;
      display: flex; align-items: center; gap: 6px;
      background: var(--sm-bg-1); color: var(--sm-text-2);
      border: 1px solid var(--sm-border); border-radius: 7px;
      padding: 5px 8px; font-family: var(--sm-sans); font-size: 11.5px; font-weight: 600;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5); white-space: nowrap;
    }
    .annot-tooltip .annot-kbd { margin-left: 0; }

    /* ── confirmation modal ── */
    .annot-modal-overlay {
      position: fixed; inset: 0; z-index: 1000002;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      animation: annot-panel-in 0.12s ease;
    }
    .annot-modal {
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 14px; padding: 20px; width: 320px; max-width: calc(100vw - 40px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.6); font-family: var(--sm-sans);
    }
    .annot-modal-title { font-size: 15px; font-weight: 700; color: var(--sm-text); }
    .annot-modal-body  { font-size: 12.5px; color: var(--sm-muted); margin-top: 8px; line-height: 1.5; }
    .annot-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

    /* ── identity gate (multiplayer only) ── */
    .annot-gate { width: 360px; display: block; margin: 0; }
    .annot-gate-field { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
    .annot-gate-label { font-size: 11.5px; font-weight: 600; color: var(--sm-text-2); }
    .annot-gate-input {
      background: var(--sm-bg); color: var(--sm-text); border: 1px solid var(--sm-border);
      border-radius: 10px; padding: 9px 11px; font: inherit; font-size: 13px; outline: none;
    }
    .annot-gate-input:focus { border-color: var(--sm-brand); }
    .annot-gate-field.invalid .annot-gate-input { border-color: var(--sm-danger); }
    .annot-gate-error { font-size: 11.5px; color: #fe9da7; min-height: 0; }
    .annot-gate-error:empty { display: none; }
    .annot-gate-consent {
      display: flex; align-items: flex-start; gap: 9px; margin-top: 16px;
      font-size: 12px; line-height: 1.45; color: var(--sm-muted);
    }
    .annot-gate-checkbox { margin: 2px 0 0; accent-color: var(--sm-brand); width: 14px; height: 14px; flex-shrink: 0; }
    .annot-gate-privacy { margin-top: 10px; font-size: 11.5px; line-height: 1.45; color: var(--sm-muted); }
    .annot-gate-privacy a { color: var(--sm-brand); }
    body.annot-mode .annot-gate-input { cursor: text !important; }

    /* ── live chip (multiplayer only) ── */
    .annot-live-chip {
      display: inline-flex; align-items: center; margin-right: 4px;
      padding: 3px 9px; border: 1px solid var(--sm-border); border-radius: 999px;
      font-family: var(--sm-sans); font-size: 11px; font-weight: 600;
      color: var(--sm-muted); white-space: nowrap; pointer-events: auto;
    }
    .annot-live-chip::before { content: ''; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--sm-border-strong); }
    .annot-live-chip[data-status="live"] { color: var(--sm-text-2); }
    .annot-live-chip[data-status="live"]::before { background: #64de3c; }
    .annot-live-chip[data-status="offline"]::before { background: var(--sm-danger); }

    /* ── annotate mode ── */
    body.annot-mode * { cursor: crosshair !important; }
    body.annot-mode .annot-banner-btn,
    body.annot-mode .annot-actions-btn,
    body.annot-mode .annot-actions-panel,
    body.annot-mode .annot-actions-panel *,
    body.annot-mode .annot-popup, body.annot-mode .annot-popup *,
    body.annot-mode .annot-badge,
    body.annot-mode .annot-card, body.annot-mode .annot-card *,
    body.annot-mode .annot-card-menu, body.annot-mode .annot-card-menu *,
    body.annot-mode .annot-confirm-pop, body.annot-mode .annot-confirm-pop *,
    body.annot-mode .annot-stack-list, body.annot-mode .annot-stack-list *,
    body.annot-mode .annot-modal, body.annot-mode .annot-modal * { cursor: pointer !important; }
    body.annot-mode .annot-path-copier, body.annot-mode .annot-path-copier * { cursor: pointer !important; pointer-events: auto !important; }
    body.annot-mode .annot-fab-row { cursor: grab !important; }
    body.annot-mode .annot-fab-row.dragging { cursor: grabbing !important; }
    body.annot-mode a, body.annot-mode button { pointer-events: none; }
    body.annot-mode .annot-fab-row, body.annot-mode .annot-fab-row *,
    body.annot-mode .annot-banner-btn,
    body.annot-mode .annot-actions-btn,
    body.annot-mode .annot-actions-panel button,
    body.annot-mode .annot-popup button,
    body.annot-mode .annot-badge,
    body.annot-mode .annot-card button,
    body.annot-mode .annot-card-menu,
    body.annot-mode .annot-card-menu button,
    body.annot-mode .annot-confirm-pop, body.annot-mode .annot-confirm-pop *,
    body.annot-mode .annot-stack-list, body.annot-mode .annot-stack-list *,
    body.annot-mode .annot-modal, body.annot-mode .annot-modal * { pointer-events: auto; }

    .annot-hover {
      outline: 2px dashed var(--sm-brand) !important;
      outline-offset: 2px !important;
      background: rgba(246,255,154,0.05) !important;
    }

    /* ── badges ── */
    .annot-badge {
      position: absolute; z-index: 999990;
      min-width: 22px; height: 20px; padding: 0 6px;
      background: var(--sm-brand); color: var(--sm-bg);
      border-radius: 999px;
      font-family: var(--sm-mono); font-size: 10px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; gap: 2px;
      cursor: pointer; pointer-events: auto;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      border: 1.5px solid var(--sm-bg);
      transition: transform 0.1s ease;
    }
    .annot-badge:hover { transform: scale(1.15); }
    .annot-badge.frozen { background: var(--sm-bg-2); color: var(--sm-muted); border-color: var(--sm-border); }
    .annot-badge.resolved { opacity: 0.4; filter: grayscale(1); }
    .annot-badge-del {
      display: none; color: inherit;
      font-size: 12px; font-weight: 700; line-height: 1;
    }
    .annot-badge:not(.frozen):hover .annot-badge-num { display: none; }
    .annot-badge:not(.frozen):hover .annot-badge-del { display: inline; }

    .annot-badge-more { opacity: .7; font-weight: 500; }
    .annot-badge-stack:hover .annot-badge-num { display: inline !important; }
    /* ── stack list (the threads behind a "#4 +8" pin) ── */
    .annot-stack-list {
      position: fixed; z-index: 1000001; width: 320px; max-height: min(420px, 70vh);
      display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;
      background: var(--sm-bg-1); color: var(--sm-text);
      border: 1px solid var(--sm-border); border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: var(--sm-sans);
    }
    .annot-stack-list.annot-stack-sheet {
      width: auto; max-height: none; z-index: 1000000;
      box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .55);
    }
    .annot-stack-bar {
      flex-shrink: 0; display: flex; align-items: center; gap: 8px;
      padding: 4px 4px 4px 16px; min-height: 48px; box-sizing: border-box;
      border-bottom: 1px solid var(--sm-border);
    }
    .annot-stack-sheet .annot-stack-bar { min-height: 52px; padding-right: 6px; }
    .annot-stack-close {
      flex-shrink: 0; width: 40px; height: 40px; padding: 0; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      background: none; border: none; color: var(--sm-text);
    }
    .annot-stack-close svg { width: 20px; height: 20px; display: block; }
    .annot-stack-rows { overflow-y: auto; overscroll-behavior: contain; padding: 4px; }
    .annot-stack-row {
      display: block; width: 100%; text-align: left; cursor: pointer;
      background: none; border: none; border-radius: 12px; padding: 10px 12px;
      color: var(--sm-text); font-family: var(--sm-sans);
    }
    .annot-stack-row:hover, .annot-stack-row:focus-visible { background: var(--sm-bg-2); outline: none; }
    .annot-stack-row.resolved { opacity: .55; }
    .annot-stack-head { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
    .annot-stack-num { font-family: var(--sm-mono); color: var(--sm-brand); font-weight: 700; }
    .annot-stack-author { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .annot-stack-meta { color: var(--sm-muted); margin-left: auto; white-space: nowrap; }
    .annot-stack-meta + .annot-stack-meta { margin-left: 0; }
    .annot-stack-text {
      margin-top: 4px; font-size: 14px; line-height: 1.4; color: var(--sm-text-2, var(--sm-text));
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .annot-stack-sheet .annot-stack-row { padding: 12px; }

    /* ── annotation cards ──
       On the supermodular.ai design system: Denim INK, the 12/14px text
       scale, neutral surfaces, one lemon accent, 1.5px line icons, 16px
       component radius, no glow. */
    .annot-card {
      position: absolute; right: 20px; z-index: 999989;
      width: 296px; box-sizing: border-box;
      background: var(--sm-bg-1); color: var(--sm-text);
      border: 1px solid var(--sm-border); border-radius: 16px;
      padding: 14px 16px;
      font-family: var(--sm-sans); font-size: 14px; line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      transition: border-color 0.15s ease, opacity 0.2s ease, transform 0.2s ease;
    }
    .annot-card:hover { border-color: var(--sm-border-strong); }
    .annot-card.focused {
      border-color: var(--sm-brand);
      transform: translateX(-4px);
      z-index: 999991;
    }
    body.annot-has-focus .annot-card:not(.focused) { opacity: 0.35; }
    .annot-card.frozen { border-left: 2px solid var(--sm-border-strong); }
    .annot-card.resolved { opacity: 0.5; }
    /* Orphaned: the note is intact but its element is no longer on the page.
       Dashed border so it reads as "floating" rather than broken. */
    .annot-card.orphaned { border-style: dashed; border-color: var(--sm-border-strong); }
    .annot-orphan-note {
      display: flex; align-items: flex-start; gap: 8px;
      margin: 0 0 10px; padding: 8px 10px; border-radius: 8px;
      background: rgba(240,71,88,0.08);
      border: 1px solid rgba(254,157,167,0.30);
      color: var(--sm-text-2); font-size: 12px; line-height: 1.5;
    }
    .annot-orphan-note svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px; }
    .annot-orphan-note code {
      display: block; margin-top: 2px; font-family: var(--sm-mono);
      font-size: 12px; color: var(--sm-muted); word-break: break-all;
    }

    /* Annotated elements keep their own surface: the pin marks them. While
       a thread is hovered or open, a thin brand outline shows which one. */
    .annot-target.annot-target-active {
      outline: 1px solid rgba(246,255,154,0.8) !important;
      outline-offset: 3px !important;
      transition: outline-color 0.2s ease;
    }
    .annot-card-head {
      display: flex; align-items: center; gap: 8px; min-height: 28px;
    }
    .annot-card-author {
      font-size: 14px; font-weight: 500; color: var(--sm-text); flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .annot-card-time {
      font-size: 12px; color: var(--sm-subtle); white-space: nowrap;
    }
    .annot-card-actions {
      display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s ease;
    }
    .annot-card:hover .annot-card-actions { opacity: 1; }
    .annot-card-btn {
      width: 28px; height: 28px; border-radius: 9999px; padding: 0;
      background: none; border: 1px solid transparent;
      color: var(--sm-muted); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
      position: relative;
    }
    .annot-card-btn svg { width: 16px; height: 16px; display: block; }
    .annot-card-btn:hover { background: var(--sm-bg-2); color: var(--sm-text); }
    /* Resolve: a ghost icon button; done = filled lemon (the one accent). */
    .annot-card-btn.resolve { border-color: var(--sm-border); }
    .annot-card-btn.resolve:hover { border-color: var(--sm-brand); color: var(--sm-brand); background: none; }
    .annot-card-btn.resolve.done {
      color: var(--sm-bg); background: var(--sm-brand); border-color: var(--sm-brand);
    }
    /* When resolved, keep the actions row visible so the check reads as state. */
    .annot-card.resolved .annot-card-actions { opacity: 1; }
    .annot-card-body { padding-top: 8px; }
    .annot-card-snippet {
      font-size: 12px; color: var(--sm-subtle); line-height: 1.5;
      margin-bottom: 6px;
      overflow: hidden; display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .annot-card-comment {
      font-size: 14px; color: var(--sm-text); line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
      overflow: hidden; display: -webkit-box;
      -webkit-line-clamp: 4; -webkit-box-orient: vertical;
    }
    .annot-card-comment.expanded { overflow: visible; display: block; }
    .annot-card-more {
      display: inline; background: none; border: none;
      color: var(--sm-muted); font-size: 12px; cursor: pointer;
      padding: 0; font-family: var(--sm-sans); text-decoration: underline; text-underline-offset: 3px;
    }
    .annot-card-more:hover { color: var(--sm-text); }
    .annot-card-divider { border: none; border-top: 1px solid var(--sm-border); margin: 10px 0; }
    .annot-card-reply-item { margin-bottom: 10px; }
    .annot-card-reply-item:last-child { margin-bottom: 0; }
    .annot-reply-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
    .annot-reply-author { font-size: 12px; font-weight: 500; color: var(--sm-text); }
    .annot-reply-time { font-size: 12px; color: var(--sm-subtle); }
    .annot-reply-text {
      font-size: 14px; color: var(--sm-text-2); line-height: 1.5;
      padding-left: 26px; white-space: pre-wrap; word-break: break-word;
    }
    .annot-card-input-row {
      display: flex; align-items: center; gap: 8px;
      margin-top: 12px; padding-top: 12px;
      border-top: 1px solid var(--sm-border);
    }
    .annot-card-input-row input {
      flex: 1; min-width: 0; background: var(--sm-bg); color: var(--sm-text);
      border: 1px solid var(--sm-border); border-radius: 16px;
      padding: 7px 12px; font-size: 14px; line-height: 1.4; font-family: var(--sm-sans);
      outline: none;
    }
    .annot-card-input-row input::placeholder { color: var(--sm-subtle); }
    .annot-card-input-row input:focus { border-color: var(--sm-brand); }
    .annot-card-send {
      width: 32px; height: 32px; border-radius: 9999px; padding: 0;
      background: var(--sm-brand); color: var(--sm-bg);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      transition: opacity 0.1s ease;
    }
    .annot-card-send:hover { opacity: 0.9; }
    .annot-card-send svg { width: 16px; height: 16px; display: block; }
    .annot-card-menu {
      position: fixed; background: var(--sm-bg-1);
      border: 1px solid var(--sm-border); border-radius: 16px;
      padding: 6px; min-width: 188px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 1000001;
    }
    .annot-card-menu-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      background: none; border: none;
      padding: 8px 12px; font-size: 14px; color: var(--sm-text);
      cursor: pointer; border-radius: 10px;
      font-family: var(--sm-sans);
    }
    .annot-card-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; display: block; color: var(--sm-muted); }
    .annot-card-menu-item:hover { background: var(--sm-bg-2); }
    .annot-card-menu-item.danger, .annot-card-menu-item.danger svg { color: var(--sm-danger); }
    .annot-card-menu-item.disabled { color: var(--sm-subtle); cursor: default; pointer-events: none; }


    /* ── tooltip ── */
    [data-tooltip] { position: relative; }
    [data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute; bottom: calc(100% + 5px); left: 50%;
      transform: translateX(-50%);
      background: var(--sm-bg-2); color: var(--sm-text-2);
      border: 1px solid var(--sm-border);
      font-family: var(--sm-sans); font-size: 10px; font-weight: 500;
      white-space: nowrap; padding: 3px 7px; border-radius: 5px;
      pointer-events: none; opacity: 0; transition: opacity 0.12s ease;
      z-index: 1000001;
    }
    [data-tooltip]:hover::after { opacity: 1; }

    /* ── popup ── */
    .annot-popup {
      position: absolute; z-index: 1000000;
      width: 340px;
      background: var(--sm-bg-1);
      border: 1px solid var(--sm-border); border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7);
      font-family: var(--sm-sans); overflow: hidden;
    }
    .annot-popup-header {
      padding: 10px 14px 9px;
      border-bottom: 1px solid var(--sm-border);
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .annot-popup-meta {
      font-family: var(--sm-mono);
      font-size: 10px; color: var(--sm-muted); letter-spacing: 0.04em; flex: 1;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .annot-popup-close {
      background: none; border: none; cursor: pointer;
      color: var(--sm-muted); font-size: 14px; padding: 0; line-height: 1; flex-shrink: 0;
    }
    .annot-popup-close:hover { color: var(--sm-text); }
    .annot-popup-close svg { width: 14px; height: 14px; display: block; }
    .annot-popup-thread {
      padding: 10px 14px 6px; max-height: 200px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 8px;
    }
    .annot-thread-item { padding-left: 10px; border-left: 2px solid var(--sm-border); }
    .annot-thread-item.main { border-left-color: var(--sm-brand); }
    .annot-thread-author {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--sm-brand); margin-bottom: 0;
    }
    .annot-thread-item.reply .annot-thread-author { color: var(--sm-muted); }
    .annot-thread-text {
      font-size: 12.5px; color: var(--sm-text-2); line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
    }
    .annot-thread-time { font-size: 10px; color: var(--sm-muted); }
    .annot-author-row {
      display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
    }
    .annot-author-row .annot-thread-author { margin-bottom: 0; }
    .annot-author-row .annot-thread-time { margin-top: 0; margin-left: auto; }
    .annot-avatar { border-radius: 50%; flex-shrink: 0; display: block; overflow: hidden; }
    .annot-popup-compose { padding: 8px 14px 12px; }
    .annot-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .annot-chip {
      background: var(--sm-bg-2); color: var(--sm-text-2);
      border: 1px solid var(--sm-border); border-radius: 999px;
      font-family: var(--sm-sans);
      font-size: 11px; font-weight: 500; padding: 4px 10px;
      cursor: pointer; transition: border-color 0.15s ease;
    }
    .annot-chip:hover { border-color: var(--sm-brand); color: var(--sm-text); }
    .annot-compose-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sm-muted); margin-bottom: 5px;
    }
    .annot-popup textarea {
      width: 100%; min-height: 70px; resize: vertical;
      background: var(--sm-bg); color: var(--sm-text);
      border: 1px solid var(--sm-border); border-radius: 8px;
      padding: 8px 10px; box-sizing: border-box;
      font-family: var(--sm-sans); font-size: 12.5px; line-height: 1.5; outline: none;
    }
    .annot-popup textarea:focus { border-color: var(--sm-brand); }
    .annot-popup-hint {
      display: flex; align-items: center; gap: 4px;
      font-size: 10px; color: var(--sm-muted); margin-top: 6px;
    }
    .annot-popup-hint .annot-kbd { margin-left: 0; }
    .annot-popup-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
    .annot-popup .annot-popup-actions > * + * { margin-left: 6px; }
    /* inline identity footer — subtle, sits under the note on the first comment */
    .annot-identity-row {
      display: flex; align-items: center; gap: 7px;
      margin-top: 10px; padding-top: 9px;
      border-top: 1px solid var(--sm-border);
    }
    .annot-identity-avatar {
      width: 18px; height: 18px; border-radius: 50%;
      flex-shrink: 0; display: block;
    }
    .annot-identity-label {
      font-size: 11px; color: var(--sm-muted); white-space: nowrap;
    }
    .annot-identity-input {
      flex: 1; min-width: 0;
      background: transparent; color: var(--sm-text);
      border: none; border-bottom: 1px dashed var(--sm-border);
      border-radius: 0; padding: 2px 1px;
      font-family: var(--sm-sans);
      font-size: 11.5px; font-weight: 600; outline: none;
      transition: border-color 0.15s ease;
    }
    .annot-identity-input::placeholder { color: var(--sm-muted); font-weight: 500; }
    .annot-identity-input:hover  { border-bottom-color: var(--sm-border-strong); }
    .annot-identity-input:focus  { border-bottom-style: solid; border-bottom-color: var(--sm-brand); }

    /* ── buttons ── */
    .annot-btn {
      font-family: var(--sm-sans);
      font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em;
      padding: 7px 14px; border-radius: 999px;
      background: var(--sm-bg-2); color: var(--sm-text-2);
      border: 1px solid var(--sm-border); cursor: pointer;
      transition: all 0.12s ease;
      display: flex; align-items: center; white-space: nowrap; outline: none;
    }
    .annot-btn:hover { background: var(--sm-border); border-color: var(--sm-border-strong); }
    .annot-btn-primary { background: var(--sm-brand); color: var(--sm-bg); border-color: var(--sm-brand); }
    .annot-btn-primary:hover { background: #e8f24a; border-color: #e8f24a; }
    .annot-btn-danger { color: var(--sm-danger); }
    .annot-btn-danger:hover { background: rgba(240,71,88,0.1); border-color: var(--sm-danger); }
    .annot-btn-mini { padding: 5px 12px; font-size: 11px; border-radius: 999px; }
    .annot-kbd {
      margin-left: 8px; font-size: 10px; font-weight: 600; letter-spacing: 0;
      font-family: var(--sm-sans);
      color: var(--sm-muted); background: var(--sm-bg);
      border: 1px solid var(--sm-border); border-radius: 3px;
      padding: 1px 5px; display: inline-block; vertical-align: middle;
    }
    .annot-btn-primary .annot-kbd,
    .annot-fab.on .annot-kbd {
      color: rgba(0,0,0,0.55); background: rgba(0,0,0,0.15); border-color: rgba(0,0,0,0.25);
    }

    /* light-page overrides */
    body.annot-light-page .annot-target.annot-target-active { outline-color: rgba(0,0,0,0.55) !important; }
    body.annot-light-page .annot-badge {
      box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 0 0 2px rgba(0,0,0,0.12);
    }

    /* ── toast ── */
    .annot-toast {
      position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
      background: var(--sm-brand); color: var(--sm-bg);
      padding: 9px 16px; border-radius: 999px;
      font-family: var(--sm-sans); font-size: 12px; font-weight: 600;
      z-index: 1000000; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      animation: annot-fade 2.2s ease forwards; white-space: nowrap;
    }
    @keyframes annot-fade {
      0%       { opacity: 0; transform: translate(-50%, 10px); }
      10%, 80% { opacity: 1; transform: translate(-50%, 0); }
      100%     { opacity: 0; transform: translate(-50%, -10px); }
    }

    /* ── collapsed chat FAB (draggable to any corner) ──
       Solid lemon, dark icon — reads as the brand mark, stands out on light
       and dark pages. No glow, no pulse (minimal aesthetic per brand rules). */
    .annot-collapser {
      position: fixed; z-index: 999998; right: 20px; bottom: 20px;
      width: 48px; height: 48px; border-radius: 50%; padding: 0;
      background: var(--sm-brand); color: var(--sm-bg);
      border: 1px solid var(--sm-brand);
      display: flex; align-items: center; justify-content: center;
      cursor: grab; touch-action: none; user-select: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .annot-collapser:hover { background: #e8f24a; }
    .annot-collapser:active, .annot-collapser.dragging { cursor: grabbing; }
    .annot-collapser.dragging { box-shadow: 0 10px 34px rgba(0,0,0,0.55); transition: none; }
    .annot-collapser svg { width: 24px; height: 24px; display: block; pointer-events: none; }

    body.annot-ui-collapsed .annot-fab-row { display: none !important; }
    body:not(.annot-ui-collapsed) .annot-collapser { display: none !important; }

    /* ── Hide Annotate UI (H key / ⋮ menu) ──
       Tuck away *all* annotate chrome so the artefact reads clean; the same
       H shortcut brings it back. */
    body.annot-ui-hidden .annot-fab-row,
    body.annot-ui-hidden .annot-collapser,
    body.annot-ui-hidden .annot-badge,
    body.annot-ui-hidden .annot-card,
    body.annot-ui-hidden .annot-popup,
    body.annot-ui-hidden .annot-actions-panel,
    body.annot-ui-hidden .annot-toast,
    body.annot-ui-hidden .annot-tooltip,
    body.annot-ui-hidden .annot-modal-overlay,
    body.annot-ui-hidden .annot-onboard-overlay,
    body.annot-ui-hidden .annot-onboard-spot,
    body.annot-ui-hidden .annot-onboard-tag,
    body.annot-ui-hidden .annot-onboard-card,
    body.annot-ui-hidden .annot-stack-list,
    body.annot-ui-hidden .annot-path-copier { display: none !important; }

    /* ── first-run onboarding coachmark ──
       Fresh artefacts greet reviewers with a dimmed (20%) overlay that
       spotlights the bubble and walks through what annotate does via a 5-step
       illustrated slider. "Start Annotating" (or × / Skip) dismisses it and
       remembers the choice in localStorage (HINT_KEY) so it never reappears.
       The dim is produced by the spotlight's huge box-shadow, so the bubble
       stays bright while the rest of the page darkens — the overlay literally
       points at the comment bubble. */
    .annot-onboard-overlay {
      position: fixed; inset: 0; z-index: 1000002;
      background: transparent;            /* dim is the spotlight's box-shadow */
      animation: annot-panel-in 0.18s ease;
    }
    .annot-onboard-spot {
      position: fixed; z-index: 1000003; border-radius: 50%;
      background: transparent; cursor: pointer; border: none; padding: 0;
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.2), 0 0 0 4px rgba(246,255,154,0.9);
      animation: annot-spot-pulse 1.8s ease-in-out infinite;
    }
    @keyframes annot-spot-pulse {
      0%,100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.2), 0 0 0 4px  rgba(246,255,154,0.9); }
      50%     { box-shadow: 0 0 0 9999px rgba(0,0,0,0.2), 0 0 0 11px rgba(246,255,154,0.22); }
    }
    .annot-onboard-tag {
      position: fixed; z-index: 1000004; pointer-events: none;
      font-family: var(--sm-sans); font-size: 12px; font-weight: 700;
      color: var(--sm-brand); white-space: nowrap;
      text-shadow: 0 1px 8px rgba(0,0,0,0.9);
      display: flex; align-items: center; gap: 5px;
    }
    .annot-onboard-tag .annot-kbd {
      margin: 0 2px; color: var(--sm-bg); background: var(--sm-brand); border-color: var(--sm-brand);
    }

    .annot-onboard-card {
      position: fixed; z-index: 1000004;
      left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: 460px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
      overflow-y: auto;
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 16px; box-shadow: 0 18px 60px rgba(0,0,0,0.7);
      font-family: var(--sm-sans); color: var(--sm-text);
      animation: annot-onboard-in 0.25s cubic-bezier(0.2,0.9,0.3,1.1);
    }
    @keyframes annot-onboard-in {
      from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)) scale(0.97); }
      to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    .annot-onboard-head { display: flex; align-items: flex-start; gap: 10px; padding: 18px 18px 0; }
    .annot-onboard-titles { flex: 1; min-width: 0; }
    .annot-onboard-title { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
    .annot-onboard-sub   { font-size: 12.5px; color: var(--sm-muted); margin-top: 4px; line-height: 1.5; font-weight: 500; }
    .annot-onboard-x {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: var(--sm-bg-2); color: var(--sm-muted); border: none;
      font-size: 14px; line-height: 1; cursor: pointer; transition: all 0.12s ease;
    }
    .annot-onboard-x:hover { background: var(--sm-border); color: var(--sm-text); }

    .annot-onboard-stage {
      margin: 14px 18px 0; border-radius: 12px; overflow: hidden;
      background: var(--sm-bg); border: 1px solid var(--sm-border);
    }
    .annot-onboard-slide { display: none; }
    .annot-onboard-slide.active { display: block; animation: annot-panel-in 0.22s ease; }
    .annot-onboard-img { display: block; width: 100%; height: auto; }

    .annot-onboard-cap { padding: 13px 18px 0; min-height: 56px; }
    .annot-onboard-cap-title { font-size: 13.5px; font-weight: 700; color: var(--sm-text); display: flex; align-items: center; }
    .annot-onboard-cap-title .annot-kbd { margin-left: 8px; }
    .annot-onboard-cap-body { font-size: 12.5px; color: var(--sm-muted); line-height: 1.55; margin-top: 5px; }

    .annot-onboard-nav { display: flex; align-items: center; gap: 10px; padding: 14px 18px 0; }
    .annot-onboard-dots { display: flex; gap: 6px; flex: 1; justify-content: center; }
    .annot-onboard-dot {
      width: 7px; height: 7px; border-radius: 50%; padding: 0;
      background: var(--sm-border); border: none; cursor: pointer; transition: all 0.15s ease;
    }
    .annot-onboard-dot.active { background: var(--sm-brand); transform: scale(1.3); }
    .annot-onboard-arrow {
      width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--sm-bg-2); color: var(--sm-text-2); border: 1px solid var(--sm-border);
      cursor: pointer; font-size: 15px; transition: all 0.12s ease;
    }
    .annot-onboard-arrow:hover:not(:disabled) { background: var(--sm-border); color: var(--sm-text); }
    .annot-onboard-arrow:disabled { opacity: 0.3; cursor: default; }
    .annot-onboard-arrow svg { width: 16px; height: 16px; display: block; }
    .annot-onboard-x svg { width: 13px; height: 13px; display: block; }

    .annot-onboard-foot { display: flex; align-items: center; gap: 10px; padding: 16px 18px 18px; }
    .annot-onboard-skip {
      background: none; border: none; color: var(--sm-muted);
      font-family: var(--sm-sans); font-size: 12.5px; font-weight: 600;
      cursor: pointer; padding: 8px 4px;
    }
    .annot-onboard-skip:hover { color: var(--sm-text-2); }
    .annot-onboard-foot .annot-onboard-start { margin-left: auto; }

    /* ── inline "Confirm delete?" popover (replaces native confirm) ── */
    .annot-confirm-pop {
      position: fixed; z-index: 1000002;
      display: flex; align-items: center; gap: 8px;
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 10px; padding: 7px 8px 7px 13px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.55);
      font-family: var(--sm-sans);
      animation: annot-panel-in 0.12s ease;
    }
    .annot-confirm-label { font-size: 12.5px; font-weight: 600; color: var(--sm-text); white-space: nowrap; }
    .annot-confirm-pop button {
      font-family: var(--sm-sans); font-size: 12px; font-weight: 600;
      border-radius: 7px; padding: 5px 10px; cursor: pointer;
      border: 1px solid var(--sm-border); white-space: nowrap;
      display: inline-flex; align-items: center; gap: 5px;
    }
    .annot-confirm-no { background: transparent; color: var(--sm-text-2); }
    .annot-confirm-no:hover { background: var(--sm-bg-2); color: var(--sm-text); }
    .annot-confirm-yes { background: var(--sm-danger); color: #fff; border-color: var(--sm-danger); }
    .annot-confirm-yes:hover { filter: brightness(1.08); }
    .annot-confirm-yes svg { width: 13px; height: 13px; display: block; }

    /* ── path copier pill (annotate-mode hover) ── */
    .annot-path-copier {
      position: fixed; z-index: 999996;
      display: none; align-items: center; gap: 5px;
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 6px; padding: 3px 8px 3px 6px;
      font-family: var(--sm-mono); font-size: 10px; font-weight: 500;
      color: var(--sm-muted); white-space: nowrap;
      box-shadow: 0 2px 10px rgba(0,0,0,0.45);
      pointer-events: auto; cursor: pointer;
      max-width: 260px; overflow: hidden; text-overflow: ellipsis;
      transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
    }
    .annot-path-copier:hover { background: var(--sm-brand); color: var(--sm-bg); border-color: var(--sm-brand); }
    .annot-path-copier svg { width: 11px; height: 11px; display: block; flex-shrink: 0; }

    /* ── element-ID chip (editor header + card body) ──
       The structural element reference, shown inline so a reviewer knows exactly
       which node a note is anchored to. Click copies the full class-free path. */
    .annot-el-id {
      display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
      font-family: var(--sm-mono); font-size: 12px; line-height: 1.4;
      color: var(--sm-muted); background: var(--sm-bg);
      border: 1px solid var(--sm-border); border-radius: 8px;
      padding: 2px 8px 2px 6px; cursor: pointer; vertical-align: middle;
      overflow: hidden; white-space: nowrap;
      transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
    }
    .annot-el-id > span { overflow: hidden; text-overflow: ellipsis; }
    .annot-el-id:hover { background: var(--sm-brand); color: var(--sm-bg); border-color: var(--sm-brand); }
    .annot-el-id svg { width: 12px; height: 12px; display: block; flex-shrink: 0; }
    .annot-card-elid { margin-bottom: 8px; }
    .annot-popup-elid { padding: 7px 14px 0; }

    /* ── layout defense ──
       Host pages ship global rules such as button:not(:disabled) { position:
       relative } that out-rank a single class. Without these the collapsed
       bubble drops into the page flow and renders half off-screen. Only the
       positioning scheme is forced; offsets stay inline and draggable. */
    .annot-collapser, .annot-fab-row, .annot-actions-panel, .annot-tooltip,
    .annot-modal-overlay, .annot-toast, .annot-card-menu, .annot-confirm-pop,
    .annot-path-copier, .annot-onboard-overlay, .annot-onboard-spot,
    .annot-onboard-tag, .annot-onboard-card { position: fixed !important; margin: 0 !important; }
    .annot-badge, .annot-card, .annot-popup { position: absolute !important; margin: 0 !important; }
    .annot-collapser, .annot-fab-row, .annot-popup, .annot-card, .annot-actions-panel,
    .annot-modal, .annot-onboard-card { box-sizing: border-box; }
    [class^="annot-"] button, button[class^="annot-"] { touch-action: manipulation; }
    /* Host button margins (e.g. button:not(:disabled) { margin }) must not
       leak into overlay controls. Intentional margins use 2-class selectors. */
    .annot-onboard-card button, .annot-popup button, .annot-fab-row button,
    .annot-actions-panel button, .annot-card button, .annot-modal button,
    .annot-confirm-pop button, .annot-card-menu button { margin: 0; }

    /* ── compact (phone) thread modal ──
       Phones never show margin cards: only pins. Tapping a pin opens that
       thread full screen, sized to the visual viewport (see pinSheet), with
       a close bar at the top. Writing happens in the full-screen composer,
       never in the modal itself. */
    .annot-card.annot-sheet {
      position: fixed !important;
      width: 100vw; height: 100vh; max-width: none !important;
      transform: none !important; margin: 0 !important;
      border-radius: 16px !important; border: 1px solid var(--sm-border) !important;
      box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .55) !important;   /* scrim around the inset modal */
      box-sizing: border-box;
      overflow-y: auto; overscroll-behavior: contain;
      background: var(--sm-bg-1);
      z-index: 1000000;
    }
    .annot-card.annot-sheet {
      padding: 0 max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
      opacity: 1 !important;
    }
    body.annot-sheet-open { overflow: hidden !important; }
    .annot-sheet-bar { display: none; }
    .annot-card.annot-sheet .annot-sheet-bar {
      display: flex; align-items: center; gap: 8px;
      position: sticky; top: 0; z-index: 1;
      margin: 0 calc(-1 * max(16px, env(safe-area-inset-right, 0px))) 12px calc(-1 * max(16px, env(safe-area-inset-left, 0px)));
      padding: max(4px, env(safe-area-inset-top, 0px)) max(6px, env(safe-area-inset-right, 0px)) 4px max(16px, env(safe-area-inset-left, 0px));
      min-height: 52px; box-sizing: border-box;
      background: var(--sm-bg-1); border-bottom: 1px solid var(--sm-border);
    }
    .annot-sheet-title {
      flex: 1; min-width: 0; font-family: var(--sm-sans); font-size: 16px; font-weight: 500;
      color: var(--sm-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .annot-sheet-title span { color: var(--sm-muted); font-weight: 400; margin-left: 6px; }
    body.annot-compact .annot-card:not(.annot-sheet) { display: none !important; }
    /* Toasts drop from the top on phones: the bottom belongs to the sheets
       and the on-screen keyboard. */
    body.annot-compact .annot-toast {
      white-space: normal; text-align: center; max-width: calc(100vw - 32px);
      top: calc(16px + env(safe-area-inset-top, 0px)); bottom: auto;
    }
    /* Phone toolbar: a bar pinned to the bottom with 16px side gutters,
       whatever spot it was dragged to on a wider screen. The label shrinks
       first; the live chip drops the word "Live" (the green dot says it). */
    body.annot-compact .annot-fab-row {
      left: max(16px, env(safe-area-inset-left, 0px)) !important;
      right: max(16px, env(safe-area-inset-right, 0px)) !important;
      top: auto !important; bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
      transform: none !important; width: auto !important; box-sizing: border-box;
      justify-content: space-between; gap: 2px; padding: 4px 4px 4px 12px;
    }
    body.annot-compact .annot-banner-label { flex: 1 1 auto; min-width: 0; overflow: hidden; }
    body.annot-compact .annot-banner-label > span:last-child {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px;
    }
    body.annot-compact .annot-live-chip { flex-shrink: 0; margin-right: 2px; }
    body.annot-compact .annot-live-word { display: none; }
    .annot-sheet-tight .annot-card-elid,
    .annot-sheet-tight .annot-card-snippet { display: none !important; }

    /* ── phone composer: full screen, actions at the TOP ──
       Covers exactly the visual viewport (pinFullSheet), so it always ends
       at the top of the on-screen keyboard. Cancel / Save live in the top
       bar where neither the keyboard nor the iOS accessory bar (arrows +
       Done) can cover them; the rest is one textarea. */
    .annot-popup.annot-fullsheet {
      position: fixed !important; z-index: 1000003;
      width: 100vw; height: 100vh; border-radius: 0; border: none; box-shadow: none;
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--sm-bg-1); overscroll-behavior: contain;
    }
    .annot-fs-bar {
      flex-shrink: 0; display: flex; align-items: center; gap: 6px;
      padding: max(4px, env(safe-area-inset-top, 0px)) max(6px, env(safe-area-inset-right, 0px)) 4px max(6px, env(safe-area-inset-left, 0px));
      border-bottom: 1px solid var(--sm-border); min-height: 52px; box-sizing: border-box;
    }
    .annot-popup .annot-fs-cancel {
      flex-shrink: 0; width: 44px; height: 44px; padding: 0; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; color: var(--sm-text-2); cursor: pointer;
    }
    .annot-fs-cancel svg { width: 20px; height: 20px; display: block; }
    .annot-fs-label {
      flex: 1; min-width: 0; text-align: center;
      font-family: var(--sm-sans); font-size: 13px; color: var(--sm-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .annot-fs-label b { color: var(--sm-text); font-weight: 700; font-style: normal; margin-right: 4px; }
    .annot-popup .annot-fs-save { flex-shrink: 0; min-height: 40px; padding: 8px 18px; font-size: 15px; }
    .annot-popup.annot-fullsheet textarea {
      flex: 1; min-height: 0; width: 100%; margin: 0; resize: none;
      border: none; border-radius: 0; background: var(--sm-bg); color: var(--sm-text);
      padding: 14px max(16px, env(safe-area-inset-right, 0px)) 14px max(16px, env(safe-area-inset-left, 0px));
      font-family: var(--sm-sans); font-size: 17px !important; line-height: 1.45;
    }
    .annot-popup.annot-fullsheet textarea:focus { border: none; }
    body.annot-compact .annot-card-input-row input { cursor: pointer; }
    .annot-card-close { display: none !important; }
    .annot-card.annot-sheet .annot-card-close {
      display: flex !important; align-items: center; justify-content: center; flex-shrink: 0;
      width: 44px; height: 44px; padding: 0; border-radius: 50%; cursor: pointer;
      background: none; border: none; color: var(--sm-text);
    }
    .annot-card-close svg { width: 22px; height: 22px; display: block; }
    body.annot-compact .annot-onboard-card {
      max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px);
      max-width: calc(100vw - 24px);
    }
    @media (max-height: 480px) {
      .annot-onboard-stage { margin-top: 10px; }
      .annot-onboard-img { height: 112px; width: auto; margin: 0 auto; }
      .annot-onboard-sub { display: none; }
    }

    /* ── clipboard fallback sheet ── */
    .annot-md-sheet { width: 420px; }
    .annot-md-sheet textarea {
      width: 100%; height: 38vh; min-height: 140px; margin-top: 12px; resize: none;
      background: var(--sm-bg); color: var(--sm-text-2);
      border: 1px solid var(--sm-border); border-radius: 8px;
      padding: 8px 10px; box-sizing: border-box;
      font-family: var(--sm-mono); font-size: 12px; line-height: 1.45; outline: none;
    }
    .annot-md-sheet .annot-modal-actions { flex-wrap: wrap; }

    /* ── touch devices: no hover, fingers not cursors ── */
    @media (hover: none) and (pointer: coarse) {
      /* iOS Safari only dispatches click on "clickable" elements; a pointer
         cursor marks every element clickable so tap-to-annotate fires. */
      body.annot-mode * { cursor: pointer !important; }
      .annot-kbd, .annot-path-copier, .annot-tooltip, [data-tooltip]::after { display: none !important; }
      .annot-banner-btn { width: 44px; height: 44px; }
      .annot-banner-btn svg { width: 20px; height: 20px; }
      .annot-fab-row { padding: 2px 4px 2px 14px; }
      .annot-collapser { width: 56px; height: 56px; }
      .annot-menu-item { min-height: 44px; font-size: 15px; }
      .annot-btn { min-height: 44px; padding: 10px 18px; font-size: 14px; }
      .annot-btn-mini { min-height: 40px; }
      .annot-chip { min-height: 40px; padding: 8px 14px; font-size: 13px; }
      .annot-popup .annot-popup-close { width: 44px; height: 44px; margin: -10px -12px -10px 0;
        display: flex; align-items: center; justify-content: center; }
      .annot-popup-close svg { width: 18px; height: 18px; }
      .annot-el-id { min-height: 32px; font-size: 11px; }
      .annot-onboard-x, .annot-onboard-arrow { width: 44px; height: 44px; }
      .annot-onboard-dots { gap: 4px; }
      .annot-onboard-dot { width: 24px; height: 24px; background: transparent; position: relative; transform: none !important; }
      .annot-onboard-dot::after {
        content: ''; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px;
        margin: -4px 0 0 -4px; border-radius: 50%; background: var(--sm-border);
      }
      .annot-onboard-dot.active { background: transparent; }
      .annot-onboard-dot.active::after { background: var(--sm-brand); width: 10px; height: 10px; margin: -5px 0 0 -5px; }
      .annot-onboard-skip { min-height: 44px; padding: 8px 10px; font-size: 14px; }
      .annot-onboard-cap-body, .annot-onboard-sub { font-size: 14px; }
      /* Card actions are hover-revealed on desktop; always show them on touch. */
      .annot-card-actions { opacity: 1; }
      .annot-card-btn { width: 40px; height: 40px; }
      .annot-card-btn.resolve { width: 40px; height: 40px; }
      .annot-card-btn svg, .annot-card-btn.resolve svg { width: 18px; height: 18px; }
      .annot-card-send { width: 40px; height: 40px; }
      .annot-card-menu-item { min-height: 44px; font-size: 14px; }
      .annot-confirm-pop button { min-height: 40px; padding: 8px 14px; }
      .annot-card-comment, .annot-thread-text { font-size: 14px; }
      .annot-card-more { font-size: 13px; padding: 6px 0; }
      /* Badges stay small visually; an invisible halo makes them 44px+ to tap. */
      .annot-badge { min-width: 26px; height: 24px; font-size: 11px; }
      .annot-badge::after { content: ''; position: absolute; inset: -12px; }
      .annot-badge:hover { transform: none; }
      .annot-badge:not(.frozen):hover .annot-badge-num { display: inline; }
      .annot-badge:not(.frozen):hover .annot-badge-del { display: none; }
      /* 16px+ text in fields stops iOS from zooming the page on focus. */
      .annot-popup textarea, .annot-identity-input, .annot-reviewer-input,
      .annot-card-input-row input, .annot-card-editor textarea, .annot-md-sheet textarea { font-size: 16px !important; }
      .annot-reviewer-input, .annot-card-input-row input { min-height: 40px; }
      .annot-confirm-label, .annot-modal-body { font-size: 14px; }
    }
  `;
  injectStyle(css, 'sm-annotator-style');

  /* ── build fixed UI ──────────────────────────────────────────────── */
  const ICON_CHAT  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_DOTS  = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  // Icon set for icon-buttons (SVG, not Unicode glyphs — crisp at any DPI).
  const ICON_CHECK   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON_MENU_H  = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const ICON_SEND    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ICON_EDIT    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const ICON_TRASH   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
  const ICON_COPY    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_ORPHAN  = '<svg viewBox="0 0 24 24" fill="none" stroke="#fe9da7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.7 21a2 2 0 0 1-3.4 0L2.6 8a2 2 0 0 1 1.7-3h15.4a2 2 0 0 1 1.7 3z"/><path d="M12 9v4M12 17h.01"/></svg>';
  const ICON_CHEV_L  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_CHEV_R  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  // Expanded control: a draggable banner — "● Annotate Mode Enabled" + a
  // share button (Copy / Export) + the ⋮ options button + the ✕ exit button.
  const fabRow = mkEl('div', 'annot-fab-row');

  const bannerLabel = mkEl('span', 'annot-banner-label');
  const bannerDot   = mkEl('span', 'annot-banner-dot');
  const bannerText  = mkEl('span'); bannerText.textContent = IS_TOUCH ? 'Tap to annotate' : 'Annotate mode on';
  bannerLabel.append(bannerDot, bannerText);

  const shareBtn = mkEl('button', 'annot-banner-btn annot-share-btn');
  shareBtn.innerHTML = ICON_SHARE;
  shareBtn.onclick = toggleShare;
  attachTooltip(shareBtn, 'Copy / Export');

  const actionsBtn = mkEl('button', 'annot-banner-btn annot-actions-btn');
  actionsBtn.innerHTML = ICON_DOTS;
  actionsBtn.onclick = toggleActions;
  attachTooltip(actionsBtn, 'Options');

  const exitBtn = mkEl('button', 'annot-banner-btn exit');
  exitBtn.innerHTML = ICON_CLOSE;
  exitBtn.onclick = exitAnnotate;
  attachTooltip(exitBtn, 'Exit annotate', 'Esc');

  fabRow.append(bannerLabel, shareBtn, actionsBtn, exitBtn);
  // Multiplayer status chip: connection state + how many people are here.
  const liveChip = SYNC ? mkEl('span', 'annot-live-chip') : null;
  if (liveChip) { liveChip.dataset.status = 'connecting'; liveChip.textContent = 'Connecting'; fabRow.insertBefore(liveChip, shareBtn); }
  document.body.appendChild(fabRow);
  enableSpotDrag(fabRow);   // drag the banner → moves the shared spot (both)

  // Collapsed state: a single draggable chat icon. Click to annotate, or drag
  // to snap it to any of the 8 shared spots (persisted in localStorage).
  const collapser = mkEl('button', 'annot-collapser');
  collapser.innerHTML = ICON_CHAT;
  attachTooltip(collapser, 'Annotate', 'A');
  document.body.appendChild(collapser);
  enableSpotDrag(collapser, enterAnnotate);   // tap = annotate; drag = move both

  // Path copier pill: appears at top-right of the hovered element in annotate mode.
  // Click copies the element's class-free structural path to clipboard.
  let pathCopierTarget = null, pathCopierHideTimer = null;
  const pathCopierEl   = mkEl('div', 'annot-path-copier');
  const pathCopierText = mkEl('span');
  pathCopierEl.innerHTML = ICON_COPY;   // SVG icon; span appended below
  pathCopierEl.appendChild(pathCopierText);
  pathCopierEl.addEventListener('mouseenter', () => clearTimeout(pathCopierHideTimer));
  pathCopierEl.addEventListener('mouseleave', () => scheduleHidePathCopier(0));
  pathCopierEl.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!pathCopierTarget) return;
    toast(await writeClipboard(structuralPath(pathCopierTarget)) ? 'Path copied' : "Couldn't copy in this browser");
  });
  document.body.appendChild(pathCopierEl);

  applySpot(loadSpot());   // place bubble + banner at the shared spot
  applyCompact();          // phone-sized viewport → bottom-sheet layout
  // Fresh pages start collapsed and greet the reviewer with a one-time
  // educational coachmark (a dimmed overlay spotlighting the bubble + a 5-step
  // illustrated slider). "Start Annotating", Skip, or × dismiss it permanently
  // via HINT_KEY. Pages that already carry notes skip it and open expanded.
  const hasExistingNotes = allAnnotations().some(a => !a.isShadow);
  setCollapsed(true);
  if (hasExistingNotes) {
    setCollapsed(false);                 // show toolbar + cards, no crosshair
  } else if (store.get(HINT_KEY) !== '1') {
    buildOnboarding();                   // first-run educational coachmark
  }
  // Three passes: immediate, after layout settles, after all resources load.
  // Guards against RAF firing before layout is computed on slow or image-heavy pages.
  // Detect page background luminance and flag light-themed pages
  (function detectLightPage() {
    const bg  = window.getComputedStyle(document.body).backgroundColor;
    const m   = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return;
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    // Guard transparent (alpha 0) — treated as no background, skip classification.
    if (parts[3] !== undefined && parts[3] === 0) return;
    const lum = (parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000;
    if (lum > 140) document.body.classList.add('annot-light-page');
  })();

  function initRender() { renderBadges(); renderAnnotationCards(); updateTargetHighlights(); }
  requestAnimationFrame(initRender);
  setTimeout(initRender, 400);
  if (document.readyState !== 'complete') window.addEventListener('load', initRender);
  else setTimeout(initRender, 800);

  /* ── listeners ───────────────────────────────────────────────────── */
  document.addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType || 'mouse'; }, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout',  onMouseOut,  true);
  document.addEventListener('click',     onDocClick,  true);
  document.addEventListener('keydown', (e) => {
    if (onboardingEls) {
      if (e.key === 'Escape')     { e.preventDefault(); dismissHint(true); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); onboardGoTo(onboardingIndex + 1); return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); onboardGoTo(onboardingIndex - 1); return; }
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); enterAnnotate(); return; }
      // other keys (e.g. 'h') fall through and dismiss via enter/exitAnnotate
    }
    if (activeModal) { if (e.key === 'Escape') { e.preventDefault(); activeModal(); } return; }
    if (e.key === 'Escape') {
      if (activePopup)  { closePopup(); return; }
      if (sheetCardId)  { closeCardSheet(); return; }
      if (stackList)    { closeStackList(); return; }
      if (actionsOpen)  { closeActions(); return; }
      if (mode)         { exitAnnotate(); return; }
    }
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input' || document.activeElement?.isContentEditable) return;
      if (activePopup) return;
      e.preventDefault();
      if (!mode) enterAnnotate();
    }
    if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      toggleHidden();   // same shortcut hides and un-hides the whole overlay
    }
    if (e.key === 'C' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      clearAll();
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input' || document.activeElement?.isContentEditable) return;
      if (e.key === 's') { e.preventDefault(); saveVersion(); return; }
      if (e.key === 'm') { e.preventDefault(); exportMarkdown(); return; }
      // With Shift held the key is 'C' (uppercase) — compare case-insensitively.
      if (e.key.toLowerCase() === 'c' && e.shiftKey) { e.preventDefault(); copyMarkdown(); return; }
    }
  });
  if (SYNC) startSync();
  // Pins and cards sit in document coordinates, so a scroll doesn't move
  // them. Rebuilding them on every scroll tick (remove, measure, re-append
  // each pin) made phone scrolling stutter. While scrolling, only the open
  // sheets follow the viewport, once per frame. The full re-layout runs once
  // the scroll settles, for targets inside sticky or fixed parents.
  let scrollFrame = 0;
  const settleLayout = debounce(() => { renderBadges(); positionCards(); }, 140);
  window.addEventListener('scroll', () => {
    if (!scrollFrame && document.querySelector('.annot-sheet,.annot-fullsheet,.annot-stack-sheet')) {
      scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; repinSheets(); });
    }
    settleLayout();
  }, { passive: true });
  // The host page can reflow without a scroll or resize (web fonts landing,
  // images loading, a grid settling). Pins and cards are measured once, so
  // re-measure whenever the page or a commented element changes size.
  // (var, not const: renderBadges may run before this line.)
  var layoutObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => settleLayout()) : null;
  if (layoutObserver) layoutObserver.observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => settleLayout()).catch(() => {});
  window.addEventListener('load', () => settleLayout());
  // Mobile browsers fire resize as the address bar slides in and out during
  // a scroll. A height-only change on a touch device doesn't move anything
  // the overlay draws, so it only re-pins sheets.
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', throttle(() => {
    const wasCompact = document.body.classList.contains('annot-compact');
    applyCompact();
    if (wasCompact !== document.body.classList.contains('annot-compact')) { closePopup(); refresh(); lastResizeW = window.innerWidth; return; }
    repinSheets();
    if (IS_TOUCH && window.innerWidth === lastResizeW) return;
    lastResizeW = window.innerWidth;
    settleLayout();
  }, 60));
  // The on-screen keyboard shrinks only the *visual* viewport (iOS, and
  // Android Chrome by default) — re-pin open sheets so they ride above it.
  if (window.visualViewport) {
    const vvRepin = throttle(repinSheets, 30);
    window.visualViewport.addEventListener('resize', vvRepin);
    window.visualViewport.addEventListener('scroll', vvRepin);
  }

  /* ── compact (phone) layout + bottom sheets ─────────────────────────── */
  function applyCompact() { document.body.classList.toggle('annot-compact', isCompact()); }
  // Safe-area inset at the bottom (home indicator), measured from a probe so
  // the JS-positioned sheets agree with the CSS env() values.
  function safeInsetBottom() {
    const probe = mkEl('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);
    const v = parseFloat(window.getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    return v;
  }
  // Dock a sheet to the bottom of the *visible* area: above the on-screen
  // keyboard when it's open, above the home indicator when it isn't.
  function pinSheet(el) {
    if (!el || !el.isConnected) return;
    if (el.classList.contains('annot-card')) { pinFullSheet(el, SHEET_INSET); return; }   // thread modal: near full screen
    const vv   = window.visualViewport;
    const vTop = vv ? vv.offsetTop : 0;
    const vH   = vv ? vv.height    : window.innerHeight;
    const keyboardOpen = vv && (window.innerHeight - vv.height) > 120;
    const gap  = 8 + (keyboardOpen ? 0 : safeInsetBottom());
    // Landscape phone + keyboard leaves ~150-250px: drop the optional rows
    // (chips, identity, element chip) so the note field itself stays usable.
    el.classList.toggle('annot-sheet-tight', vH < 320);
    el.style.maxHeight = Math.max(140, vH - 16 - (keyboardOpen ? 0 : safeInsetBottom())) + 'px';
    el.style.bottom = 'auto';
    const h = el.offsetHeight;
    el.style.top = Math.max(vTop + 8, vTop + vH - h - gap) + 'px';
  }
  function repinSheets() {
    document.querySelectorAll('.annot-sheet').forEach(pinSheet);
    document.querySelectorAll('.annot-fullsheet').forEach(el => pinFullSheet(el));
    document.querySelectorAll('.annot-stack-sheet').forEach(el => pinFullSheet(el, SHEET_INSET));
  }
  // Full-screen composer = exactly the visual viewport. On iOS the keyboard
  // shrinks visualViewport (not the layout viewport) and Safari may scroll it
  // (offsetTop), so pin to its offsets, not to the window.
  // The thread modal sits SHEET_INSET px in from every edge (rounded, over
  // a scrim); the composer stays edge to edge above the keyboard.
  const SHEET_INSET = 8;
  function pinFullSheet(el, inset) {
    if (!el || !el.isConnected) return;
    const vv = window.visualViewport, i = inset || 0;
    el.style.top    = ((vv ? vv.offsetTop  : 0) + i) + 'px';
    el.style.left   = ((vv ? vv.offsetLeft : 0) + i) + 'px';
    el.style.width  = ((vv ? vv.width  : window.innerWidth)  - 2 * i) + 'px';
    el.style.height = ((vv ? vv.height : window.innerHeight) - 2 * i) + 'px';
  }

  // Note cards have no margin to live in on a phone: they stay hidden and the
  // badge opens the note as a bottom sheet (reply / edit / resolve / delete).
  let sheetCardId = null;
  // Tapping outside a sheet only dismisses it — the click that follows must
  // not also open a new note (or follow a host link) under the finger.
  let suppressClickUntil = 0;
  function openCardSheet(annotId) {
    closeCardSheet();
    const card = document.querySelector(`.annot-card[data-annot-id="${annotId}"]`);
    if (!card) return;
    sheetCardId = annotId;
    card.classList.add('annot-sheet');
    document.body.classList.add('annot-sheet-open');
    pinSheet(card);
    const a = allAnnotations().find(x => x.id === annotId);
    const t = a && resolveTarget(a);
    if (t) t.classList.add('annot-target-active');
    setTimeout(() => document.addEventListener('pointerdown', outsideCardSheet, true), 0);
  }
  function outsideCardSheet(ev) {
    if (ev.target.closest?.('.annot-card.annot-sheet,.annot-card-menu,.annot-confirm-pop,.annot-modal-overlay,.annot-popup')) return;
    if (!isUI(ev.target)) suppressClickUntil = Date.now() + 700;
    closeCardSheet();
  }
  function closeCardSheet() {
    document.removeEventListener('pointerdown', outsideCardSheet, true);
    sheetCardId = null;
    document.body.classList.remove('annot-sheet-open');
    document.querySelectorAll('.annot-card.annot-sheet').forEach(c => {
      c.classList.remove('annot-sheet');
      ['top', 'left', 'width', 'height'].forEach(p => c.style.removeProperty(p));
    });
    document.querySelectorAll('.annot-target-active').forEach(el => el.classList.remove('annot-target-active'));
  }

  /* ── collapse / expand ───────────────────────────────────────────── */
  function setCollapsed(val) {
    uiCollapsed = val;
    document.body.classList.toggle('annot-ui-collapsed', val);
    if (val && mode) toggleMode();
    // Bubble and banner share one spot; re-assert it on expand so the banner
    // lands exactly where the bubble was.
    if (!val) applySpot(loadSpot());
  }
  function enterAnnotate() {
    dismissHint(true);   // engaging counts as discovering it — don't show again
    if (uiHidden) setHidden(false);   // entering annotate always reveals the UI
    setCollapsed(false);
    if (!mode) toggleMode();
  }

  /* ── hide / show the entire overlay ───────────────────────────────────
     "Hide Annotate UI" (⋮ menu or the H key) tucks away *all* annotate
     chrome — bubble, toolbar, cards, badges — so the artefact reads clean.
     Pressing H again (the same shortcut) brings everything back. */
  function setHidden(val) {
    uiHidden = val;
    document.body.classList.toggle('annot-ui-hidden', val);
    if (val) {
      if (actionsOpen) closeActions();
      if (activePopup) closePopup();
      if (mode)        toggleMode();   // no crosshair / hover while hidden
    }
  }
  function toggleHidden() { setHidden(!uiHidden); }

  /* ── first-run onboarding coachmark ───────────────────────────────────
     A dimmed (20%) overlay that spotlights the collapsed bubble and explains,
     via a 5-step illustrated slider, what annotate does and how to use it.
     "Start Annotating" enters annotate mode; Skip / × just close it. Either
     way the choice persists in localStorage (HINT_KEY) so it never reappears. */
  function buildOnboarding() {
    if (onboardingEls) return;

    const overlay = mkEl('div', 'annot-onboard-overlay');
    overlay.onclick = (e) => { if (e.target === overlay) dismissHint(true); };

    // Spotlight over the bubble — its huge box-shadow is what dims the page, so
    // the comment bubble stays bright and the overlay literally points at it.
    const spot = mkEl('button', 'annot-onboard-spot');
    spot.setAttribute('aria-label', 'Start annotating');
    spot.onclick = (e) => { e.stopPropagation(); enterAnnotate(); };
    const tag = mkEl('div', 'annot-onboard-tag');

    // Educational card with the illustrated slider.
    const card   = mkEl('div', 'annot-onboard-card');
    const head   = mkEl('div', 'annot-onboard-head');
    const titles = mkEl('div', 'annot-onboard-titles');
    titles.appendChild(mkEl('div', 'annot-onboard-title', 'Annotate this page'));
    titles.appendChild(mkEl('div', 'annot-onboard-sub',
      'Leave feedback right on the artefact, then hand it to your AI assistant or save a versioned copy. Here’s the 30-second tour.'));
    const xBtn = mkEl('button', 'annot-onboard-x');
    xBtn.innerHTML = ICON_CLOSE;
    xBtn.setAttribute('aria-label', 'Skip');
    xBtn.onclick = () => dismissHint(true);
    head.append(titles, xBtn);

    const stage  = mkEl('div', 'annot-onboard-stage');
    const slides = ONBOARD_STEPS.map((step, i) => {
      const slide = mkEl('div', 'annot-onboard-slide' + (i === 0 ? ' active' : ''));
      slide.innerHTML = step.svg;
      stage.appendChild(slide);
      return slide;
    });

    const cap      = mkEl('div', 'annot-onboard-cap');
    const capTitle = mkEl('div', 'annot-onboard-cap-title');
    const capBody  = mkEl('div', 'annot-onboard-cap-body');
    cap.append(capTitle, capBody);

    const nav  = mkEl('div', 'annot-onboard-nav');
    const prev = mkEl('button', 'annot-onboard-arrow');
    prev.innerHTML = ICON_CHEV_L;
    const next = mkEl('button', 'annot-onboard-arrow');
    next.innerHTML = ICON_CHEV_R;
    const dots = mkEl('div', 'annot-onboard-dots');
    const dotEls = ONBOARD_STEPS.map((_, i) => {
      const d = mkEl('button', 'annot-onboard-dot' + (i === 0 ? ' active' : ''));
      d.setAttribute('aria-label', 'Step ' + (i + 1));
      d.onclick = () => onboardGoTo(i);
      dots.appendChild(d);
      return d;
    });
    prev.onclick = () => onboardGoTo(onboardingIndex - 1);
    next.onclick = () => onboardGoTo(onboardingIndex + 1);
    nav.append(prev, dots, next);

    const foot  = mkEl('div', 'annot-onboard-foot');
    const skip  = mkEl('button', 'annot-onboard-skip', 'Skip tour');
    skip.onclick = () => dismissHint(true);
    // Primary CTA: "Next" through the tour, "Start Annotating" on the last
    // step. Label + handler are (re)set per step in renderStep().
    const cta = mkEl('button', 'annot-btn annot-btn-primary annot-onboard-start');
    foot.append(skip, cta);

    card.append(head, stage, cap, nav, foot);
    document.body.append(overlay, spot, tag, card);

    onboardingEls   = { overlay, spot, tag, card, slides, dotEls, capTitle, capBody, prev, next, cta };
    onboardingIndex = 0;
    renderStep();
    positionOnboard();
    window.addEventListener('resize', positionOnboard);
  }

  function onboardGoTo(i) {
    if (!onboardingEls) return;
    onboardingIndex = Math.max(0, Math.min(ONBOARD_STEPS.length - 1, i));
    renderStep();
  }

  function renderStep() {
    if (!onboardingEls) return;
    const step = ONBOARD_STEPS[onboardingIndex];
    onboardingEls.slides.forEach((s, i) => s.classList.toggle('active', i === onboardingIndex));
    onboardingEls.dotEls.forEach((d, i) => d.classList.toggle('active', i === onboardingIndex));
    onboardingEls.capTitle.textContent = (IS_TOUCH && step.touchTitle) || step.title;
    if (step.kbd) addKbd(onboardingEls.capTitle, step.kbd);
    onboardingEls.capBody.textContent = (IS_TOUCH && step.touchBody) || step.body;
    onboardingEls.prev.disabled = onboardingIndex === 0;
    onboardingEls.next.disabled = onboardingIndex === ONBOARD_STEPS.length - 1;

    // CTA: "Next" until the last step, where it becomes "Start Annotating".
    const last = onboardingIndex === ONBOARD_STEPS.length - 1;
    const cta = onboardingEls.cta;
    cta.innerHTML = '';
    cta.appendChild(mkEl('span', null, last ? 'Start Annotating' : 'Next'));
    if (last) addKbd(cta, 'A');
    cta.onclick = last ? () => enterAnnotate() : () => onboardGoTo(onboardingIndex + 1);
  }

  function positionOnboard() {
    if (!onboardingEls) return;
    const r    = collapser.getBoundingClientRect();
    const pad  = 9;
    const size = Math.max(r.width, r.height) + pad * 2;
    const cx   = r.left + r.width / 2;
    const cy   = r.top  + r.height / 2;
    const spot = onboardingEls.spot;
    spot.style.width  = size + 'px';
    spot.style.height = size + 'px';
    spot.style.left   = (cx - size / 2) + 'px';
    spot.style.top    = (cy - size / 2) + 'px';

    const tag   = onboardingEls.tag;
    const above = cy - size / 2 > 42;
    tag.innerHTML = '';
    if (!above) tag.appendChild(mkEl('span', null, '↑'));
    if (IS_TOUCH) {
      tag.appendChild(mkEl('span', null, 'Tap here'));
    } else {
      tag.appendChild(mkEl('span', null, 'Click here or press'));
      addKbd(tag, 'A');
    }
    if (above) tag.appendChild(mkEl('span', null, '↓'));
    const tw = tag.offsetWidth || 150;
    let left = cx - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tag.style.left = left + 'px';
    tag.style.top  = (above ? cy - size / 2 - 26 : cy + size / 2 + 8) + 'px';
  }

  function dismissHint(persist) {
    if (persist) store.set(HINT_KEY, '1');
    if (!onboardingEls) return;
    window.removeEventListener('resize', positionOnboard);
    onboardingEls.overlay.remove();
    onboardingEls.spot.remove();
    onboardingEls.tag.remove();
    onboardingEls.card.remove();
    onboardingEls = null;
  }
  function exitAnnotate() {
    if (actionsOpen) closeActions();
    setCollapsed(true);   // setCollapsed turns annotate mode off
  }

  /* ── annotate mode ───────────────────────────────────────────────── */
  function toggleMode() {
    mode = !mode;
    document.body.classList.toggle('annot-mode', mode);
    if (!mode) clearHover();
  }

  /* ── shared draggable position ────────────────────────────────────────
     The collapsed chat bubble and the expanded "Annotate Mode Enabled"
     banner share ONE position, snapping to any of 8 spots: the four corners
     plus the four edge middles (BANNER_SPOTS, defined up top). Dragging
     either element moves both and persists, so the chosen spot tracks
     correctly whether the overlay is open (banner) or closed (bubble). */
  function loadSpot() {
    const c = store.get(CORNER_KEY);
    return BANNER_SPOTS[c] ? c : 'br';
  }
  function applySpotTo(el, code) {
    const spot = BANNER_SPOTS[code] || BANNER_SPOTS.br;
    el.style.top = el.style.bottom = el.style.left = el.style.right = 'auto';
    if (spot.top    !== undefined) el.style.top    = spot.top;
    if (spot.bottom !== undefined) el.style.bottom = spot.bottom;
    if (spot.left   !== undefined) el.style.left   = spot.left;
    if (spot.right  !== undefined) el.style.right  = spot.right;
    el.style.transform =
      ((spot.tx ? `translateX(${spot.tx})` : '') + (spot.ty ? ` translateY(${spot.ty})` : '')).trim() || 'none';
  }
  function applySpot(code) { applySpotTo(collapser, code); applySpotTo(fabRow, code); }
  function nearestSpot(cx, cy) {
    const W = window.innerWidth, H = window.innerHeight;
    const pts = {
      tl: [0, 0], tc: [W / 2, 0], tr: [W, 0],
      rc: [W, H / 2], br: [W, H], bc: [W / 2, H], bl: [0, H], lc: [0, H / 2],
    };
    let best = 'br', bestD = Infinity;
    for (const k in pts) {
      const d = Math.hypot(pts[k][0] - cx, pts[k][1] - cy);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }
  // Generic drag: free-positions `el` while moving, then snaps the SHARED
  // spot (both bubble + banner) on release and persists it. `onTap` runs on
  // the click that follows a press without dragging. It must be the click,
  // not pointerup: on touch the click is hit-tested AFTER pointerup, so
  // expanding on pointerup let that click land on the banner's ✕ (same spot)
  // and the bubble collapsed again — tapping it never entered annotate mode.
  function enableSpotDrag(el, onTap) {
    let down = false, moved = false, sx = 0, sy = 0, offX = 0, offY = 0, justDragged = false;
    el.addEventListener('click', (e) => {
      if (justDragged) { e.stopPropagation(); e.preventDefault(); justDragged = false; return; }
      if (onTap) { e.stopPropagation(); e.preventDefault(); onTap(); }
    }, true);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // A touch drag ends without a click, so clear any stale drag guard here
      // or it would swallow the next genuine tap.
      down = true; moved = false; justDragged = false; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      const onMove = (ev) => {
        if (!down) return;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        if (!moved) { moved = true; el.classList.add('dragging'); if (actionsOpen) closeActions(); }
        ev.preventDefault();
        const w = el.offsetWidth, h = el.offsetHeight;
        const left = Math.min(window.innerWidth  - w - 4, Math.max(4, ev.clientX - offX));
        const top  = Math.min(window.innerHeight - h - 4, Math.max(4, ev.clientY - offY));
        el.style.top = top + 'px'; el.style.left = left + 'px';
        el.style.right = el.style.bottom = 'auto'; el.style.transform = 'none';
      };
      const onUp = () => {
        down = false;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
        if (moved) {
          el.classList.remove('dragging');
          justDragged = true;
          const r2 = el.getBoundingClientRect();
          const code = nearestSpot(r2.left + r2.width / 2, r2.top + r2.height / 2);
          store.set(CORNER_KEY, code);
          applySpot(code);   // move BOTH bubble + banner to the shared spot
        }
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    });
  }
  function onMouseOver(e) {
    if (!mode || isUI(e.target) || isPageRoot(e.target)) return;
    clearHover(); e.target.classList.add('annot-hover');
    positionPathCopier(e.target);
  }
  function onMouseOut(e) {
    if (!mode) return;
    e.target.classList?.remove('annot-hover');
    scheduleHidePathCopier(300);
  }
  function clearHover() {
    document.querySelectorAll('.annot-hover').forEach(el => el.classList.remove('annot-hover'));
    scheduleHidePathCopier(0);
  }
  function positionPathCopier(el) {
    clearTimeout(pathCopierHideTimer);
    pathCopierTarget = el;
    const path = structuralPath(el);
    const segs = path.split(' > ');
    pathCopierText.textContent = segs.length > 2 ? '⋯ ' + segs.slice(-2).join(' > ') : path;
    pathCopierEl.style.display = 'flex';
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const pw   = pathCopierEl.offsetWidth || 120;
      let left   = rect.right - pw;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      let top = rect.top - 28;
      if (top < 8) top = rect.bottom + 4;
      pathCopierEl.style.left = left + 'px';
      pathCopierEl.style.top  = top  + 'px';
    });
  }
  function scheduleHidePathCopier(delay) {
    clearTimeout(pathCopierHideTimer);
    pathCopierHideTimer = setTimeout(() => {
      pathCopierEl.style.display = 'none';
      pathCopierTarget = null;
    }, delay);
  }
  function onDocClick(e) {
    if (suppressClickUntil && Date.now() < suppressClickUntil && !isUI(e.target)) {
      suppressClickUntil = 0;
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (!mode) return;
    if (!e.isTrusted) return;
    if (isUI(e.target)) return;
    if (isPageRoot(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    // The first action is always the annotation itself — never a name gate.
    // Identity is captured inline inside the composer (see openEditor) so the
    // reviewer can just type their note and Save. In multiplayer the viewer
    // must identify first (name + email), so the gate opens before the composer.
    const target = e.target;
    requireIdentity(() => openEditor(target, null));
  }
  function isUI(t) {
    return !!t.closest?.('.annot-fab-row,.annot-icon-fab,.annot-actions-btn,.annot-actions-panel,.annot-popup,.annot-badge,.annot-card,.annot-card-menu,.annot-confirm-pop,.annot-toast,.annot-collapser,.annot-modal-overlay,.annot-tooltip,.annot-path-copier,.annot-stack-list');
  }
  // The page root (<body>/<html>) is the page canvas, not a meaningful target.
  // Highlighting it replaces an opaque background with a translucent tint,
  // exposing the white <html> canvas — so skip it for hover and clicks.
  function isPageRoot(t) {
    return t === document.body || t === document.documentElement;
  }

  /* ── banner menus ─────────────────────────────────────────────────────
     Two aggregators live in the banner: a share button (Copy / Export) and
     the ⋮ options button (reviewer identity, Hide UI, Clear All). Both share
     one panel; opening one closes the other. `actionsOpen` stays the global
     "a menu is open" flag and `closeActions()` closes whichever is open. */
  let openMenuBtn = null;
  let detachOutsideClose = null;
  const mod = isMac ? '⌘' : 'Ctrl';
  function closeActions() {
    document.querySelector('.annot-actions-panel')?.remove();
    if (openMenuBtn) openMenuBtn.classList.remove('open');
    openMenuBtn = null;
    actionsOpen = false;
    // Always detach the outside-close listener — a stale one left behind by a
    // button-triggered close would kill the next panel on its first mousedown.
    if (detachOutsideClose) { detachOutsideClose(); detachOutsideClose = null; }
  }
  function mkMenuItem(label, shortcut, cls) {
    const b = mkEl('button', 'annot-menu-item' + (cls ? ' ' + cls : ''));
    const l = mkEl('span'); l.textContent = label;
    b.appendChild(l);
    if (shortcut) addKbd(b, shortcut);
    return b;
  }
  // Open a panel built by `build(panel)`, anchored to `anchorBtn`.
  function openMenu(anchorBtn, build) {
    closeActions();
    actionsOpen = true;
    openMenuBtn = anchorBtn;
    anchorBtn.classList.add('open');

    const panel = mkEl('div', 'annot-actions-panel');
    build(panel);
    document.body.appendChild(panel);

    // anchor the panel to its button, flipping to stay in the viewport
    const r  = anchorBtn.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    let top  = r.top - pr.height - 10;
    if (top < 10) top = r.bottom + 10;
    let left = r.right - pr.width;
    if (left < 10) left = r.left;
    panel.style.top    = Math.max(10, Math.min(top,  window.innerHeight - pr.height - 10)) + 'px';
    panel.style.left   = Math.max(10, Math.min(left, window.innerWidth  - pr.width  - 10)) + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';

    // pointerdown, not mousedown: iOS never synthesizes mousedown on a tap
    // over non-clickable content, so the panel would never close on touch.
    const arm = setTimeout(() => document.addEventListener('pointerdown', outsideClose, true), 0);
    detachOutsideClose = () => {
      clearTimeout(arm);
      document.removeEventListener('pointerdown', outsideClose, true);
    };
    function outsideClose(ev) {
      if (!panel.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) {
        closeActions();
      }
    }
  }
  function toggleActions() {
    if (openMenuBtn === actionsBtn) { closeActions(); return; }
    openMenu(actionsBtn, buildOptionsPanel);
  }
  function toggleShare() {
    if (openMenuBtn === shareBtn) { closeActions(); return; }
    openMenu(shareBtn, buildSharePanel);
  }
  // Share menu: get the feedback out of the document.
  function buildSharePanel(panel) {
    const copyItem   = mkMenuItem('Copy Comments', mod + '⇧C');
    const exportItem = mkMenuItem('Export as Markdown', mod + 'M');
    const opts = mkEl('div', 'annot-menu-items');
    opts.append(copyItem, exportItem);
    panel.appendChild(opts);
    copyItem.onclick   = () => { copyMarkdown();   closeActions(); };
    exportItem.onclick = () => { exportMarkdown(); closeActions(); };
  }
  // Options menu: reviewer identity + overlay actions.
  function buildOptionsPanel(panel) {
    // reviewer row: avatar + name (avatar click re-rolls the seeded avatar)
    const reviewerRow = mkEl('div', 'annot-panel-row');
    const avatarBtn   = mkEl('button', 'annot-avatar-btn');
    avatarBtn.style.cssText = 'width:30px;height:30px;';
    avatarBtn.title   = 'Click to change avatar';
    const avatarImg   = mkEl('img', 'annot-reviewer-avatar');
    avatarImg.src     = generateAvatar(reviewerName);
    avatarImg.alt     = reviewerName;
    avatarImg.style.cssText = 'width:30px;height:30px;border-radius:50%;display:block;';
    avatarBtn.appendChild(avatarImg);
    avatarBtn.onclick = () => {
      randomizeAvatar(reviewerName);
      avatarImg.src = generateAvatar(reviewerName);
    };
    const nameInput   = mkEl('input', 'annot-reviewer-input');
    nameInput.type    = 'text';
    nameInput.value   = reviewerName;
    nameInput.placeholder = 'Your name';
    // Persist on every keystroke so the name is remembered for next time
    // without needing to blur or submit.
    nameInput.oninput = () => {
      reviewerName = nameInput.value.trim() || 'Reviewer';
      avatarImg.src = generateAvatar(reviewerName);
      if (nameInput.value.trim()) { store.set(REVIEWER_KEY, reviewerName); nameSet = true; }
      // Re-stamp the author on notes written in this session so the change is
      // reflected immediately — scoped to this session, never others' notes.
      applyNameToSession(reviewerName);
    };
    reviewerRow.append(avatarBtn, nameInput);
    panel.appendChild(reviewerRow);
    let switchItem = null;
    if (SYNC) {
      // The name other viewers see is the identity's name; change it by
      // switching identity, so it is always paired with a verified email.
      nameInput.readOnly = true;
      nameInput.value    = identity ? identity.name : 'Not signed in';
      nameInput.title    = identity ? 'Others see this name.' : '';
      nameInput.oninput  = null;
      switchItem = mkMenuItem(identity ? 'Switch Identity' : 'Add Your Name');
      switchItem.onclick = () => { closeActions(); clearIdentity(); openIdentityGate(null); };
    }

    const hideItem  = mkMenuItem('Hide Annotate UI', 'H');
    const clearItem = mkMenuItem(SYNC ? 'Clear My Comments' : 'Clear All Comments', '⇧C', 'danger');
    const opts = mkEl('div', 'annot-menu-items');
    if (switchItem) opts.appendChild(switchItem);
    opts.append(hideItem, clearItem);
    panel.appendChild(opts);
    hideItem.onclick  = () => { closeActions(); setHidden(true); };   // press H to bring it back
    clearItem.onclick = () => { closeActions(); clearAll(); };        // clearAll shows a confirm modal
  }

  // Retroactively re-stamp the reviewer name on every note + reply created in
  // THIS session. Notes from previous sessions, frozen notes, and notes by
  // other reviewers keep their original author untouched.
  function applyNameToSession(name) {
    let changed = false;
    annotations.forEach(a => {
      if (sessionNoteIds.has(a.id) && a.author !== name) { a.author = name; changed = true; }
      (a.replies || []).forEach(r => {
        if (sessionNoteIds.has(r.id) && r.author !== name) { r.author = name; changed = true; }
      });
    });
    if (changed) { saveLive(); refresh(); }
  }

  /* ── inline identity ─────────────────────────────────────────────────
     The first action is the annotation itself, not a name gate. Identity is
     captured inline inside the first note composer: a subtle footer with the
     reviewer's avatar + an editable name. The textarea keeps focus, so the
     reviewer can simply type their note and Save — the name (or its default)
     is locked in on first save and never asked again. */
  function buildIdentityField() {
    const row = mkEl('div', 'annot-identity-row');
    const av  = mkEl('img', 'annot-identity-avatar');
    av.src = generateAvatar(reviewerName);
    av.alt = reviewerName;
    const label = mkEl('span', 'annot-identity-label', 'Commenting as');
    const input = mkEl('input', 'annot-identity-input');
    input.type        = 'text';
    input.value       = reviewerName === 'Reviewer' ? '' : reviewerName;
    input.placeholder = 'add your name';
    input.setAttribute('aria-label', 'Your name');
    // Persist as they type so the name is remembered without blur/submit.
    input.oninput = () => {
      const v = input.value.trim();
      reviewerName  = v || 'Reviewer';
      av.src = generateAvatar(reviewerName);
      av.alt = reviewerName;
      if (v) { store.set(REVIEWER_KEY, v); nameSet = true; }
    };
    // Let Enter in the name field jump straight to the note textarea.
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); row.closest('.annot-popup')?.querySelector('textarea')?.focus(); }
    };
    row.append(av, label, input);
    return row;
  }

  // Small monospace element-ID chip — the structural anchor for a note, shown so
  // a reviewer (and the AI reading the export) knows exactly which element a
  // comment is on. Displays the last two path segments; click copies the full
  // class-free path. Mirrors the hover path-copier pill.
  function elIdChip(path) {
    const chip = mkEl('span', 'annot-el-id');
    chip.innerHTML = ICON_COPY;
    const txt  = mkEl('span');
    const segs = (path || '').split(' > ');
    txt.textContent = segs.length > 2 ? '⋯ ' + segs.slice(-2).join(' > ') : (path || '—');
    chip.appendChild(txt);
    chip.title = path || '';
    chip.setAttribute('data-tooltip', 'Copy element ID');
    chip.onclick = async (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!path) return;
      toast(await writeClipboard(path) ? 'Element ID copied' : "Couldn't copy in this browser");
    };
    return chip;
  }
  // The structural path stored on an annotation, with fallbacks for notes saved
  // before structuralPath existed (selector is also class-free; elementPath last).
  function annotElId(a) { return a.structuralPath || a.selector || a.elementPath || ''; }

  function openEditor(target, existing) {
    closePopup();
    if (isCompact()) {
      if (!existing)             openPhoneComposer('new',   target, null);
      else if (existing.frozen)  openPhoneComposer('reply', target, existing);
      else                       openPhoneComposer('edit',  target, existing);
      return;
    }
    const isFrozen = existing?.frozen;
    let   showIdentity = false;   // first-note inline name capture (set below)
    const popup    = mkEl('div', 'annot-popup');

    const header  = mkEl('div', 'annot-popup-header');
    const meta    = mkEl('div', 'annot-popup-meta');
    const snippet = existing ? (existing.textSnippet || '') : (textSnippet(target) || '');
    const clipped = snippet.length > 52 ? snippet.slice(0, 52) + '…' : snippet;
    if (existing) {
      meta.textContent = `#${existing.localId}`;
      if (clipped) {
        const snipEl = mkEl('span');
        snipEl.style.cssText = 'color:var(--sm-muted,#c2c2c2);margin-left:6px;font-style:italic;';
        snipEl.textContent   = `"${clipped}"`;
        meta.appendChild(snipEl);
      }
    } else {
      meta.style.fontStyle = 'italic';
      meta.textContent = clipped ? `"${clipped}"` : 'Click to annotate';
    }
    const closeBtn = mkEl('button', 'annot-popup-close'); closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.setAttribute('data-tooltip', 'Close');
    closeBtn.onclick = closePopup;
    header.append(meta, closeBtn);
    popup.appendChild(header);

    const elIdPath = existing ? annotElId(existing) : structuralPath(target);
    if (elIdPath) {
      const elIdRow = mkEl('div', 'annot-popup-elid');
      elIdRow.appendChild(elIdChip(elIdPath));
      popup.appendChild(elIdRow);
    }

    if (existing) {
      const thread = mkEl('div', 'annot-popup-thread');
      const buildItem = (cls, author, comment, createdAt) => {
        const item = mkEl('div', 'annot-thread-item ' + cls);
        const aRow = mkEl('div', 'annot-author-row');
        const av   = mkEl('img', 'annot-avatar');
        av.src     = generateAvatar(author || 'Reviewer');
        av.alt     = author || 'Reviewer';
        av.style.cssText = 'width:18px;height:18px;';
        const name = mkEl('div', 'annot-thread-author', author || 'Reviewer');
        const time = mkEl('div', 'annot-thread-time', fmtRelTime(createdAt));
        aRow.append(av, name, time);
        item.appendChild(aRow);
        item.appendChild(mkEl('div', 'annot-thread-text', comment));
        return item;
      };
      thread.appendChild(buildItem('main', existing.author, existing.comment, existing.createdAt));
      getReplies(existing).forEach(r => thread.appendChild(buildItem('reply', r.author, r.comment, r.createdAt)));
      popup.appendChild(thread);
    }

    const compose   = mkEl('div', 'annot-popup-compose');
    const ta        = mkEl('textarea');
    const actions   = mkEl('div', 'annot-popup-actions');
    const cancelBtn = mkEl('button', 'annot-btn', 'Cancel');
    cancelBtn.onclick = closePopup;
    addKbd(cancelBtn, 'Esc');

    if (existing && !isFrozen) {
      compose.appendChild(mkEl('div', 'annot-compose-label', 'Edit note'));
      ta.value = existing.comment;
      ta.placeholder = 'Edit your note…';
      const saveBtn = mkEl('button', 'annot-btn annot-btn-primary', 'Update');
      saveBtn.onclick = () => commitEdit(existing, ta.value);
      addKbd(saveBtn, SAVE_KBD);
      actions.append(cancelBtn, saveBtn);
      ta.onkeydown = ev => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); commitEdit(existing, ta.value); }
        if (ev.key === 'Escape') { ev.preventDefault(); closePopup(); }
      };
    } else if (existing) {
      compose.appendChild(mkEl('div', 'annot-compose-label', 'Reply'));
      ta.placeholder = 'Your reply…';
      const replyBtn = mkEl('button', 'annot-btn annot-btn-primary', 'Reply');
      replyBtn.onclick = () => commitReply(existing, ta.value);
      addKbd(replyBtn, SAVE_KBD);
      actions.append(cancelBtn, replyBtn);
      ta.onkeydown = ev => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); commitReply(existing, ta.value); }
        if (ev.key === 'Escape') { ev.preventDefault(); closePopup(); }
      };
    } else {
      ta.placeholder = 'Your note…';
      // Quick-action presets: prefill the note so the common asks are one
      // click + Save, while still letting the reviewer append detail.
      const chips = mkEl('div', 'annot-chips');
      QUICK_ACTIONS.forEach(preset => {
        const chip = mkEl('button', 'annot-chip', preset);
        chip.onclick = () => {
          ta.value = preset;
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        };
        chips.appendChild(chip);
      });
      compose.appendChild(chips);
      const saveBtn = mkEl('button', 'annot-btn annot-btn-primary', 'Save');
      saveBtn.onclick = () => commitNew(target, ta.value);
      addKbd(saveBtn, SAVE_KBD);
      actions.append(cancelBtn, saveBtn);
      ta.onkeydown = ev => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); commitNew(target, ta.value); }
        if (ev.key === 'Escape') { ev.preventDefault(); closePopup(); }
      };
      // Until the reviewer has a name, capture it inline — a subtle footer that
      // sits under the note, never stealing focus from the textarea.
      if (!nameSet) showIdentity = true;
    }

    compose.append(ta, actions);
    if (showIdentity) compose.insertBefore(buildIdentityField(), actions);
    popup.appendChild(compose);
    document.body.appendChild(popup);
    activePopup = { el: popup, target, detach: () => document.removeEventListener('pointerdown', outsideClose, true) };
    positionPopup(popup, target);
    // iOS only raises the keyboard for a focus() made inside the tap's own
    // handler, so focus synchronously on touch; desktop keeps the deferred focus.
    if (IS_TOUCH) { try { ta.focus({ preventScroll: true }); } catch { ta.focus(); } }
    else setTimeout(() => ta.focus(), 10);

    setTimeout(() => document.addEventListener('pointerdown', outsideClose, true), 0);
    function outsideClose(ev) {
      if (!popup.contains(ev.target)) {
        document.removeEventListener('pointerdown', outsideClose, true);
        closePopup();
      }
    }
  }

  /* ── phone composer ─────────────────────────────────────────────────
     One full-screen surface for new notes, edits and replies on phones:
     a top bar (✕ · target label · Save) and a textarea filling the rest.
     Nothing sits at the bottom, so the keyboard and the iOS accessory bar
     can't hide an action. It never closes on blur — tapping the keyboard's
     Done just lowers the keyboard and the draft stays put. A cancelled
     draft is also kept and restored if the same composer is reopened. */
  let phoneDraft = null;   // { key, text }
  function openPhoneComposer(kind, target, existing) {
    closePopup();
    const key = kind + ':' + (existing ? existing.id : (target && target.dataset ? (target.dataset.annotRef || structuralPath(target)) : ''));
    const popup = mkEl('div', 'annot-popup annot-fullsheet');
    popup.setAttribute('role', 'dialog');

    const bar    = mkEl('div', 'annot-fs-bar');
    const cancel = mkEl('button', 'annot-fs-cancel');
    cancel.innerHTML = ICON_CLOSE;
    cancel.setAttribute('aria-label', 'Cancel');
    const label  = mkEl('div', 'annot-fs-label');
    const snippet = existing ? (existing.textSnippet || '') : (textSnippet(target) || '');
    const clipped = snippet.length > 40 ? snippet.slice(0, 40) + '…' : snippet;
    if (existing) label.appendChild(mkEl('b', null, (kind === 'edit' ? 'Edit #' : 'Reply #') + existing.localId));
    label.appendChild(document.createTextNode(clipped ? `“${clipped}”` : (existing ? '' : 'New note')));
    const save = mkEl('button', 'annot-btn annot-btn-primary annot-fs-save', kind === 'reply' ? 'Reply' : 'Save');
    bar.append(cancel, label, save);

    const ta = mkEl('textarea');
    ta.setAttribute('aria-label', kind === 'reply' ? 'Your reply' : 'Your note');
    ta.placeholder = kind === 'reply' ? 'Your reply…' : 'Your note…';
    ta.value = (phoneDraft && phoneDraft.key === key) ? phoneDraft.text
             : (kind === 'edit' ? existing.comment : '');

    popup.append(bar, ta);
    document.body.appendChild(popup);
    pinFullSheet(popup);

    const commit = () => {
      const text = ta.value;
      phoneDraft = null;
      if (kind === 'new')        commitNew(target, text);
      else if (kind === 'edit')  commitEdit(existing, text);
      else                       commitReply(existing, text);
    };
    const dismiss = () => {
      phoneDraft = ta.value.trim() ? { key, text: ta.value } : null;
      closePopup();
    };
    cancel.onclick = (e) => { e.stopPropagation(); dismiss(); };
    save.onclick   = (e) => { e.stopPropagation(); commit(); };
    ta.onkeydown = ev => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); dismiss(); }
    };
    // Keep the draft on blur (the keyboard's Done) — no auto-close.
    ta.addEventListener('blur', () => { if (ta.value.trim()) phoneDraft = { key, text: ta.value }; });

    activePopup = { el: popup, target, detach: null };
    // iOS raises the keyboard only for a focus() inside the tap's handler.
    if (IS_TOUCH) { try { ta.focus({ preventScroll: true }); } catch { ta.focus(); } }
    else setTimeout(() => ta.focus(), 10);
    try { const n = ta.value.length; ta.setSelectionRange(n, n); } catch {}
  }

  function positionPopup(popup, target) {
    const rect = target.getBoundingClientRect();
    const pw   = popup.offsetWidth  || 340;
    const ph   = popup.offsetHeight || 200;
    let top    = rect.bottom + window.scrollY + 8;
    let left   = rect.left   + window.scrollX;
    if (left + pw > window.innerWidth - 16) left = window.innerWidth - pw - 16 + window.scrollX;
    if (left < 16 + window.scrollX) left = 16 + window.scrollX;
    if (top + ph > window.scrollY + window.innerHeight - 16) {
      top = rect.top + window.scrollY - ph - 8;
      if (top < window.scrollY + 16) top = window.scrollY + 16;
    }
    popup.style.top  = top  + 'px';
    popup.style.left = left + 'px';
  }

  function closePopup() {
    if (activePopup) {
      if (activePopup.detach) activePopup.detach();
      activePopup.el.remove(); activePopup = null;
      // A tap leaves the emulated :hover outline stuck on the element.
      if (lastPointerType !== 'mouse') clearHover();
    }
  }

  /* ── commits ─────────────────────────────────────────────────────── */
  function commitNew(target, raw) {
    const comment = (raw || '').trim();
    if (!comment) { closePopup(); return; }
    if (SYNC && !identity) { requireIdentity(() => commitNew(target, raw)); return; }
    // First successful note locks in the reviewer identity — even if they left
    // the inline name blank and kept the default — so we never ask again.
    nameSet = true;
    if (!store.get(REVIEWER_KEY)) store.set(REVIEWER_KEY, reviewerName);
    // Compute the durable anchor BEFORE stamping the volatile ref, so the
    // persisted anchor survives a reload (the data-annot-ref attribute does not)
    // and so the ref attribute itself can never leak into the selector.
    const durableAnchor   = buildAnchor(target);
    const durableSelector = durableAnchor ? durableAnchor.selector : '';
    if (!target.dataset.annotRef) target.dataset.annotRef = 'a' + Math.random().toString(36).slice(2, 9);
    const frozenOnPage = frozenAnnotations.filter(f => f.page === PAGE && !f.isShadow).length;
    const liveOnPage   = annotations.filter(a => a.page === PAGE && !a.isShadow).length;
    const noteId       = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    sessionNoteIds.add(noteId);
    annotations.push({
      id:             noteId,
      localId:        frozenOnPage + liveOnPage + 1,
      page:           PAGE,
      pageTitle:      PAGE_TITLE,
      createdAt:      new Date().toISOString(),
      ref:            target.dataset.annotRef,
      selector:       durableSelector,
      anchor:         durableAnchor,        // verified {selector, tagName, text} — null when nothing is trustworthy
      elementPath:    elementPath(target),   // complete DOM path (with classes) — for the LLM
      structuralPath: structuralPath(target),// class-free path — the element ID shown on the card
      tag:            tagDescription(target),
      sectionContext: sectionContextFor(target),
      textSnippet:    textSnippet(target),
      author:         reviewerName,
      authorId:       identity ? identity.userId : undefined,
      comment,
      replies:        [],
      frozen:         false,
    });
    syncSend({ type: 'note.add', note: sanitizeNote(annotations[annotations.length - 1]) });
    saveLive(); closePopup(); refresh(); toast('Note saved');
  }

  function commitEdit(existing, raw) {
    const comment = (raw || '').trim();
    if (!comment) { closePopup(); return; }
    if (SYNC && !isMine(existing)) { closePopup(); toast('Only the author can edit this note'); return; }
    existing.comment   = comment;
    existing.updatedAt = new Date().toISOString();
    syncSend({ type: 'note.update', id: existing.id, comment, updatedAt: existing.updatedAt });
    saveLive(); closePopup(); refresh(); toast('Note updated');
  }

  function commitReply(annotation, raw) {
    const comment = (raw || '').trim();
    if (!comment) { closePopup(); return; }
    if (SYNC && !identity) { requireIdentity(() => commitReply(annotation, raw)); return; }
    const target = annotation.frozen ? findOrCreateShadow(annotation) : annotation;
    const replyId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    sessionNoteIds.add(replyId);
    const reply = { id: replyId, author: reviewerName, comment, createdAt: new Date().toISOString() };
    if (identity) reply.authorId = identity.userId;
    (target.replies = target.replies || []).push(reply);
    // Replies on a baked (frozen) note live in a local shadow, not on the relay.
    if (!target.isShadow) syncSend({ type: 'reply.add', noteId: target.id, reply });
    saveLive(); closePopup(); refresh(); toast('Reply saved');
  }

  function findOrCreateShadow(frozenAnnot) {
    let s = annotations.find(a => a.parentFrozenId === frozenAnnot.id);
    if (!s) {
      s = { id: 'shadow-' + frozenAnnot.id, parentFrozenId: frozenAnnot.id, page: frozenAnnot.page, replies: [], frozen: false, isShadow: true };
      annotations.push(s);
    }
    return s;
  }

  /* ── badges ──────────────────────────────────────────────────────── */
  // Notes that share an element would stack on the exact same corner, so
  // only the newest number showed (and on phones, where the pin is the only
  // way in, the rest were unreachable). Up to PIN_FAN pins fan out leftwards
  // from the corner; past that one stack pin ("#4 +8") opens a list.
  const PIN_FAN = 3;
  function makeBadge(a) {
    const badge   = mkEl('div', 'annot-badge' + (a.frozen ? ' frozen' : '') + (a.resolved ? ' resolved' : ''));
    const numSpan = mkEl('span', 'annot-badge-num', '#' + a.localId);
    badge.appendChild(numSpan);

    if (!a.frozen && (!SYNC || isMine(a))) {
      const delSpan = mkEl('span', 'annot-badge-del', '×');
      badge.appendChild(delSpan);
    }

    badge.title   = a.comment.slice(0, 200);
    badge.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      // Phone: the badge is the way into the note (cards are hidden).
      if (isCompact()) { openCardSheet(a.id); return; }
      // If × is showing (hover state active), treat whole badge as delete.
      // A tap's emulated hover must never turn the badge into a delete.
      const del = badge.querySelector('.annot-badge-del');
      if (lastPointerType === 'mouse' && del && window.getComputedStyle(del).display !== 'none') {
        confirmDelete(badge, () => deleteAnnot(a));
      } else {
        scrollToCard(a.id);
      }
    };
    return badge;
  }
  function renderBadges() {
    document.querySelectorAll('.annot-badge').forEach(b => b.remove());
    const groups = new Map();   // element → notes anchored to it, oldest first
    allAnnotations().filter(a => a.page === PAGE && !a.isShadow).forEach(a => {
      const target = resolveTarget(a);
      if (!target) return;
      if (!groups.has(target)) { groups.set(target, []); if (layoutObserver) layoutObserver.observe(target); }
      groups.get(target).push(a);
    });
    // On a phone a badge can widen the layout viewport, so clamp to the
    // device screen too (clientWidth already includes the overflow).
    let vw = document.documentElement.clientWidth || window.innerWidth;
    if (IS_TOUCH && window.screen && window.screen.width) vw = Math.min(vw, window.screen.width);
    groups.forEach((notes, target) => {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      notes.sort((x, y) => (x.localId || 0) - (y.localId || 0));
      const badges = notes.length <= PIN_FAN ? notes.map(makeBadge) : [makeStackBadge(notes, target)];
      const top = rect.top + window.scrollY - 10;
      // Touch badges carry a 12px invisible hit area (::after); keep it on screen too.
      const edge = window.scrollX + vw - (IS_TOUCH ? 14 : 4);
      let right = Math.min(rect.right + window.scrollX - 14, edge);   // right edge budget for the next pin
      badges.forEach((badge, i) => {
        badge.style.top = top + 'px';
        badge.style.left = '0px';
        document.body.appendChild(badge);
        const w = badge.offsetWidth;
        // The first pin keeps its old spot (corner, clamped to the screen);
        // the others sit to its left with a small gap.
        const left = i === 0 ? Math.min(rect.right + window.scrollX - 14, edge - w) : right - w;
        badge.style.left = Math.max(window.scrollX + 2, left) + 'px';
        right = Math.max(window.scrollX + 2, left) - 4;
      });
    });
    if (stackList) renderStackList();
  }
  function makeStackBadge(notes, target) {
    const open = notes.filter(n => !n.resolved);
    const badge = mkEl('div', 'annot-badge annot-badge-stack' + (open.length ? '' : ' resolved'));
    badge.append(mkEl('span', 'annot-badge-num', '#' + notes[0].localId), mkEl('span', 'annot-badge-more', '+' + (notes.length - 1)));
    badge.title = notes.length + ' comments on this element';
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', notes.length + ' comments here. Show the list.');
    badge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openStackList(target, badge); };
    return badge;
  }

  // The list behind a stack pin: one row per thread. Phones get it as the
  // same inset modal as a thread; desktop as a popover under the pin.
  let stackList = null;   // { el, target }
  function openStackList(target, badge) {
    closeStackList();
    closeCardSheet();
    const el = mkEl('div', 'annot-stack-list');
    el.setAttribute('role', 'dialog');
    stackList = { el, target };
    document.body.appendChild(el);
    renderStackList();
    if (isCompact()) {
      el.classList.add('annot-stack-sheet');
      document.body.classList.add('annot-sheet-open');
      pinFullSheet(el, SHEET_INSET);
    } else {
      const r = badge.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = Math.min(r.right - w, window.innerWidth - w - 12);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
      el.style.left = Math.max(12, left) + 'px';
      el.style.top = top + 'px';
    }
    target.classList.add('annot-target-active');
    setTimeout(() => document.addEventListener('pointerdown', outsideStackList, true), 0);
  }
  function renderStackList() {
    const { el, target } = stackList;
    const notes = allAnnotations().filter(a => a.page === PAGE && !a.isShadow && resolveTarget(a) === target)
      .sort((x, y) => (x.localId || 0) - (y.localId || 0));
    if (!notes.length) { closeStackList(); return; }
    el.textContent = '';
    const bar = mkEl('div', 'annot-stack-bar');
    const title = mkEl('div', 'annot-sheet-title', notes.length === 1 ? '1 comment here' : notes.length + ' comments here');
    const close = mkEl('button', 'annot-stack-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.onclick = (e) => { e.stopPropagation(); closeStackList(); };
    bar.append(title, close);
    const rows = mkEl('div', 'annot-stack-rows');
    notes.forEach(a => {
      const row = mkEl('button', 'annot-stack-row' + (a.resolved ? ' resolved' : ''));
      row.type = 'button';
      const head = mkEl('div', 'annot-stack-head');
      head.append(mkEl('span', 'annot-stack-num', '#' + a.localId), mkEl('span', 'annot-stack-author', a.author || 'Reviewer'));
      const nReplies = (a.replies || []).length;
      if (nReplies) head.appendChild(mkEl('span', 'annot-stack-meta', nReplies === 1 ? '1 reply' : nReplies + ' replies'));
      if (a.resolved) head.appendChild(mkEl('span', 'annot-stack-meta', 'Resolved'));
      row.append(head, mkEl('div', 'annot-stack-text', a.comment || ''));
      row.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        closeStackList();
        if (isCompact()) openCardSheet(a.id); else scrollToCard(a.id);
      };
      rows.appendChild(row);
    });
    el.append(bar, rows);
  }
  function outsideStackList(ev) {
    if (ev.target.closest?.('.annot-stack-list')) return;
    if (!isUI(ev.target)) suppressClickUntil = Date.now() + 700;
    closeStackList();
  }
  function closeStackList() {
    if (!stackList) return;
    document.removeEventListener('pointerdown', outsideStackList, true);
    stackList.target.classList.remove('annot-target-active');
    stackList.el.remove();
    stackList = null;
    if (!sheetCardId) document.body.classList.remove('annot-sheet-open');
  }

  // Resolve an annotation to a live element, or null. Null is a real answer:
  // the comment is kept and rendered as orphaned. It is NEVER a licence to
  // guess — a note shown against the wrong element is worse than one shown
  // with a "target is gone" badge, because the reviewer can't tell.
  function resolveTarget(a) {
    let t = null;
    // Session identity. data-annot-ref is stamped by us and unique by
    // construction, so a single hit needs no further verification; two hits
    // mean the page was duplicated and the ref is no longer identifying.
    if (a.ref) {
      try {
        const refHits = document.querySelectorAll(`[data-annot-ref="${a.ref}"]`);
        if (refHits.length === 1) t = refHits[0];
      } catch { t = null; }
    }
    // Reload / export: re-resolve from durable data, failing closed.
    if (!t) t = a.anchor ? resolveAnchor(a.anchor) : resolveLegacySelector(a.selector);
    // Re-anchor: the data-annot-ref attribute lives only in the session DOM and
    // is gone after a reload, so we re-stamp the ref onto the resolved element.
    // Without this, persisted comments silently vanish on refresh / after
    // export even though they're safe in localStorage.
    if (t && a.ref && t.dataset.annotRef !== a.ref) t.dataset.annotRef = a.ref;
    return t;
  }

  /* ── annotation cards ────────────────────────────────────────────── */
  function renderAnnotationCards() {
    document.querySelectorAll('.annot-card').forEach(c => c.remove());
    const pageAnnots = allAnnotations().filter(a => a.page === PAGE && !a.isShadow);
    if (pageAnnots.length === 0) return;

    pageAnnots.forEach(a => {
      // A note whose element we can no longer resolve is NOT dropped. Dropping
      // it made the comment look deleted while it sat in localStorage, and it
      // hid the fact that the artefact had changed under the review. It renders
      // as an orphan card at the bottom of the margin instead.
      const target   = resolveTarget(a);
      const orphaned = !target;
      const rect     = target ? target.getBoundingClientRect() : null;

      const card = mkEl('div', 'annot-card' + (a.frozen ? ' frozen' : '') + (a.resolved ? ' resolved' : '') + (orphaned ? ' orphaned' : ''));
      card.dataset.annotId = a.id;
      if (orphaned) card.dataset.annotOrphaned = '1';

      // head: avatar + author + time + actions (resolve, menu)
      const head = mkEl('div', 'annot-card-head');
      const av   = mkEl('img', 'annot-avatar');
      av.src     = generateAvatar(a.author || 'Reviewer');
      av.alt     = a.author || 'Reviewer';
      av.style.cssText = 'width:24px;height:24px;flex-shrink:0;border-radius:50%;display:block;';
      const authorEl = mkEl('span', 'annot-card-author', a.author || 'Reviewer');
      const timeEl   = mkEl('span', 'annot-card-time',   fmtRelTime(a.createdAt));
      timeEl.dataset.ts = a.createdAt || '';
      if (SYNC && a.resolved && a.resolvedBy) card.title = 'Resolved by ' + a.resolvedBy;

      const actions = mkEl('div', 'annot-card-actions');

      const resolveBtn = mkEl('button', 'annot-card-btn resolve' + (a.resolved ? ' done' : ''));
      resolveBtn.innerHTML = ICON_CHECK;
      resolveBtn.setAttribute('data-tooltip', a.resolved ? 'Unresolve' : 'Resolve');
      resolveBtn.onclick = (e) => { e.stopPropagation(); toggleResolve(a); };

      const menuBtn = mkEl('button', 'annot-card-btn');
      menuBtn.innerHTML = ICON_MENU_H;
      menuBtn.setAttribute('data-tooltip', 'More');
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        // close any existing menu first
        document.querySelectorAll('.annot-card-menu').forEach(m => m.remove());
        const menu = mkEl('div', 'annot-card-menu');
        const copyItem = mkEl('button', 'annot-card-menu-item');
        copyItem.innerHTML = ICON_COPY + '<span>Copy comment</span>';
        copyItem.onclick = () => { menu.remove(); copyAnnotation(a); };
        if (!a.frozen && (!SYNC || isMine(a))) {
          const editItem = mkEl('button', 'annot-card-menu-item');
          editItem.innerHTML = ICON_EDIT + '<span>Edit</span>';
          editItem.onclick = () => {
            menu.remove();
            if (isCompact()) openPhoneComposer('edit', resolveTarget(a), a);
            else openInlineEdit(card, a);
          };
          const delItem = mkEl('button', 'annot-card-menu-item danger');
          delItem.innerHTML = ICON_TRASH + '<span>Delete</span>';
          delItem.onclick = () => { menu.remove(); confirmDelete(menuBtn, () => deleteAnnot(a)); };
          menu.append(copyItem, editItem, delItem);
        } else {
          menu.appendChild(copyItem);
        }
        document.body.appendChild(menu);
        // position near button
        const br = menuBtn.getBoundingClientRect();
        let menuTop = br.bottom + 4;
        if (menuTop + menu.offsetHeight > window.innerHeight - 8) menuTop = Math.max(8, br.top - menu.offsetHeight - 4);
        menu.style.top  = menuTop + 'px';
        menu.style.left = Math.max(8, br.right - menu.offsetWidth) + 'px';
        setTimeout(() => {
          function outsideMenuClose(ev) {
            if (!menu.contains(ev.target) && ev.target !== menuBtn) {
              menu.remove();
              document.removeEventListener('pointerdown', outsideMenuClose, true);
            }
          }
          document.addEventListener('pointerdown', outsideMenuClose, true);
        }, 0);
      };

      // Phone thread modal: a top bar with the thread number and a big close.
      // Hidden unless the card is open as a modal (.annot-sheet).
      const sheetBar = mkEl('div', 'annot-sheet-bar');
      const sheetTitle = mkEl('div', 'annot-sheet-title', 'Comment #' + (a.localId || ''));
      const nReplies = (a.replies || []).length;
      if (nReplies) sheetTitle.appendChild(mkEl('span', '', nReplies === 1 ? '1 reply' : nReplies + ' replies'));
      const closeSheetBtn = mkEl('button', 'annot-card-close');
      closeSheetBtn.innerHTML = ICON_CLOSE;
      closeSheetBtn.setAttribute('aria-label', 'Close comment');
      closeSheetBtn.onclick = (e) => { e.stopPropagation(); closeCardSheet(); };
      sheetBar.append(sheetTitle, closeSheetBtn);
      card.appendChild(sheetBar);

      actions.append(resolveBtn, menuBtn);
      head.append(av, authorEl, timeEl, actions);
      card.appendChild(head);

      // body: element ID + snippet + comment with clamp + replies + input row
      const body = mkEl('div', 'annot-card-body');

      if (orphaned) {
        const warn = mkEl('div', 'annot-orphan-note');
        warn.innerHTML = ICON_ORPHAN;
        const txt = mkEl('div', '', 'Element not found on this page — the note is unanchored.');
        const where = annotElId(a);
        if (where) { const c = mkEl('code', '', where); txt.appendChild(c); }
        warn.appendChild(txt);
        body.appendChild(warn);
      }

      const cardElId = annotElId(a);
      if (cardElId && !orphaned) {
        const elIdWrap = mkEl('div', 'annot-card-elid');
        elIdWrap.appendChild(elIdChip(cardElId));
        body.appendChild(elIdWrap);
      }

      if (a.textSnippet) {
        const snip = mkEl('div', 'annot-card-snippet');
        snip.textContent = `"${a.textSnippet.slice(0, 70)}${a.textSnippet.length > 70 ? '…' : ''}"`;
        body.appendChild(snip);
      }

      const commentEl = mkEl('div', 'annot-card-comment', a.comment);
      body.appendChild(commentEl);

      // "... more" toggle — shown after render if text overflows
      const moreBtn = mkEl('button', 'annot-card-more', '... more');
      moreBtn.style.display = 'none';
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        commentEl.classList.add('expanded');
        moreBtn.style.display = 'none';
      };
      body.appendChild(moreBtn);

      // replies
      const replies = getReplies(a);
      if (replies.length > 0) {
        const divider = mkEl('hr', 'annot-card-divider');
        body.appendChild(divider);
        replies.forEach(r => {
          const rItem = mkEl('div', 'annot-card-reply-item');
          const rHead = mkEl('div', 'annot-reply-head');
          const rAv   = mkEl('img', 'annot-avatar');
          rAv.src     = generateAvatar(r.author || 'Reviewer');
          rAv.alt     = r.author || 'Reviewer';
          rAv.style.cssText = 'width:18px;height:18px;flex-shrink:0;border-radius:50%;display:block;';
          const rAuthor = mkEl('span', 'annot-reply-author', r.author || 'Reviewer');
          const rTime   = mkEl('span', 'annot-reply-time',   fmtRelTime(r.createdAt));
          rTime.dataset.ts = r.createdAt || '';
          rHead.append(rAv, rAuthor, rTime);
          const rText = mkEl('div', 'annot-reply-text', r.comment);
          rItem.append(rHead, rText);
          body.appendChild(rItem);
        });
      }

      // inline reply input row
      const inputRow = mkEl('div', 'annot-card-input-row');
      const replyAv  = mkEl('img', 'annot-avatar');
      replyAv.src    = generateAvatar(reviewerName);
      replyAv.alt    = reviewerName;
      replyAv.style.cssText = 'width:24px;height:24px;flex-shrink:0;border-radius:50%;display:block;';
      const replyInput = mkEl('input', '');
      replyInput.type        = 'text';
      replyInput.placeholder = 'Reply...';
      replyInput.onkeydown   = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const val = replyInput.value.trim();
          if (val) { commitReply(a, val); replyInput.value = ''; }
        }
      };
      const sendBtn = mkEl('button', 'annot-card-send');
      sendBtn.innerHTML = ICON_SEND;
      sendBtn.setAttribute('aria-label', 'Send reply');
      sendBtn.onclick = (e) => {
        e.stopPropagation();
        const val = replyInput.value.trim();
        if (val) { commitReply(a, val); replyInput.value = ''; }
      };
      inputRow.append(replyAv, replyInput, sendBtn);
      // Phones: typing in the sheet would put the field under the keyboard.
      // The reply row becomes a button into the full-screen composer.
      if (isCompact()) {
        replyInput.readOnly = true;
        replyInput.setAttribute('inputmode', 'none');
        const openReply = (e) => {
          e.preventDefault(); e.stopPropagation();
          openPhoneComposer('reply', resolveTarget(a), a);
        };
        replyInput.onclick = openReply;
        sendBtn.onclick    = openReply;
      }
      body.appendChild(inputRow);

      card.appendChild(body);

      card.onclick = (e) => {
        if (e.target.closest('.annot-card-actions,.annot-card-menu,.annot-card-editor')) return;
        if (lastPointerType !== 'mouse') return;   // a tap to read shouldn't raise the keyboard
        replyInput.focus();
      };

      card.addEventListener('mouseenter', () => {
        focusCard(a.id);
        const t = resolveTarget(a);
        if (t) t.classList.add('annot-target-active');
      });
      card.addEventListener('mouseleave', () => {
        unfocusCards();
        document.querySelectorAll('.annot-target-active').forEach(el => el.classList.remove('annot-target-active'));
      });

      // Orphans have no rect to anchor to; positionCards() parks them below
      // the last resolved card so they don't cover the artefact.
      card.style.top = rect ? (rect.top + window.scrollY - 10) + 'px' : '0px';
      document.body.appendChild(card);
      if (a.id === sheetCardId && isCompact()) { card.classList.add('annot-sheet'); document.body.classList.add('annot-sheet-open'); pinSheet(card); }

      // show "... more" button if comment text is clamped
      requestAnimationFrame(() => {
        if (commentEl.scrollHeight > commentEl.clientHeight + 2) {
          moreBtn.style.display = 'inline';
        }
      });
    });

    positionCards();
  }

  function positionCards() {
    const cards = Array.from(document.querySelectorAll('.annot-card[data-annot-id]'));
    // Re-anchor each card to its target's current Y position (read phase)
    const orphans = [];
    let lastResolvedTop = 0;
    cards.forEach(card => {
      const a = allAnnotations().find(x => x.id === card.dataset.annotId);
      if (!a) return;
      const t = resolveTarget(a);
      if (!t) { orphans.push(card); return; }
      const top = t.getBoundingClientRect().top + window.scrollY - 10;
      card.dataset.idealTop = String(top);
      if (top > lastResolvedTop) lastResolvedTop = top;
    });
    // Orphans stack below the last anchored card, in creation order. Deriving
    // the base from the resolved cards (not document height) keeps it stable —
    // measuring the document would grow it on every pass, since the orphan
    // cards we just placed are themselves part of the document.
    orphans.forEach(card => { card.dataset.idealTop = String(lastResolvedTop + 24); });
    // Sort by ideal position, then resolve overlaps
    cards.sort((a, b) => parseFloat(a.dataset.idealTop) - parseFloat(b.dataset.idealTop));
    // Collect all heights before writing to avoid layout thrashing
    const heights = cards.map(card => card.offsetHeight);
    let minTop = 0;
    cards.forEach((card, i) => {
      if (card.classList.contains('annot-sheet')) return;   // docked; pinSheet owns it
      const ideal = parseFloat(card.dataset.idealTop) || 0;
      const actual = Math.max(ideal, minTop);
      card.style.top = actual + 'px';
      minTop = actual + heights[i] + 8;
    });
    reserveToolbarSpace(cards.length && !isCompact() ? minTop : 0);
  }
  // The comment column is absolutely positioned and can run past the page
  // end, under the floating toolbar. A spacer below the last card extends
  // the scroll height by the toolbar's footprint, so the last card and its
  // reply box can always be scrolled clear of it.
  function reserveToolbarSpace(columnBottom) {
    let sp = document.querySelector('.annot-card-spacer');
    if (!columnBottom) { if (sp) sp.remove(); return; }
    if (!sp) {
      sp = mkEl('div', 'annot-card-spacer');
      sp.setAttribute('aria-hidden', 'true');
      sp.style.cssText = 'position:absolute;left:0;width:1px;pointer-events:none;visibility:hidden;';
      document.body.appendChild(sp);
    }
    const fab = document.querySelector('.annot-fab-row');
    const fr = fab && getComputedStyle(fab).display !== 'none' ? fab.getBoundingClientRect() : null;
    const reserve = fr && fr.top > window.innerHeight / 2 ? (window.innerHeight - fr.top) + 16 : 24;
    sp.style.top = columnBottom + 'px';
    sp.style.height = Math.ceil(reserve) + 'px';
  }

  /* ── mutations ───────────────────────────────────────────────────── */
  function deleteAnnot(a) {
    if (SYNC && !isMine(a)) { toast('Only the author can delete this note'); return; }
    syncSend({ type: 'note.delete', id: a.id });
    annotations = annotations.filter(x => x.id !== a.id);
    renumberLive();
    saveLive(); refresh();
  }

  /* Inline "Confirm delete?" popover anchored on top of the trigger (the badge
     × or the card menu) — replaces the native window.confirm dialog. */
  function confirmDelete(anchorEl, onYes) {
    document.querySelectorAll('.annot-confirm-pop').forEach(p => p.remove());
    const pop = mkEl('div', 'annot-confirm-pop');
    const label = mkEl('span', 'annot-confirm-label', 'Confirm delete?');
    const yes = mkEl('button', 'annot-confirm-yes');
    yes.innerHTML = ICON_TRASH + '<span>Delete</span>';
    const no  = mkEl('button', 'annot-confirm-no', 'Cancel');
    pop.append(label, no, yes);
    document.body.appendChild(pop);

    // anchor centered above the trigger, flipping below / clamping to viewport
    const r  = anchorEl.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top  = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pop.style.top = top + 'px'; pop.style.left = left + 'px';

    const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
    yes.onclick = (e) => { e.stopPropagation(); close(); onYes(); };
    no.onclick  = (e) => { e.stopPropagation(); close(); };
    function outside(ev) { if (!pop.contains(ev.target)) close(); }
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  function toggleResolve(a) {
    if (SYNC && !identity) { requireIdentity(() => toggleResolve(a)); return; }
    a.resolved = !a.resolved;
    if (SYNC) {
      a.resolvedBy = a.resolved ? reviewerName : null;
      a.resolvedAt = a.resolved ? new Date().toISOString() : null;
      syncSend({ type: 'note.resolve', id: a.id, resolved: a.resolved, by: a.resolvedBy, at: a.resolvedAt });
    }
    saveLive(); refresh();
  }

  function _clearAnnotations() {
    if (SYNC) {
      // Multiplayer: Clear All removes only your own notes, for everyone.
      annotations.filter(a => !a.isShadow && isMine(a)).forEach(a => syncSend({ type: 'note.delete', id: a.id }));
      annotations = annotations.filter(a => a.isShadow || !isMine(a));
      renumberLive(); saveLive(); refresh();
      return;
    }
    annotations = [];
    saveLive(); refresh();
  }

  function clearAll() {
    const live = annotations.filter(a => !a.isShadow && (!SYNC || isMine(a))).length;
    if (live === 0) { toast('Nothing to clear'); return; }
    if (SYNC) {
      confirmModal({
        title: `Clear your ${live} comment${live === 1 ? '' : 's'}?`,
        body: 'This removes the comments you wrote, for everyone viewing this page. Comments by others stay. It cannot be undone.',
        confirmLabel: 'Clear mine',
        danger: true,
        onConfirm: () => { _clearAnnotations(); toast('Your comments were cleared'); }
      });
      return;
    }
    confirmModal({
      title: `Clear all ${live} comment${live === 1 ? '' : 's'}?`,
      body: 'This removes every comment on this page. It cannot be undone.',
      confirmLabel: 'Clear all',
      danger: true,
      onConfirm: () => { _clearAnnotations(); toast('Comments cleared'); }
    });
  }

  /* ── save version ────────────────────────────────────────────────── */
  function saveVersion() {
    const liveCount = annotations.filter(a => !a.isShadow).length;
    if (liveCount === 0 && frozenAnnotations.length === 0) { toast('No annotations to bake'); return; }
    if (savedVersion > 0 && annotIdsMatch(savedAnnotIds, annotations)) { toast(`Already saved as v${savedVersion} — add new annotations first`); return; }

    const nextVersion = Math.max(frozenVersion || 0, savedVersion, FILE_VERSION) + 1;
    const rawBase  = decodeURIComponent(location.pathname.split('/').pop()).replace(/(_v\d+)?\.html$/i, '') || 'artefact';
    const newPage  = (rawBase + '_v' + nextVersion + '.html').toLowerCase();
    // Deduplicate by id — frozen wins over live when both exist (same origin, same id).
    // Happens when localStorage still holds the original session's live annotations.
    const seenIds = new Set();
    const toFreeze = allAnnotations()
      .filter(a => !a.isShadow)
      .filter(a => { if (seenIds.has(a.id)) return false; seenIds.add(a.id); return true; })
      .map(a => ({ ...a, frozen: true, page: newPage, replies: getReplies(a) }));
    const payload  = { version: nextVersion, bakedAt: new Date().toISOString(), annotations: toFreeze };

    const clone     = document.documentElement.cloneNode(true);
    clone.querySelectorAll(
      '.annot-fab-row,.annot-icon-fab,.annot-actions-btn,.annot-actions-panel,.annot-popup,.annot-modal-overlay,.annot-tooltip,' +
      '.annot-badge,.annot-card,.annot-card-spacer,.annot-toast,.annot-collapser,.annot-stack-list,#sm-annotator-style'
    ).forEach(el => el.remove());
    const cloneBody = clone.querySelector('body');
    if (cloneBody) ['annot-mode','annot-hover','annot-ui-collapsed'].forEach(c => cloneBody.classList.remove(c));

    // Embed as an executable JS global in <head> — runs before the annotator
    // body script, so window.__smBaked is always available in loadFrozen().
    // Escape <\/script> sequences to prevent premature tag close when inlined.
    let bakedEl = clone.querySelector('#sm-annotations-baked');
    if (!bakedEl) {
      bakedEl    = document.createElement('script');
      bakedEl.id = 'sm-annotations-baked';
      const cloneHead = clone.querySelector('head');
      (cloneHead || cloneBody)?.appendChild(bakedEl);
    }
    // Unicode-escape < and > so no sequence can close the <script> tag.
    const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    bakedEl.textContent = `window.__smBaked=${safeJson};`;

    const html = '<!DOCTYPE html>\n' + clone.outerHTML;
    const link = { download: `${rawBase}_v${nextVersion}.html` };
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), link.download);
    savedVersion  = nextVersion;
    savedAnnotIds = new Set(annotations.filter(a => !a.isShadow).map(a => a.id));
    store.set(VERSION_KEY, String(nextVersion));
    toast(`Saved as ${link.download}`);
  }

  /* ── export ──────────────────────────────────────────────────────── */
  function buildMarkdown() {
    const all      = allAnnotations().filter(a => !a.isShadow);
    const vMatch   = PAGE.match(/_v(\d+)\.html$/i);
    const pageVer  = vMatch ? parseInt(vMatch[1], 10) : 0;
    const version  = frozenVersion > 0 ? ` v${frozenVersion}` : pageVer > 0 ? ` v${pageVer}` : '';
    const lines = [`# ${ARTEFACT_NAME}${version}`, ''];
    const byPage = {};
    all.forEach(a => { (byPage[a.page] = byPage[a.page] || []).push(a); });
    Object.keys(byPage).sort().forEach(p => {
      if (Object.keys(byPage).length > 1) lines.push(`## ${byPage[p][0]?.pageTitle || p}`, '');
      byPage[p].forEach(a => {
        const who = a.author || 'Reviewer';
        const path = a.elementPath || a.selector || '';
        const snip = a.textSnippet ? `"${a.textSnippet.slice(0, 60)}${a.textSnippet.length > 60 ? '…' : ''}"` : '';
        lines.push(`**#${a.localId}** ${who}${snip ? ' · ' + snip : ''}`);
        if (path) lines.push(`- Element: \`${path}\``);
        // Flag unanchored notes so a reader — human or LLM — knows the markup
        // this was written about is no longer in the file.
        if (!resolveTarget(a)) lines.push('- ⚠ Element not found in the current page — this note may be stale.');
        lines.push(a.comment);
        getReplies(a).forEach(r => lines.push(`  ↳ ${r.author || 'Reviewer'}: ${r.comment}`));
        lines.push('');
      });
    });
    return lines.join('\n');
  }

  function exportFileName() {
    return `${slug(ARTEFACT_NAME)}-annotations-${new Date().toISOString().slice(0,10)}.md`;
  }
  function exportText() {
    const filePath = decodeURIComponent(location.pathname);
    const preamble = `File: ${filePath}\nBefore making changes, check if there is an equivalent .md file at the same path that should be updated first.\n\n`;
    return preamble + buildMarkdown();
  }
  // Blob download. The object URL is revoked late: iOS Safari starts the
  // download asynchronously and fails if the URL is already gone.
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  // Phones: hand the .md to the native share sheet (Mail, Slack, AirDrop,
  // Save to Files…). Returns false when the platform can't share files, so the
  // caller falls back to a plain download. Must run inside the tap handler.
  function shareMarkdownFile(text, filename, onDone) {
    if (!IS_TOUCH || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
    let file;
    try { file = new File([text], filename, { type: 'text/markdown' }); } catch { return false; }
    let ok = false;
    try { ok = navigator.canShare({ files: [file] }); } catch {}
    if (!ok) return false;
    navigator.share({ files: [file], title: filename }).then(onDone).catch(err => {
      if (err && err.name === 'AbortError') return;   // reviewer closed the sheet
      downloadBlob(new Blob([text], { type: 'text/markdown' }), filename);
      onDone();
    });
    return true;
  }

  function exportMarkdown() {
    const all = allAnnotations().filter(a => !a.isShadow);
    if (all.length === 0) { toast('No annotations yet'); return; }
    const text = exportText();
    const name = exportFileName();
    // Comments are persistent: exporting must NOT wipe them. They stay on the
    // page (and in localStorage via saveLive) so they survive export + reload.
    // Use "Clear All Comments" (⇧C) to remove them deliberately.
    const done = () => toast('Exported \u2014 comments kept on the page');
    if (shareMarkdownFile(text, name, done)) return;
    downloadBlob(new Blob([text], { type: 'text/markdown' }), name);
    done();
  }

  // Shared clipboard write — navigator.clipboard throws on file:// origins in
  // Chrome and is often blocked in in-app / insecure mobile browsers, so fall
  // back to a hidden-textarea execCommand copy. Resolves true only when the
  // text is actually on the clipboard.
  async function writeClipboard(text) {
    if (location.protocol !== 'file:' && navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');   // readonly: no keyboard flash on phones
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    let ok = false;
    try { ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return !!ok;
  }

  // Clipboard unavailable: show the Markdown in a sheet the reviewer can
  // select by hand, plus Share (phones) and Download — never a dead end.
  function showMarkdownSheet(text, filename) {
    const overlay = mkEl('div', 'annot-modal-overlay');
    const dialog  = mkEl('div', 'annot-modal annot-md-sheet');
    const title   = mkEl('div', 'annot-modal-title', 'Your notes as Markdown');
    const body    = mkEl('div', 'annot-modal-body', "Copying isn't allowed in this browser. Select the text below, or send it as a file.");
    const area    = mkEl('textarea');
    area.readOnly = true; area.value = text;
    const actions = mkEl('div', 'annot-modal-actions');
    const close   = mkEl('button', 'annot-btn annot-md-sheet-close', 'Close');
    const dl      = mkEl('button', 'annot-btn', 'Download .md');
    actions.append(close, dl);
    if (typeof navigator.share === 'function') {
      const share = mkEl('button', 'annot-btn annot-btn-primary', 'Share…');
      share.onclick = () => {
        if (shareMarkdownFile(text, filename, () => {})) return;
        navigator.share({ title: filename, text }).catch(() => {});
      };
      actions.appendChild(share);
    }
    dialog.append(title, body, area, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const doClose = () => { overlay.remove(); if (activeModal === doClose) activeModal = null; };
    activeModal = doClose;
    close.onclick   = doClose;
    dl.onclick      = () => downloadBlob(new Blob([text], { type: 'text/markdown' }), filename);
    overlay.onclick = (e) => { if (e.target === overlay) doClose(); };
    area.onfocus    = () => area.select();
  }

  async function copyMarkdown() {
    const all = allAnnotations().filter(a => !a.isShadow);
    if (all.length === 0) { toast('No annotations yet'); return; }
    const text = exportText();
    if (!(await writeClipboard(text))) { showMarkdownSheet(text, exportFileName()); return; }
    // Comments are persistent: copying must NOT wipe them (they remain on the
    // page and in localStorage). Use "Clear All Comments" (⇧C) to remove.
    toast('Copied — comments kept. Paste into your AI assistant.');
  }

  // Copy a single comment as an LLM-ready block: element path + comment + replies.
  async function copyAnnotation(a) {
    const path = a.elementPath || a.selector || '';
    const snip = a.textSnippet ? `"${a.textSnippet.slice(0, 60)}${a.textSnippet.length > 60 ? '…' : ''}"` : '';
    const lines = [`**#${a.localId}** ${a.author || 'Reviewer'}${snip ? ' · ' + snip : ''}`];
    if (path) lines.push(`- Element: \`${path}\``);
    lines.push(a.comment);
    getReplies(a).forEach(r => lines.push(`  ↳ ${r.author || 'Reviewer'}: ${r.comment}`));
    if (!(await writeClipboard(lines.join('\n')))) { showMarkdownSheet(lines.join('\n'), exportFileName()); return; }
    toast('Comment copied');
  }

  /* ── highlights ──────────────────────────────────────────────────── */
  function updateTargetHighlights() {
    document.querySelectorAll('.annot-target').forEach(el => {
      el.classList.remove('annot-target', 'resolved');
      if (el._annotEnter) { el.removeEventListener('mouseenter', el._annotEnter); delete el._annotEnter; }
      if (el._annotLeave) { el.removeEventListener('mouseleave', el._annotLeave); delete el._annotLeave; }
    });
    allAnnotations().filter(a => a.page === PAGE && !a.isShadow).forEach(a => {
      const t = resolveTarget(a);
      if (!t) return;
      t.classList.add('annot-target');
      if (a.resolved) t.classList.add('resolved');
      t._annotEnter = () => focusCard(a.id);
      t._annotLeave = () => unfocusCards();
      t.addEventListener('mouseenter', t._annotEnter);
      t.addEventListener('mouseleave', t._annotLeave);
    });
  }

  function scrollToCard(annotId) {
    const card = document.querySelector(`.annot-card[data-annot-id="${annotId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusCard(annotId);
    setTimeout(() => unfocusCards(), 1800);
    const input = card.querySelector('.annot-card-input-row input');
    if (input) { setTimeout(() => input.focus(), 400); }
  }

  function openInlineEdit(card, a) {
    const body = card.querySelector('.annot-card-body');
    if (!body) return;
    const commentEl = body.querySelector('.annot-card-comment');
    if (!commentEl) return;
    const original = a.comment;
    commentEl.style.display = 'none';
    const moreBtn = body.querySelector('.annot-card-more');
    if (moreBtn) moreBtn.style.display = 'none';

    const editor = mkEl('div', 'annot-card-editor');
    const ta = mkEl('textarea');
    ta.value = original;
    ta.style.cssText = 'width:100%;min-height:70px;resize:vertical;background:var(--sm-bg);color:var(--sm-text);border:1px solid var(--sm-brand);border-radius:6px;padding:6px 8px;box-sizing:border-box;font-family:var(--sm-sans);font-size:12.5px;line-height:1.5;outline:none;margin-top:4px;';
    const row = mkEl('div');
    row.style.cssText = 'display:flex;gap:5px;margin-top:5px;justify-content:flex-end;';
    const cancelBtn = mkEl('button', 'annot-btn annot-btn-mini', 'Cancel');
    const saveBtn   = mkEl('button', 'annot-btn annot-btn-primary annot-btn-mini', 'Save');
    addKbd(cancelBtn, 'Esc');
    addKbd(saveBtn, SAVE_KBD);
    row.append(cancelBtn, saveBtn);
    editor.append(ta, row);
    body.appendChild(editor);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.value.length; }, 10);

    const restore = () => {
      editor.remove();
      commentEl.style.display = '';
      if (moreBtn) moreBtn.style.display = '';
    };
    cancelBtn.onclick = restore;
    saveBtn.onclick = () => {
      const text = ta.value.trim();
      if (text) commitEdit(a, text);
      restore();
    };
    ta.onkeydown = (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); saveBtn.click(); }
      if (ev.key === 'Escape') { ev.preventDefault(); restore(); }
    };
  }

  function focusCard(annotId) {
    document.body.classList.add('annot-has-focus');
    document.querySelectorAll('.annot-card').forEach(c => {
      c.classList.toggle('focused', c.dataset.annotId === annotId);
    });
  }

  function unfocusCards() {
    document.body.classList.remove('annot-has-focus');
    document.querySelectorAll('.annot-card.focused').forEach(c => c.classList.remove('focused'));
  }

  /* ── data helpers ────────────────────────────────────────────────── */
  function annotIdsMatch(saved, live) {
    if (!saved) return false;
    const liveIds = live.filter(a => !a.isShadow).map(a => a.id);
    if (liveIds.length !== saved.size) return false;
    return liveIds.every(id => saved.has(id));
  }
  function allAnnotations()  { return [...frozenAnnotations, ...annotations]; }
  function getReplies(a) {
    const base   = a.replies || [];
    const shadow = annotations.find(x => x.parentFrozenId === a.id);
    const extra  = shadow?.replies || [];
    const seen   = new Set(base.map(r => r.id));
    return [...base, ...extra.filter(r => !seen.has(r.id))];
  }
  function loadFrozen() {
    const d = window.__smBaked;
    if (!d) return { frozenAnnotations: [], frozenVersion: 0 };
    try {
      return { frozenAnnotations: (d.annotations || []).map(a => ({ ...a, frozen: true })), frozenVersion: d.version || 0 };
    } catch { return { frozenAnnotations: [], frozenVersion: 0 }; }
  }
  function loadLive()         { try { return JSON.parse(store.get(LIVE_KEY) || '[]'); } catch { return []; } }
  function saveLive()         { store.set(LIVE_KEY, JSON.stringify(annotations)); }
  function loadReviewerName() {
    if (typeof window.SM_REVIEWER_NAME === 'string' && window.SM_REVIEWER_NAME) return window.SM_REVIEWER_NAME;
    return store.get(REVIEWER_KEY) || 'Reviewer';
  }
  function countForPage()     { return allAnnotations().filter(a => a.page === PAGE && !a.isShadow).length; }
  function renumberLive() {
    const liveByPage = {};
    annotations.filter(a => !a.isShadow).forEach(a => { (liveByPage[a.page] = liveByPage[a.page] || []).push(a); });
    Object.keys(liveByPage).forEach(p => {
      const offset = frozenAnnotations.filter(f => f.page === p && !f.isShadow).length;
      liveByPage[p].forEach((a, i) => { a.localId = offset + i + 1; });
    });
  }
  function refresh() { applyCompact(); renderBadges(); renderAnnotationCards(); updateTargetHighlights(); }

  /* ── sync protocol (pure) ────────────────────────────────────────────
     Everything between the sync-protocol markers is pure: no DOM, no
     globals, function declarations only. relay/server.js loads this exact
     block from this file, so client and relay share ONE reducer and ONE
     identity validator instead of two copies that drift apart.

     Ops (client → relay, relay → every client in the room):
       note.add     { note }                 add a thread (idempotent by id)
       note.update  { id, comment, updatedAt } edit the thread's text
       note.resolve { id, resolved, by, at } resolve / reopen
       note.delete  { id }                   remove a thread
       reply.add    { noteId, reply }        append a reply (idempotent by id)
     Session messages: join { room }, hello { identity } (client → relay);
     snapshot { notes, viewers }, op { op, actor }, presence { viewers },
     welcome { userId, name }, error { message } (relay → client). */
  /* sync-protocol:start */
  function validateEmail(s) {
    if (typeof s !== 'string') return false;
    const v = s.trim();
    if (v.length < 6 || v.length > 254) return false;
    return /^[^\s@,;:<>()[\]"]+@[^\s@,;:<>()[\]"]+\.[a-z]{2,}$/i.test(v) && !/\.\./.test(v);
  }
  function newSyncId(prefix) {
    return (prefix || 'u') + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  // Validates the identity gate's input. By default an identity is a name
  // only. With { requireEmail: true } (the collectEmail mode) it also needs a
  // valid email, and newsletter consent is explicit opt-in: anything other
  // than literal `true` is "no", with a consent timestamp only when ticked.
  // Without requireEmail any email or newsletter field is DROPPED, so a
  // name-only deployment can never store one by accident.
  function validateIdentity(input, now, opts) {
    const src    = input && typeof input === 'object' ? input : {};
    const withEmail = !!(opts && opts.requireEmail);
    const name   = String(src.name || '').trim().replace(/\s+/g, ' ');
    const email  = withEmail ? String(src.email || '').trim().toLowerCase() : '';
    const errors = {};
    if (!name) errors.name = 'Enter your name.';
    else if (name.length > 80) errors.name = 'Keep your name under 80 characters.';
    if (withEmail) {
      if (!email) errors.email = 'Enter your email.';
      else if (!validateEmail(email)) errors.email = 'Enter a valid email, like ana@company.com.';
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    const ts = (now instanceof Date ? now : new Date()).toISOString();
    const userId = typeof src.userId === 'string' && /^[a-z0-9-]{6,64}$/i.test(src.userId) ? src.userId : newSyncId('u');
    const identity = { userId, name, identifiedAt: src.identifiedAt || ts };
    if (withEmail) {
      const newsletter = src.newsletter === true;
      Object.assign(identity, { email, newsletter, consentAt: newsletter ? (src.consentAt || ts) : null });
    }
    return { ok: true, identity };
  }
  // The only fields a note may carry over the wire. Anything else, in
  // particular an email, is dropped before it leaves a client or the relay.
  function sanitizeNote(n) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string') return null;
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const out = {
      id: n.id.slice(0, 64), page: str(n.page, 200), pageTitle: str(n.pageTitle, 200),
      createdAt: str(n.createdAt, 40), updatedAt: str(n.updatedAt, 40),
      ref: str(n.ref, 40), selector: str(n.selector, 1000),
      anchor: n.anchor && typeof n.anchor === 'object'
        ? { selector: str(n.anchor.selector, 1000), tagName: str(n.anchor.tagName, 40), text: str(n.anchor.text, 400) }
        : null,
      elementPath: str(n.elementPath, 2000), structuralPath: str(n.structuralPath, 2000),
      tag: str(n.tag, 200), sectionContext: str(n.sectionContext, 400), textSnippet: str(n.textSnippet, 400),
      author: str(n.author, 80), authorId: str(n.authorId, 64), comment: str(n.comment, 4000) || '',
      resolved: n.resolved === true, resolvedBy: str(n.resolvedBy, 80) || null, resolvedAt: str(n.resolvedAt, 40) || null,
      replies: Array.isArray(n.replies) ? n.replies.map(sanitizeReply).filter(Boolean) : [],
    };
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete out[k]; });
    return out;
  }
  function sanitizeReply(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
    const out = { id: r.id.slice(0, 64), author: typeof r.author === 'string' ? r.author.slice(0, 80) : 'Reviewer',
      comment: typeof r.comment === 'string' ? r.comment.slice(0, 4000) : '', createdAt: typeof r.createdAt === 'string' ? r.createdAt.slice(0, 40) : undefined };
    if (typeof r.authorId === 'string') out.authorId = r.authorId.slice(0, 64);
    if (out.createdAt === undefined) delete out.createdAt;
    return out;
  }
  // Pure reducer: returns a NEW array, never mutates its input. Every op is
  // idempotent, so an optimistic local apply followed by the relay's echo of
  // the same op converges to one state.
  function applySyncOp(notes, op) {
    const list = Array.isArray(notes) ? notes : [];
    if (!op || typeof op !== 'object') return list;
    switch (op.type) {
      case 'note.add': {
        const note = sanitizeNote(op.note);
        if (!note) return list;
        const i = list.findIndex(n => n.id === note.id);
        if (i === -1) return [...list, note];
        const prev = list[i];
        const seen = new Set((prev.replies || []).map(r => r.id));
        const merged = { ...prev, ...note, replies: [...(prev.replies || []), ...note.replies.filter(r => !seen.has(r.id))] };
        return list.map((n, j) => (j === i ? merged : n));
      }
      case 'note.update':
        if (typeof op.comment !== 'string' || !op.comment.trim()) return list;
        return list.map(n => (n.id === op.id ? { ...n, comment: op.comment.slice(0, 4000), updatedAt: op.updatedAt || n.updatedAt } : n));
      case 'note.resolve':
        return list.map(n => (n.id === op.id
          ? { ...n, resolved: op.resolved === true, resolvedBy: op.resolved === true ? (op.by || null) : null, resolvedAt: op.resolved === true ? (op.at || null) : null }
          : n));
      case 'note.delete':
        return list.filter(n => n.id !== op.id);
      case 'reply.delete':
        return list.map(n => (n.id === op.noteId && (n.replies || []).some(r => r.id === op.replyId)
          ? { ...n, replies: n.replies.filter(r => r.id !== op.replyId) } : n));
      case 'reply.add': {
        const reply = sanitizeReply(op.reply);
        if (!reply) return list;
        return list.map(n => {
          if (n.id !== op.noteId) return n;
          const replies = n.replies || [];
          if (replies.some(r => r.id === reply.id)) return n;
          return { ...n, replies: [...replies, reply] };
        });
      }
      default:
        return list;
    }
  }
  /* sync-protocol:end */

  /* ── sync adapters ───────────────────────────────────────────────────
     An adapter is any object with:
       connect(handlers)  handlers.onMessage(msg), handlers.onStatus(status)
                          status ∈ 'connecting' | 'live' | 'offline'
       send(op)           deliver an op; queue it while offline
       identify(identity) send { type: 'hello', identity } now and on reconnect
       close()
     Swap the transport (Liveblocks, Ably, Supabase Realtime, PartyKit, a
     Vercel-hosted socket…) by passing { adapter } instead of { url }. */
  function createWebSocketAdapter(opts) {
    const o  = opts || {};
    const WS = o.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    const base = o.reconnectMs || 500;
    let ws = null, handlers = {}, queue = [], closed = true, attempt = 0, timer = null, hello = null;
    const status = s => { try { handlers.onStatus && handlers.onStatus(s); } catch (e) {} };
    const isOpen = () => !!ws && ws.readyState === 1;
    const raw    = m => { try { ws.send(JSON.stringify(m)); return true; } catch (e) { return false; } };
    function open() {
      if (closed || !WS) { if (!WS) status('offline'); return; }
      status('connecting');
      let sock;
      // The room also rides on the URL so a hosted relay can route the socket
      // (e.g. one Durable Object per room) before the first message arrives.
      const url = o.url + (o.url.indexOf('?') === -1 ? '?' : '&') + 'room=' + encodeURIComponent(o.room || '');
      try { sock = new WS(url); } catch (e) { schedule(); return; }
      ws = sock;
      sock.onopen = () => {
        if (sock !== ws) return;
        attempt = 0;
        raw({ type: 'join', room: o.room });
        if (hello) raw(hello);
        const pending = queue; queue = [];
        pending.forEach(m => { if (!raw(m)) queue.push(m); });
        status('live');
      };
      sock.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && typeof m === 'object') { try { handlers.onMessage && handlers.onMessage(m); } catch (e) {} }
      };
      sock.onclose = () => {
        if (sock !== ws) return;
        ws = null;
        if (!closed) { status('offline'); schedule(); }
      };
      sock.onerror = () => { try { sock.close(); } catch (e) {} };
    }
    function schedule() {
      clearTimeout(timer);
      const delay = Math.min(10000, base * Math.pow(2, attempt++));
      timer = setTimeout(open, delay);
    }
    return {
      kind: 'websocket',
      connect(h) { handlers = h || {}; closed = false; open(); },
      send(op)   { if (isOpen() && raw(op)) return; queue.push(op); },
      identify(identity) { hello = { type: 'hello', identity }; if (isOpen()) raw(hello); },
      // Ask for a fresh snapshot (after the relay rejected one of our ops,
      // whose optimistic copy is still on screen).
      resync()   { if (isOpen()) raw({ type: 'join', room: o.room }); },
      close()    { closed = true; clearTimeout(timer); const s = ws; ws = null; try { s && s.close(); } catch (e) {} },
      _queueSize() { return queue.length; },
    };
  }
  // null → single-player (no network). Accepts { adapter, room } for a custom
  // transport or { url: 'ws(s)://…', room } for the bundled relay.
  function resolveSyncAdapter(cfg, env) {
    if (!cfg || typeof cfg !== 'object') return null;
    const fallback = (env && env.defaultRoom) || 'default';
    const room = (typeof cfg.room === 'string' && cfg.room.trim()) ? cfg.room.trim().slice(0, 200) : fallback;
    const a = cfg.adapter;
    const privacyUrl = typeof cfg.privacyUrl === 'string' && /^https:\/\//i.test(cfg.privacyUrl) ? cfg.privacyUrl : null;
    const collectEmail = cfg.collectEmail === true;   // off by default: name-only identity
    if (a && typeof a.connect === 'function' && typeof a.send === 'function') {
      if (typeof a.identify !== 'function') a.identify = () => {};
      if (typeof a.close !== 'function') a.close = () => {};
      return { adapter: a, room, privacyUrl, collectEmail };
    }
    if (typeof cfg.url === 'string' && /^wss?:\/\//i.test(cfg.url)) {
      return { adapter: createWebSocketAdapter({ url: cfg.url, room, WebSocket: cfg.WebSocket, reconnectMs: cfg.reconnectMs }), room, privacyUrl, collectEmail };
    }
    return null;
  }

  /* ── sync runtime (only runs when SYNC is set) ───────────────────────── */
  function isMine(a) {
    if (!SYNC) return true;
    if (!a || !a.authorId) return !a || !a.author || a.author === reviewerName; // pre-sync local note
    return !!identity && a.authorId === identity.userId;
  }
  function syncSend(op) { if (SYNC) SYNC.send(op); }
  function loadIdentity() {
    try {
      const v = JSON.parse(store.get(IDENTITY_KEY) || 'null');
      if (!v || typeof v.name !== 'string' || !v.name.trim() || typeof v.userId !== 'string') return null;
      if (COLLECT_EMAIL) return validateEmail(v.email) ? v : null;
      // Name-only mode: never keep (or resend) an email stored by an older version.
      if ('email' in v || 'newsletter' in v || 'consentAt' in v) {
        const slim = { userId: v.userId, name: v.name, identifiedAt: v.identifiedAt };
        store.set(IDENTITY_KEY, JSON.stringify(slim));
        return slim;
      }
      return v;
    } catch (e) {}
    return null;
  }
  function saveIdentity(v) { identity = v; store.set(IDENTITY_KEY, JSON.stringify(v)); }
  function clearIdentity() {
    identity = null; nameSet = false; reviewerName = 'Reviewer';
    store.set(IDENTITY_KEY, 'null');
  }
  function requireIdentity(then) {
    if (!SYNC || identity) { if (then) then(); return; }
    openIdentityGate(then);
  }
  function startSync() {
    SYNC.connect({ onMessage: onSyncMessage, onStatus: setSyncStatus });
    if (identity) SYNC.identify(identity);
    // Relative times ("3m ago") keep ticking while people talk.
    setInterval(() => {
      document.querySelectorAll('.annot-card-time[data-ts],.annot-reply-time[data-ts]').forEach(el => {
        if (el.dataset.ts) el.textContent = fmtRelTime(el.dataset.ts);
      });
    }, 30000);
    window.addEventListener('beforeunload', () => { try { SYNC.close(); } catch (e) {} });
  }
  function setSyncStatus(s) {
    syncStatus = s;
    renderLiveChip();
  }
  // The relay sends at most a page of names plus the real head count.
  let viewerCount = 0;
  function setViewers(list, count) {
    viewers = Array.isArray(list) ? list.filter(v => v && typeof v.name === 'string') : [];
    viewerCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : viewers.length;
    renderLiveChip();
  }
  function renderLiveChip() {
    if (!liveChip) return;
    liveChip.dataset.status = syncStatus;
    const n = viewerCount;
    liveChip.textContent = '';
    if (syncStatus === 'live') {
      liveChip.append(mkEl('span', 'annot-live-word', 'Live ·\u00a0'), mkEl('span', '', `${n || 1} here`));
    } else {
      liveChip.textContent = syncStatus === 'connecting' ? 'Connecting' : 'Offline, retrying';
    }
    const names = viewers.map(v => v.name).filter(Boolean);
    const shown = names.slice(0, 20), more = Math.max(0, n - shown.length);
    liveChip.title = syncStatus === 'live' && shown.length
      ? 'Viewing now: ' + shown.join(', ') + (more ? ` and ${more} more` : '') : '';
  }
  function onSyncMessage(m) {
    switch (m.type) {
      case 'snapshot':
        annotations = (Array.isArray(m.notes) ? m.notes : []).map(n => ({ ...n, frozen: false }));
        // Keep any local shadow replies on baked notes (they never hit the relay).
        if (m.viewers) setViewers(m.viewers, m.count);
        afterRemote(true);
        break;
      case 'op':
        // State changes now; the page catches up once per frame, so a burst
        // of 50 ops costs one re-render, not 50.
        annotations = applySyncOp(annotations, m.op);
        scheduleRemoteRefresh();
        announceRemote(m.op, m.actor);
        break;
      case 'presence':
        setViewers(m.viewers, m.count);
        break;
      case 'welcome':
        if (identity && m.userId === identity.userId && typeof m.name === 'string') reviewerName = m.name;
        break;
      case 'error':
        if (typeof m.message === 'string') toast(m.message);
        if (m.code === 'identity_required' && identity) SYNC.identify(identity);
        // Any other rejection (rate limit, not yours, room full) leaves our
        // optimistic copy on screen that nobody else has: take the relay's
        // state back.
        else if (m.code !== 'invalid_identity' && typeof SYNC.resync === 'function') SYNC.resync();
        break;
    }
  }
  let remoteFrame = 0;
  function scheduleRemoteRefresh() {
    if (remoteFrame) return;
    remoteFrame = requestAnimationFrame(() => { remoteFrame = 0; afterRemote(false); });
  }
  // localStorage is only a fallback copy of the room: write it at most every
  // second, not on every op (it held ~70KB per write in a 100-note room).
  const saveLiveSoon = debounce(() => saveLive(), 1000);
  function afterRemote(isSnapshot) {
    if (isSnapshot && remoteFrame) { cancelAnimationFrame(remoteFrame); remoteFrame = 0; }
    renumberLive(); if (isSnapshot) saveLive(); else saveLiveSoon();
    if (isSnapshot) snapshotSeen = true;
    // Same rule as single-player: a page that has notes skips the first-run
    // coachmark and opens expanded. Live, the first note can arrive at any
    // moment (someone else commenting in an empty room), not only on load.
    const hasNotes = annotations.some(a => !a.isShadow);
    if (hasNotes && onboardingEls) { dismissHint(false); if (uiCollapsed && !uiHidden) setCollapsed(false); }
    else if (hasNotes && isSnapshot && uiCollapsed && !uiHidden && !expandedOnce) setCollapsed(false);
    if (hasNotes) expandedOnce = true;
    // Phones: a thread someone else deleted closes its open modal. Remote
    // notes otherwise only ever arrive as pins (margin cards stay hidden).
    if (sheetCardId && !annotations.some(a => a.id === sheetCardId)) closeCardSheet();
    refreshPreservingDrafts();
  }
  // A remote op re-renders every card. Keep what the viewer is typing: an
  // open inline editor defers the refresh, a half-written reply is restored.
  let refreshDeferred = false;
  function refreshPreservingDrafts() {
    if (document.querySelector('.annot-card-editor')) { refreshDeferred = true; setTimeout(retryDeferred, 800); return; }
    const drafts = [];
    let focusedId = null, caret = 0;
    document.querySelectorAll('.annot-card').forEach(card => {
      const inp = card.querySelector('.annot-card-input-row input');
      if (inp && inp.value) drafts.push([card.dataset.annotId, inp.value]);
      if (inp && document.activeElement === inp) { focusedId = card.dataset.annotId; caret = inp.selectionStart || 0; }
    });
    refresh();
    drafts.forEach(([id, val]) => {
      const inp = document.querySelector(`.annot-card[data-annot-id="${CSS.escape(id)}"] .annot-card-input-row input`);
      if (inp) inp.value = val;
    });
    if (focusedId) {
      const inp = document.querySelector(`.annot-card[data-annot-id="${CSS.escape(focusedId)}"] .annot-card-input-row input`);
      if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch (e) {} }
    }
  }
  function retryDeferred() {
    if (!refreshDeferred) return;
    if (document.querySelector('.annot-card-editor')) { setTimeout(retryDeferred, 800); return; }
    refreshDeferred = false; refreshPreservingDrafts();
  }
  function announceRemote(op, actor) {
    if (!op || !actor || (identity && actor.userId === identity.userId)) return;
    const who = typeof actor.name === 'string' && actor.name ? actor.name : 'Someone';
    const verb = { 'note.add': 'commented', 'reply.add': 'replied', 'note.update': 'edited a comment',
      'note.delete': 'deleted a comment', 'reply.delete': 'removed a reply' }[op.type] || (op.type === 'note.resolve' ? (op.resolved ? 'resolved a thread' : 'reopened a thread') : '');
    if (!verb) return;
    // Bursts become one toast: "Ana commented" / "Ana and 4 others commented"
    // / "12 new updates", instead of a pile of overlapping ones.
    announceBuf.push({ who, verb });
    if (!announceTimer) announceTimer = setTimeout(flushAnnounce, 500);
  }
  let announceBuf = [], announceTimer = null;
  function flushAnnounce() {
    const buf = announceBuf; announceBuf = []; announceTimer = null;
    if (!buf.length) return;
    if (buf.length === 1) { remoteToast(`${buf[0].who} ${buf[0].verb}`); return; }
    const verbs = new Set(buf.map(b => b.verb)), people = [...new Set(buf.map(b => b.who))];
    if (verbs.size === 1) {
      const v = buf[0].verb;
      remoteToast(people.length === 1 ? `${people[0]} ${v} (${buf.length})`
        : `${people[0]} and ${people.length - 1} ${people.length === 2 ? 'other' : 'others'} ${v}`);
    } else remoteToast(`${buf.length} new updates`);
  }

  /* ── identity gate (multiplayer only) ────────────────────────────────
     Before a viewer's first comment, reply or resolve: a name. Saved to
     localStorage so it is asked once. With collectEmail on, it also asks for
     an email plus an UNCHECKED newsletter opt-in (EU consent: never
     pre-ticked); the relay keeps those privately, other viewers only ever
     see the name. */
  function openIdentityGate(then) {
    if (document.querySelector('.annot-gate')) return;
    if (onboardingEls) dismissHint(false);   // the gate must never sit under the tour
    closePopup();
    const overlay = mkEl('div', 'annot-modal-overlay annot-gate-overlay');
    const dialog  = mkEl('form', 'annot-modal annot-gate');
    dialog.setAttribute('novalidate', '');
    dialog.setAttribute('aria-labelledby', 'annot-gate-title');
    const title = mkEl('div', 'annot-modal-title', 'Add your name to comment');
    title.id = 'annot-gate-title';
    const body  = mkEl('div', 'annot-modal-body', COLLECT_EMAIL
      ? 'Comments here are live for everyone on this page. Others see your name. Your email stays private.'
      : 'Comments here are live for everyone on this page. Others see the name you enter.');
    const field = (label, type, name, value, autocomplete) => {
      const wrap = mkEl('label', 'annot-gate-field');
      wrap.appendChild(mkEl('span', 'annot-gate-label', label));
      const input = mkEl('input', 'annot-gate-input');
      input.type = type; input.name = name; input.value = value || '';
      input.autocomplete = autocomplete; input.required = true;
      const err = mkEl('span', 'annot-gate-error');
      err.setAttribute('role', 'alert');
      wrap.append(input, err);
      return { wrap, input, err };
    };
    const prevName = reviewerName && reviewerName !== 'Reviewer' ? reviewerName : '';
    const nameF  = field('Name', 'text', 'name', prevName, 'name');
    const emailF = COLLECT_EMAIL ? field('Email', 'email', 'email', '', 'email') : null;
    const consent = mkEl('label', 'annot-gate-consent');
    const box = mkEl('input', 'annot-gate-checkbox');
    box.type = 'checkbox'; box.name = 'newsletter'; box.checked = false;
    const consentText = mkEl('span', '', 'Subscribe to the newsletter. Optional, and you can unsubscribe at any time.');
    consent.append(box, consentText);
    let privacy = null;
    if (SYNC_CFG.privacyUrl) {
      privacy = mkEl('div', 'annot-gate-privacy');
      if (COLLECT_EMAIL) privacy.append(document.createTextNode('We use your email to identify your comments. '));
      const link = mkEl('a', '', 'Privacy policy');
      link.href = SYNC_CFG.privacyUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      privacy.appendChild(link);
    }
    const actions = mkEl('div', 'annot-modal-actions');
    const cancel = mkEl('button', 'annot-btn', 'Cancel');
    cancel.type = 'button';
    const ok = mkEl('button', 'annot-btn annot-btn-primary annot-gate-submit', 'Start commenting');
    ok.type = 'submit';
    actions.append(cancel, ok);
    dialog.append(title, body, nameF.wrap);
    if (COLLECT_EMAIL) dialog.append(emailF.wrap, consent);
    if (privacy) dialog.appendChild(privacy);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); if (activeModal === close) activeModal = null; };
    activeModal = close;
    cancel.onclick  = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    [nameF, emailF].filter(Boolean).forEach(f => { f.input.oninput = () => { f.err.textContent = ''; f.wrap.classList.remove('invalid'); }; });
    dialog.onsubmit = e => {
      e.preventDefault();
      const res = COLLECT_EMAIL
        ? validateIdentity({ name: nameF.input.value, email: emailF.input.value, newsletter: box.checked === true }, null, { requireEmail: true })
        : validateIdentity({ name: nameF.input.value });
      nameF.err.textContent  = (!res.ok && res.errors.name)  || '';
      nameF.wrap.classList.toggle('invalid', !!(!res.ok && res.errors.name));
      if (emailF) {
        emailF.err.textContent = (!res.ok && res.errors.email) || '';
        emailF.wrap.classList.toggle('invalid', !!(!res.ok && res.errors.email));
      }
      if (!res.ok) { (res.errors.name || !emailF ? nameF.input : emailF.input).focus(); return; }
      saveIdentity(res.identity);
      reviewerName = res.identity.name; nameSet = true;
      store.set(REVIEWER_KEY, reviewerName);
      SYNC.identify(res.identity);
      close();
      toast(`Commenting as ${reviewerName}`);
      refresh();
      if (then) then();
    };
    setTimeout(() => { try { (prevName && emailF ? emailF.input : nameF.input).focus(); } catch (e) {} }, 10);
  }

  /* ── DOM helpers ─────────────────────────────────────────────────── */
  // Append a compact keyboard-shortcut chip inside a button or row.
  function addKbd(el, text) {
    const k = mkEl('span', 'annot-kbd');
    k.textContent = text;
    el.appendChild(k);
    return el;
  }
  const SAVE_KBD = isMac ? '⌘⏎' : 'Ctrl⏎';

  // Styled hover tooltip with an optional shortcut chip (replaces native title).
  function attachTooltip(el, label, kbd) {
    let tip = null;
    const hide = () => { if (tip) { tip.remove(); tip = null; } };
    el.onmouseenter = () => {
      hide();
      if (lastPointerType !== 'mouse') return;   // a tap's emulated hover would leave it stuck
      tip = mkEl('div', 'annot-tooltip');
      const l = mkEl('span'); l.textContent = label; tip.appendChild(l);
      if (kbd) addKbd(tip, kbd);
      document.body.appendChild(tip);
      const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let top = r.top - tr.height - 8;
      if (top < 6) top = r.bottom + 8;
      const left = r.left + r.width / 2 - tr.width / 2;
      tip.style.top  = top + 'px';
      tip.style.left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6)) + 'px';
    };
    el.onmouseleave = hide;
    el.onmousedown  = hide;
  }

  // On-brand confirmation modal (replaces window.confirm). Enter confirms via
  // the focused button; Esc cancels via the global key handler (activeModal).
  function confirmModal(opts) {
    const overlay = mkEl('div', 'annot-modal-overlay');
    const dialog  = mkEl('div', 'annot-modal');
    const title   = mkEl('div', 'annot-modal-title', opts.title);
    const body    = mkEl('div', 'annot-modal-body', opts.body || '');
    const actions = mkEl('div', 'annot-modal-actions');
    const cancel  = mkEl('button', 'annot-btn', 'Cancel');
    const ok      = mkEl('button', 'annot-btn ' + (opts.danger ? 'annot-btn-danger' : 'annot-btn-primary'), opts.confirmLabel || 'Confirm');
    addKbd(cancel, 'Esc');
    addKbd(ok, '⏎');
    actions.append(cancel, ok);
    dialog.append(title, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); if (activeModal === close) activeModal = null; };
    activeModal = close;
    cancel.onclick  = close;
    ok.onclick      = () => { close(); opts.onConfirm(); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    setTimeout(() => { try { ok.focus(); } catch (e) {} }, 10);
  }

  function mkEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function injectStyle(text, id) {
    const s = document.createElement('style');
    if (id) s.id = id; s.textContent = text; document.head.appendChild(s);
  }
  function slug(s) {
    return (s || 'artefact').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'artefact';
  }
  function tagDescription(t) {
    const tag = t.tagName.toLowerCase();
    const cn  = typeof t.className === 'string' ? t.className : '';
    const cls = cn.split(/\s+/).filter(c => c && !c.startsWith('annot')).slice(0,2)
      .map(c => c.replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean).join('.');
    return cls ? `${tag}.${cls}` : tag;
  }
  function textSnippet(t) {
    const s = (t.textContent || '').replace(/\s+/g,' ').trim();
    return s.length > 100 ? s.slice(0,100) + '…' : s;
  }
  function sectionContextFor(t) {
    let cur = t; let d = 0;
    while (cur && cur.parentElement && d < 10) {
      const tag = cur.tagName?.toLowerCase();
      if (['section','article','main','header','footer'].includes(tag)) {
        const h = cur.querySelector('h1,h2,h3,h4,[data-section-title],.band-label,.section-tag');
        if (h) return h.textContent.replace(/\s+/g,' ').trim().slice(0,80);
      }
      cur = cur.parentElement; d++;
    }
    return '';
  }
  // Complete DOM path from the element up to <html> (or a unique #id ancestor).
  // Richer than selectorFor() (which is depth-capped for reload re-matching):
  // this is the full, human/LLM-readable component path. Saved on the
  // annotation and emitted in Markdown — never shown on the comment card.
  function elementPath(t) {
    if (!t || t.nodeType !== 1) return '';
    const esc = c => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(c) : String(c).replace(/[^a-zA-Z0-9_-]/g, '');
    const parts = [];
    let cur = t;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        const idSel = '#' + esc(cur.id);
        let unique = false;
        try { unique = document.querySelectorAll(idSel).length === 1; } catch {}
        if (unique) { parts.unshift(part + idSel); break; }  // unique id anchors the path
      }
      const cn  = typeof cur.className === 'string' ? cur.className : '';
      const cls = cn.split(/\s+/).filter(c => c && !c.startsWith('annot')).map(esc);
      if (cls.length) part += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  // Class-free structural path for clipboard copy and stable element referencing.
  // Same walk as elementPath() but strips CSS classes so the reference stays valid
  // when stylesheets change — relies on tag name + :nth-of-type position only.
  function structuralPath(t) {
    if (!t || t.nodeType !== 1) return '';
    const esc = c => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(c) : String(c).replace(/[^a-zA-Z0-9_-]/g, '');
    const parts = [];
    let cur = t;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        const idSel = '#' + esc(cur.id);
        let unique = false;
        try { unique = document.querySelectorAll(idSel).length === 1; } catch {}
        if (unique) { parts.unshift(part + idSel); break; }
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  /* ── anchors ──────────────────────────────────────────────────────────
     A comment is only worth as much as its anchor. The old selectorFor()
     built a depth-capped tag + :nth-of-type() path and never checked that the
     path resolved back to the element it came from — so an ambiguous or
     shifted path silently re-bound the comment to the WRONG element on
     reload. Wrong-binding is worse than no binding: the reviewer reads a note
     against markup it was never written about.

     The ladder below is adapted from Plannotator's html-viewer bridge script
     (github.com/backnotprop/plannotator, MIT / Apache-2.0):
       1. #id                       — if it uniquely selects
       2. tag[identity-attribute]   — data-testid, aria-label, href, role, …
       3. tag.class.class           — meaningful (non-generated) classes only
       4. positional path           — tag > tag:nth-of-type(n), grown one
                                      ancestor at a time
     Every rung is proved with a real querySelectorAll() before acceptance,
     and the walk is abandoned (no anchor) rather than shipping a path known
     to be ambiguous.

     Resolution fails closed: a weak anchor (positional / class / behavioural
     attribute) must ALSO still match the 180-char text snapshot captured at
     annotation time, or it resolves to null. Only an author-controlled
     identity rung (#id, data-testid, …) is exempt. */

  const ANCHOR_IDENTITY_ATTRS = ['data-annotate', 'data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa', 'src', 'aria-label', 'name', 'role', 'href', 'alt'];
  // Author-controlled identity only. Behavioural attributes (role, href,
  // aria-label, name, alt) describe what an element does, not what it says: a
  // regenerated page keeps its role="button" while the button's meaning
  // changes completely. They never exempt an anchor from the text check.
  const STABLE_IDENTITY_ATTRS = ['data-annotate', 'data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa'];
  // Our one deliberate deviation from the reference implementation: for media
  // elements `src` IS the content, not a behaviour. Without this an annotated
  // <img> (no text, so nothing to snapshot) would get no anchor at all and
  // orphan on every reload — and images are one of the most-annotated things
  // in a deck or prototype.
  const MEDIA_SRC_TAGS = ['img', 'source', 'video', 'audio', 'iframe', 'embed'];
  // Each ancestor step runs a document-wide uniqueness query against a
  // selector that grows with the path, so cost is quadratic in depth. Real
  // documents anchor within a few levels; a degenerate deeply-wrapped chain
  // (templated exports, generated markup) must not freeze the tab on one click.
  const MAX_ANCHOR_PATH_DEPTH = 40;

  function anchorTextSnapshot(el) {
    const text = ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    return text.length > 180 ? text.slice(0, 180) : text;
  }
  function uniquelySelects(selector, el) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === el;
    } catch { return false; }
  }
  function escapeAttrValue(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  // Tailwind JIT hashes, CSS-module suffixes and styled-components names are
  // regenerated on every build — anchoring on them guarantees a stale anchor.
  function isLikelyGeneratedClass(name) {
    if (name.length > 36) return true;
    if (/^[a-f0-9]{8,}$/i.test(name)) return true;
    if (/[A-Za-z]+[_-][A-Za-z]*[0-9]{4,}/.test(name)) return true;
    return false;
  }
  function semanticSelectorFor(el) {
    const tag = el.tagName.toLowerCase();
    const canEscape = typeof CSS !== 'undefined' && !!CSS.escape;
    if (el.id && canEscape) {
      const idSel = '#' + CSS.escape(el.id);
      if (uniquelySelects(idSel, el)) return idSel;
    }
    for (const name of ANCHOR_IDENTITY_ATTRS) {
      let value = el.getAttribute && el.getAttribute(name);
      if (!value) continue;
      value = String(value).trim();
      if (!value || value.length > 240 || value.indexOf('\n') >= 0) continue;
      const attrSel = tag + '[' + name + '=' + escapeAttrValue(value) + ']';
      if (uniquelySelects(attrSel, el)) return attrSel;
    }
    if (canEscape && el.classList && el.classList.length) {
      const meaningful = [];
      for (let c = 0; c < el.classList.length && meaningful.length < 2; c++) {
        const cls = el.classList[c];
        // annot-* classes are our own overlay state (annot-target, annot-hover,
        // annot-target-active) — added and removed at runtime, so they must
        // never end up inside a durable anchor.
        if (!cls || cls.indexOf('annot') === 0 || isLikelyGeneratedClass(cls)) continue;
        meaningful.push('.' + CSS.escape(cls));
      }
      if (meaningful.length) {
        const classSel = tag + meaningful.join('');
        if (uniquelySelects(classSel, el)) return classSel;
      }
    }
    return null;
  }
  function buildAnchorSelector(el) {
    const path = [];
    let current = el;
    let depth = 0;
    while (current && current.nodeType === 1 && current !== document.body && current !== document.documentElement) {
      if (++depth > MAX_ANCHOR_PATH_DEPTH) return null;
      const semantic = semanticSelectorFor(current);
      if (semantic) { path.unshift(semantic); return path.join(' > '); }
      let segment = current.tagName.toLowerCase();
      const parentEl = current.parentElement;
      if (parentEl) {
        const sameTag = Array.from(parentEl.children).filter(c => c.tagName === current.tagName);
        if (sameTag.length > 1) segment += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')';
      }
      path.unshift(segment);
      const candidate = path.join(' > ');
      if (uniquelySelects(candidate, el)) return candidate;
      // Root at body once we reach the top. Our own overlay chrome (cards,
      // badges, FAB) is appended to <body>, so an unrooted positional path can
      // also match a div *inside* a card; `body > …` scopes it back to the
      // author's own top-level children, whose :nth-of-type indices are stable
      // because the overlay only ever appends after them.
      if (parentEl === document.body) {
        const rooted = 'body > ' + candidate;
        if (uniquelySelects(rooted, el)) return rooted;
      }
      current = parentEl;
    }
    // Every candidate — including the full body-rooted path — failed the
    // uniqueness query. Ship no anchor rather than a known-ambiguous one.
    return null;
  }
  // Stable identity: the selector IS the element's own #id or data-* rung,
  // re-derived from the element and compared whole — never parsed out of the
  // selector string (an attribute value containing ' > ' or '#' would fool a
  // string parse).
  function anchorHasStableIdentity(selector, el) {
    const canEscape = typeof CSS !== 'undefined' && !!CSS.escape;
    if (el.id && canEscape && selector === '#' + CSS.escape(el.id)) return true;
    const tag = el.tagName.toLowerCase();
    for (const name of STABLE_IDENTITY_ATTRS) {
      const value = el.getAttribute && el.getAttribute(name);
      if (!value) continue;
      if (selector === tag + '[' + name + '=' + escapeAttrValue(String(value).trim()) + ']') return true;
    }
    if (MEDIA_SRC_TAGS.indexOf(tag) !== -1) {
      const src = el.getAttribute && el.getAttribute('src');
      if (src && selector === tag + '[src=' + escapeAttrValue(String(src).trim()) + ']') return true;
    }
    return false;
  }
  // Durable anchor stored on the annotation: {selector, tagName, text}.
  // Returns null when no anchor can be trusted — the caller keeps the comment,
  // it just renders as orphaned instead of pointing somewhere wrong.
  function buildAnchor(el) {
    if (!el || el.nodeType !== 1) return null;
    const selector = buildAnchorSelector(el);
    if (!selector) return null;
    const text = anchorTextSnapshot(el);
    // A text-less element (icon, spacer, empty div) anchors ONLY through a
    // stable-identity rung. A weak selector has nothing to verify against, and
    // identical siblings share every structural trait, so any derived
    // signature would happily validate the wrong element after an insert.
    if (!text && !anchorHasStableIdentity(selector, el)) return null;
    return { selector, tagName: el.tagName.toLowerCase(), text };
  }
  function resolveAnchor(anchor) {
    if (!anchor || typeof anchor.selector !== 'string' || !anchor.selector) return null;
    let matches;
    try { matches = document.querySelectorAll(anchor.selector); } catch { return null; }
    if (matches.length !== 1) return null;
    const el = matches[0];
    if (typeof anchor.tagName === 'string' && el.tagName.toLowerCase() !== anchor.tagName.toLowerCase()) return null;
    if (!anchorHasStableIdentity(anchor.selector, el)) {
      // Weak anchor: the captured snapshot must exist and still match. A
      // missing or empty snapshot is a rejection, not an exemption.
      if (typeof anchor.text !== 'string' || !anchor.text) return null;
      if (anchorTextSnapshot(el) !== anchor.text) return null;
    }
    return el;
  }
  // Back-compat shim: annotations baked before verified anchors shipped carry
  // only `selector`. Their stored textSnippet is truncated with an ellipsis so
  // it can't be compared to a snapshot — but we can still refuse an ambiguous
  // match instead of silently taking the first hit.
  function resolveLegacySelector(selector) {
    if (typeof selector !== 'string' || !selector) return null;
    let matches;
    try { matches = document.querySelectorAll(selector); } catch { return null; }
    return matches.length === 1 ? matches[0] : null;
  }
  // Kept for callers/tests that just want the selector string.
  function selectorFor(t) {
    const anchor = buildAnchor(t);
    return anchor ? anchor.selector : '';
  }

  function fmtRelTime(iso) {
    if (!iso) return '';
    try {
      const d0   = new Date(iso);
      if (isNaN(d0.getTime())) return '';
      const diff = Date.now() - d0.getTime();
      const s = Math.floor(diff / 1000);
      if (s < 60)  return 'Just now';
      const m = Math.floor(s / 60);
      if (m < 60)  return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24)  return `${h}h ago`;
      const d = Math.floor(h / 24);
      if (d < 7)   return `${d}d ago`;
      return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    } catch { return ''; }
  }
  function randomizeAvatar(name) {
    const newSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
    store.set(AVATAR_SEED_KEY + name, String(newSeed));
    refresh();
  }

  function generateAvatar(name) {
    let seed = 0;
    for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;
    const stored = parseInt(store.get(AVATAR_SEED_KEY + name) || '0', 10);
    if (stored) seed = (seed ^ stored) >>> 0;
    const r    = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    const pick = arr => arr[r() % arr.length];
    const bgs  = ['#f6ff9a','#b8ff9f','#fe9da7','#ffdd9a','#a5f3fc','#c4b5fd','#fda4af','#f9a8d4','#6ee7b7','#fcd34d','#86efac','#7dd3fc'];
    const bg   = pick(bgs); const fg = '#191919';
    const eyeShapes = [
      (x,y) => `<circle cx="${x}" cy="${y}" r="2.5" fill="${fg}"/>`,
      (x,y) => `<path d="M${x-2.5},${y} a2.5,2.5 0 0 0 5,0" fill="${fg}"/>`,
      (x,y) => `<line x1="${x-2.5}" y1="${y}" x2="${x+2.5}" y2="${y-1}" stroke="${fg}" stroke-width="1.8" stroke-linecap="round"/>`,
      (x,y) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${fg}"/><circle cx="${x+1}" cy="${y-1}" r="1.2" fill="${bg}"/>`,
      (x,y) => `<path d="M${x-2},${y+1} L${x},${y-2} L${x+2},${y+1}Z" fill="${fg}"/>`,
    ];
    const mouths = [
      `<path d="M13,23 Q18,27 23,23" stroke="${fg}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M12,22 Q18,28 24,22" stroke="${fg}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<line x1="13" y1="23" x2="23" y2="23" stroke="${fg}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<path d="M14,24 Q18,21 22,24" stroke="${fg}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M13,21 Q18,27 23,21 Q18,24.5 13,21Z" fill="${fg}"/>`,
      `<path d="M14,23 L16,21 L18,23 L20,21 L22,23" stroke="${fg}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    ];
    const eye     = pick(eyeShapes);
    const mouth   = pick(mouths);
    const cheeks  = r() % 3 === 0 ? `<circle cx="10" cy="21" r="4.5" fill="rgba(255,120,120,0.3)"/><circle cx="26" cy="21" r="4.5" fill="rgba(255,120,120,0.3)"/>` : '';
    const hat     = r() % 4 === 0 ? `<rect x="9" y="9.5" width="18" height="2.5" rx="1.25" fill="${fg}"/><rect x="12" y="5" width="12" height="5.5" rx="2" fill="${fg}"/>` : '';
    const brows   = r() % 2 === 0 ? `<path d="M11,14.5 Q13.5,12.5 16,14.5" stroke="${fg}" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M20,14.5 Q22.5,12.5 25,14.5" stroke="${fg}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` : '';
    const glasses = !hat && r() % 5 === 0 ? `<circle cx="13" cy="18" r="4" stroke="${fg}" stroke-width="1.2" fill="none"/><circle cx="23" cy="18" r="4" stroke="${fg}" stroke-width="1.2" fill="none"/><line x1="17" y1="18" x2="19" y2="18" stroke="${fg}" stroke-width="1.2"/>` : '';
    const svg     = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="18" fill="${bg}"/>${hat}${brows}${glasses}${cheeks}${eye(13,18)}${eye(23,18)}${mouth}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function toast(msg) {
    const t = mkEl('div', 'annot-toast', msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
    return t;
  }
  // Live-activity toasts replace each other instead of piling up.
  function remoteToast(msg) {
    document.querySelectorAll('.annot-toast-remote').forEach(t => t.remove());
    toast(msg).classList.add('annot-toast-remote');
  }
  function debounce(fn, wait) {
    let timer = null;
    return function () { clearTimeout(timer); timer = setTimeout(fn, wait); };
  }
  function throttle(fn, wait) {
    let last = 0, timer = null;
    return function () {
      const now = Date.now(), rem = wait - (now - last);
      if (rem <= 0) { last = now; fn(); }
      else if (!timer) timer = setTimeout(() => { last = Date.now(); timer = null; fn(); }, rem);
    };
  }
  function deriveArtefactName() {
    const t = (document.title || '').trim();
    if (t) { const parts = t.split(/\s+[—·|–]\s+/); if (parts.length >= 2) return parts[1].trim(); return t; }
    return (FOLDER.split('/').filter(Boolean).pop() || 'Artefact').replace(/[-_]+/g,' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Test hook: expose pure utilities for node:test / jest without affecting browser behaviour.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateAvatar, fmtRelTime, slug, buildMarkdown, selectorFor, tagDescription,
                       buildAnchor, resolveAnchor, resolveLegacySelector, anchorTextSnapshot, anchorHasStableIdentity, isLikelyGeneratedClass,
                       validateEmail, validateIdentity, sanitizeNote, applySyncOp, createWebSocketAdapter, resolveSyncAdapter };
  }
})();
