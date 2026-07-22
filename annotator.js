/* annotate v2
 * Canonical source: .claude/skills/annotate/annotator.js
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
  const BANNER_SPOTS = {
    tl: { top: '20px',  left: '20px' },
    tc: { top: '20px',  left: '50%',   tx: '-50%' },
    tr: { top: '20px',  right: '20px' },
    rc: { right: '20px', top: '50%',   ty: '-50%' },
    br: { bottom: '20px', right: '20px' },
    bc: { bottom: '20px', left: '50%', tx: '-50%' },
    bl: { bottom: '20px', left: '20px' },
    lc: { left: '20px',  top: '50%',   ty: '-50%' },
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
      svg: `<svg class="annot-onboard-img" viewBox="0 0 400 176" xmlns="http://www.w3.org/2000/svg"><style>
        @keyframes aob1ring{0%{transform:scale(.6);opacity:.6}70%{transform:scale(1.7);opacity:0}100%{opacity:0}}
        @keyframes aob1pop{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
        @keyframes aob1key{0%,55%,100%{transform:translateY(0)}65%{transform:translateY(3px)}}
        .aob1-ring{transform-box:fill-box;transform-origin:center;animation:aob1ring 1.8s ease-out infinite}
        .aob1-bub{transform-box:fill-box;transform-origin:center;animation:aob1pop 1.8s ease-in-out infinite}
        .aob1-key{transform-box:fill-box;transform-origin:center;animation:aob1key 1.8s ease-in-out infinite}
      </style><rect width="400" height="176" fill="#f6ff9a"/><rect x="44" y="22" width="312" height="132" rx="11" fill="#17171a" stroke="#000" stroke-opacity=".12"/><rect x="64" y="46" width="150" height="10" rx="5" fill="#3a3a3a"/><rect x="64" y="70" width="232" height="7" rx="3.5" fill="#2b2b2b"/><rect x="64" y="85" width="196" height="7" rx="3.5" fill="#2b2b2b"/><g class="aob1-key"><rect x="150" y="106" width="34" height="30" rx="7" fill="#242424" stroke="#f6ff9a" stroke-width="1.5"/><text x="167" y="127" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="700" fill="#f6ff9a" text-anchor="middle">A</text></g><circle class="aob1-ring" cx="320" cy="118" r="19" fill="#f6ff9a" fill-opacity=".55"/><g class="aob1-bub"><circle cx="320" cy="118" r="18" fill="#f6ff9a"/><path d="M311 116a8 8 0 0 1 16 0 7.6 7.6 0 0 1-8 7.5 8 8 0 0 1-3.4-.8l-4 1.1 1.1-3.4a7.5 7.5 0 0 1-1.7-4.4z" fill="#17171a"/></g></svg>` },
    { title: '2 · Click anything',
      body: 'Click any heading, paragraph, image, or card on the page to attach a note exactly where it matters.',
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
      --sm-muted:  #c2c2c2;
      --sm-danger: #f04758;
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
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
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
      font-family: 'Inter', sans-serif;
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
      padding: 5px 8px; font-size: 12px; font-family: 'Inter', sans-serif;
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
      font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500;
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
      padding: 5px 8px; font-family: 'Inter', sans-serif; font-size: 11.5px; font-weight: 600;
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
      box-shadow: 0 12px 40px rgba(0,0,0,0.6); font-family: 'Inter', sans-serif;
    }
    .annot-modal-title { font-size: 15px; font-weight: 700; color: var(--sm-text); }
    .annot-modal-body  { font-size: 12.5px; color: var(--sm-muted); margin-top: 8px; line-height: 1.5; }
    .annot-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

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
      font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700;
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

    /* ── annotation cards ── */
    .annot-card {
      position: absolute; right: 20px; z-index: 999989;
      width: 272px;
      background: var(--sm-bg-1);
      border: 1px solid var(--sm-border); border-radius: 10px;
      padding: 10px 12px;
      font-family: 'Inter', sans-serif; font-size: 12.5px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      transition: box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
    }
    .annot-card:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.55); border-color: var(--sm-border-strong); }
    .annot-card.focused {
      border-color: var(--sm-brand);
      box-shadow: 0 6px 28px rgba(246,255,154,0.18), 0 2px 8px rgba(0,0,0,0.5);
      transform: translateX(-4px);
      z-index: 999991;
    }
    body.annot-has-focus .annot-card:not(.focused) { opacity: 0.35; }
    .annot-card.frozen { border-left: 2px solid var(--sm-border); }
    .annot-card.resolved { opacity: 0.45; }

    /* highlighted element pulse on card hover */
    .annot-target.annot-target-active {
      background: rgba(246,255,154,0.35) !important;
      outline: 2px solid rgba(246,255,154,0.7) !important;
      outline-offset: 3px !important;
      transition: background 0.2s ease, outline 0.2s ease;
    }
    .annot-card-head {
      display: flex; align-items: center; gap: 6px;
    }
    .annot-card-author {
      font-size: 12px; font-weight: 600; color: var(--sm-text-2); flex: 1;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .annot-card-time {
      font-size: 10px; color: var(--sm-muted); white-space: nowrap;
    }
    .annot-card-actions {
      display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s ease;
    }
    .annot-card:hover .annot-card-actions { opacity: 1; }
    .annot-card-btn {
      width: 22px; height: 22px; border-radius: 5px;
      background: none; border: 1px solid transparent;
      color: var(--sm-text-2); cursor: pointer; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.1s ease;
      position: relative;
    }
    .annot-card-btn svg { width: 14px; height: 14px; display: block; }
    .annot-card-btn:hover { background: var(--sm-bg-2); border-color: var(--sm-border); color: var(--sm-text); }
    /* Resolve = pronounced: larger, circular, green affordance; filled when done. */
    .annot-card-btn.resolve {
      width: 26px; height: 26px; border-radius: 50%;
      color: #64de3c; border-color: rgba(100,222,60,0.4);
    }
    .annot-card-btn.resolve svg { width: 16px; height: 16px; }
    .annot-card-btn.resolve:hover { color: #64de3c; border-color: #64de3c; background: rgba(100,222,60,0.12); }
    .annot-card-btn.resolve.done {
      color: #0b0b0c; background: #64de3c; border-color: #64de3c;
    }
    /* When resolved, keep the actions row visible so the green check reads as state. */
    .annot-card.resolved .annot-card-actions { opacity: 1; }
    .annot-card-body { padding-top: 4px; }
    .annot-card-snippet {
      font-size: 11px; color: var(--sm-muted); font-style: italic; line-height: 1.4;
      margin-bottom: 5px;
      overflow: hidden; display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .annot-card-comment {
      font-size: 12.5px; color: var(--sm-text-2); line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
      overflow: hidden; display: -webkit-box;
      -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    }
    .annot-card-comment.expanded { overflow: visible; display: block; }
    .annot-card-more {
      display: inline; background: none; border: none;
      color: var(--sm-muted); font-size: 11px; cursor: pointer;
      padding: 0; font-family: 'Inter', sans-serif;
    }
    .annot-card-more:hover { color: var(--sm-text-2); }
    .annot-card-divider { border: none; border-top: 1px solid var(--sm-border); margin: 6px 0; }
    .annot-card-reply-item { margin-bottom: 6px; }
    .annot-reply-head { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
    .annot-reply-author { font-size: 11px; font-weight: 600; color: var(--sm-text-2); }
    .annot-reply-time { font-size: 10px; color: var(--sm-muted); }
    .annot-reply-text {
      font-size: 12px; color: var(--sm-text-2); line-height: 1.45;
      padding-left: 23px; white-space: pre-wrap; word-break: break-word;
    }
    .annot-card-input-row {
      display: flex; align-items: center; gap: 6px;
      margin-top: 6px; padding-top: 6px;
      border-top: 1px solid var(--sm-border);
    }
    .annot-card-input-row input {
      flex: 1; background: var(--sm-bg); color: var(--sm-text);
      border: 1px solid var(--sm-border); border-radius: 6px;
      padding: 5px 8px; font-size: 12px; font-family: 'Inter', sans-serif;
      outline: none;
    }
    .annot-card-input-row input:focus { border-color: var(--sm-brand); }
    .annot-card-send {
      width: 24px; height: 24px; border-radius: 50%;
      background: var(--sm-brand); color: var(--sm-bg);
      border: none; font-size: 12px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      transition: background 0.1s ease;
    }
    .annot-card-send:hover { background: #e8f24a; }
    .annot-card-send svg { width: 15px; height: 15px; display: block; }
    .annot-card-menu {
      position: fixed; background: var(--sm-bg-1);
      border: 1px solid var(--sm-border); border-radius: 8px;
      padding: 4px; min-width: 180px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 1000001;
    }
    .annot-card-menu-item {
      display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
      background: none; border: none;
      padding: 7px 12px; font-size: 12px; color: var(--sm-text-2);
      cursor: pointer; border-radius: 5px;
      font-family: 'Inter', sans-serif;
    }
    .annot-card-menu-item svg { width: 15px; height: 15px; flex-shrink: 0; display: block; }
    .annot-card-menu-item:hover { background: var(--sm-bg-2); }
    .annot-card-menu-item.danger { color: var(--sm-danger); }
    .annot-card-menu-item.disabled { color: var(--sm-muted); cursor: default; pointer-events: none; }


    /* ── tooltip ── */
    [data-tooltip] { position: relative; }
    [data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute; bottom: calc(100% + 5px); left: 50%;
      transform: translateX(-50%);
      background: var(--sm-bg-2); color: var(--sm-text-2);
      border: 1px solid var(--sm-border);
      font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500;
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
      font-family: 'Inter', sans-serif; overflow: hidden;
    }
    .annot-popup-header {
      padding: 10px 14px 9px;
      border-bottom: 1px solid var(--sm-border);
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .annot-popup-meta {
      font-family: ui-monospace, monospace;
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
      font-family: 'Inter', -apple-system, sans-serif;
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
      font-family: 'Inter', sans-serif; font-size: 12.5px; line-height: 1.5; outline: none;
    }
    .annot-popup textarea:focus { border-color: var(--sm-brand); }
    .annot-popup-hint {
      display: flex; align-items: center; gap: 4px;
      font-size: 10px; color: var(--sm-muted); margin-top: 6px;
    }
    .annot-popup-hint .annot-kbd { margin-left: 0; }
    .annot-popup-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
    .annot-popup-actions > * + * { margin-left: 6px; }
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
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 11.5px; font-weight: 600; outline: none;
      transition: border-color 0.15s ease;
    }
    .annot-identity-input::placeholder { color: var(--sm-muted); font-weight: 500; }
    .annot-identity-input:hover  { border-bottom-color: var(--sm-border-strong); }
    .annot-identity-input:focus  { border-bottom-style: solid; border-bottom-color: var(--sm-brand); }

    /* ── buttons ── */
    .annot-btn {
      font-family: 'Inter', sans-serif;
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
      font-family: 'Inter', -apple-system, sans-serif;
      color: var(--sm-muted); background: var(--sm-bg);
      border: 1px solid var(--sm-border); border-radius: 3px;
      padding: 1px 5px; display: inline-block; vertical-align: middle;
    }
    .annot-btn-primary .annot-kbd,
    .annot-fab.on .annot-kbd {
      color: rgba(0,0,0,0.55); background: rgba(0,0,0,0.15); border-color: rgba(0,0,0,0.25);
    }

    /* ── highlighted annotated elements ── */
    .annot-target {
      background: rgba(246,255,154,0.18) !important;
      border-radius: 3px;
    }
    .annot-target.resolved { background: transparent !important; }

    /* light-page overrides */
    body.annot-light-page .annot-target {
      background: rgba(180,200,0,0.22) !important;
      outline: 1px solid rgba(160,185,0,0.35);
      outline-offset: 1px;
    }
    body.annot-light-page .annot-target.resolved { background: transparent !important; outline: none; }
    body.annot-light-page .annot-badge {
      box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 0 0 2px rgba(0,0,0,0.12);
    }

    /* ── toast ── */
    .annot-toast {
      position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
      background: var(--sm-brand); color: var(--sm-bg);
      padding: 9px 16px; border-radius: 999px;
      font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600;
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
      font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700;
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
      font-family: 'Inter', sans-serif; color: var(--sm-text);
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
      font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 600;
      cursor: pointer; padding: 8px 4px;
    }
    .annot-onboard-skip:hover { color: var(--sm-text-2); }
    .annot-onboard-start { margin-left: auto; }

    /* ── inline "Confirm delete?" popover (replaces native confirm) ── */
    .annot-confirm-pop {
      position: fixed; z-index: 1000002;
      display: flex; align-items: center; gap: 8px;
      background: var(--sm-bg-1); border: 1px solid var(--sm-border);
      border-radius: 10px; padding: 7px 8px 7px 13px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.55);
      font-family: 'Inter', sans-serif;
      animation: annot-panel-in 0.12s ease;
    }
    .annot-confirm-label { font-size: 12.5px; font-weight: 600; color: var(--sm-text); white-space: nowrap; }
    .annot-confirm-pop button {
      font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600;
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
      font-family: ui-monospace, monospace; font-size: 10px; font-weight: 500;
      color: var(--sm-muted); white-space: nowrap;
      box-shadow: 0 2px 10px rgba(0,0,0,0.45);
      pointer-events: auto; cursor: pointer;
      max-width: 260px; overflow: hidden; text-overflow: ellipsis;
      transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
    }
    .annot-path-copier:hover { background: var(--sm-brand); color: var(--sm-bg); border-color: var(--sm-brand); }
    .annot-path-copier svg { width: 11px; height: 11px; display: block; flex-shrink: 0; }
  `;
  injectStyle(css, 'sm-annotator-style');

  /* ── build fixed UI ──────────────────────────────────────────────── */
  const ICON_CHAT  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_DOTS  = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  // Icon set for icon-buttons (SVG, not Unicode glyphs — crisp at any DPI).
  const ICON_CHECK   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON_MENU_H  = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  const ICON_SEND    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ICON_EDIT    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const ICON_TRASH   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
  const ICON_COPY    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_CHEV_L  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_CHEV_R  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  // Expanded control: a draggable banner — "● Annotate Mode Enabled" + a
  // share button (Copy / Export) + the ⋮ options button + the ✕ exit button.
  const fabRow = mkEl('div', 'annot-fab-row');

  const bannerLabel = mkEl('span', 'annot-banner-label');
  const bannerDot   = mkEl('span', 'annot-banner-dot');
  const bannerText  = mkEl('span'); bannerText.textContent = 'Annotate Mode Enabled';
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
    await writeClipboard(structuralPath(pathCopierTarget));
    toast('Path copied');
  });
  document.body.appendChild(pathCopierEl);

  applySpot(loadSpot());   // place bubble + banner at the shared spot
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
  window.addEventListener('scroll', throttle(() => { renderBadges(); positionCards(); }, 60), { passive: true });
  window.addEventListener('resize', throttle(() => { renderBadges(); positionCards(); }, 60));

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
    onboardingEls.capTitle.textContent = step.title;
    if (step.kbd) addKbd(onboardingEls.capTitle, step.kbd);
    onboardingEls.capBody.textContent = step.body;
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
    tag.appendChild(mkEl('span', null, 'Click here or press'));
    addKbd(tag, 'A');
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
  // spot (both bubble + banner) on release and persists it. `onTap` runs when
  // the pointer was pressed and released without dragging.
  function enableSpotDrag(el, onTap) {
    let down = false, moved = false, sx = 0, sy = 0, offX = 0, offY = 0, justDragged = false;
    el.addEventListener('click', (e) => {
      if (justDragged) { e.stopPropagation(); e.preventDefault(); justDragged = false; }
    }, true);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
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
        } else if (onTap) {
          onTap();
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
    if (!mode) return;
    if (!e.isTrusted) return;
    if (isUI(e.target)) return;
    if (isPageRoot(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    // The first action is always the annotation itself — never a name gate.
    // Identity is captured inline inside the composer (see openEditor) so the
    // reviewer can just type their note and Save.
    openEditor(e.target, null);
  }
  function isUI(t) {
    return !!t.closest?.('.annot-fab-row,.annot-icon-fab,.annot-actions-btn,.annot-actions-panel,.annot-popup,.annot-badge,.annot-card,.annot-card-menu,.annot-confirm-pop,.annot-toast,.annot-collapser,.annot-modal-overlay,.annot-tooltip,.annot-path-copier');
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

    const arm = setTimeout(() => document.addEventListener('mousedown', outsideClose, true), 0);
    detachOutsideClose = () => {
      clearTimeout(arm);
      document.removeEventListener('mousedown', outsideClose, true);
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

    const hideItem  = mkMenuItem('Hide Annotate UI', 'H');
    const clearItem = mkMenuItem('Clear All Comments', '⇧C', 'danger');
    const opts = mkEl('div', 'annot-menu-items');
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

  function openEditor(target, existing) {
    closePopup();
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
    positionPopup(popup, target);
    activePopup = { el: popup, target };
    setTimeout(() => ta.focus(), 10);

    setTimeout(() => document.addEventListener('mousedown', outsideClose, true), 0);
    function outsideClose(ev) {
      if (!popup.contains(ev.target)) {
        document.removeEventListener('mousedown', outsideClose, true);
        closePopup();
      }
    }
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
    if (activePopup) { activePopup.el.remove(); activePopup = null; }
  }

  /* ── commits ─────────────────────────────────────────────────────── */
  function commitNew(target, raw) {
    const comment = (raw || '').trim();
    if (!comment) { closePopup(); return; }
    // First successful note locks in the reviewer identity — even if they left
    // the inline name blank and kept the default — so we never ask again.
    nameSet = true;
    if (!store.get(REVIEWER_KEY)) store.set(REVIEWER_KEY, reviewerName);
    // Compute the durable selector BEFORE stamping the volatile ref, so the
    // persisted selector survives a reload (the data-annot-ref attribute does not).
    const durableSelector = selectorFor(target);
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
      elementPath:    elementPath(target),   // complete DOM path — for the LLM, not shown on the card
      tag:            tagDescription(target),
      sectionContext: sectionContextFor(target),
      textSnippet:    textSnippet(target),
      author:         reviewerName,
      comment,
      replies:        [],
      frozen:         false,
    });
    saveLive(); closePopup(); refresh(); toast('Note saved');
  }

  function commitEdit(existing, raw) {
    const comment = (raw || '').trim();
    if (!comment) { closePopup(); return; }
    existing.comment   = comment;
    existing.updatedAt = new Date().toISOString();
    saveLive(); closePopup(); refresh(); toast('Note updated');
  }

  function commitReply(annotation, raw) {
    const comment = (raw || '').trim();
    if (!comment) { closePopup(); return; }
    const target = annotation.frozen ? findOrCreateShadow(annotation) : annotation;
    const replyId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    sessionNoteIds.add(replyId);
    (target.replies = target.replies || []).push({
      id: replyId, author: reviewerName, comment, createdAt: new Date().toISOString(),
    });
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
  function renderBadges() {
    document.querySelectorAll('.annot-badge').forEach(b => b.remove());
    allAnnotations().filter(a => a.page === PAGE && !a.isShadow).forEach(a => {
      const target = resolveTarget(a);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const badge   = mkEl('div', 'annot-badge' + (a.frozen ? ' frozen' : '') + (a.resolved ? ' resolved' : ''));
      const numSpan = mkEl('span', 'annot-badge-num', '#' + a.localId);
      badge.appendChild(numSpan);

      if (!a.frozen) {
        const delSpan = mkEl('span', 'annot-badge-del', '×');
        badge.appendChild(delSpan);
      }

      badge.title   = a.comment.slice(0, 200);
      badge.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        // If × is showing (hover state active), treat whole badge as delete
        const del = badge.querySelector('.annot-badge-del');
        if (del && window.getComputedStyle(del).display !== 'none') {
          confirmDelete(badge, () => deleteAnnot(a));
        } else {
          scrollToCard(a.id);
        }
      };
      badge.style.top  = (rect.top  + window.scrollY - 10) + 'px';
      badge.style.left = (rect.right + window.scrollX - 14) + 'px';
      document.body.appendChild(badge);
    });
  }

  function resolveTarget(a) {
    let t = null;
    if (a.ref)      { try { t = document.querySelector(`[data-annot-ref="${a.ref}"]`); } catch { t = null; } }
    if (!t && a.selector) { try { t = document.querySelector(a.selector); } catch { t = null; } }
    // Re-anchor: the data-annot-ref attribute lives only in the session DOM and
    // is gone after a reload, so we resolve via the durable selector and re-stamp
    // the ref onto the element. Without this, persisted comments silently vanish
    // on refresh / after export even though they're safe in localStorage.
    if (t && a.ref && t.dataset.annotRef !== a.ref) t.dataset.annotRef = a.ref;
    return t;
  }

  /* ── annotation cards ────────────────────────────────────────────── */
  function renderAnnotationCards() {
    document.querySelectorAll('.annot-card').forEach(c => c.remove());
    const pageAnnots = allAnnotations().filter(a => a.page === PAGE && !a.isShadow);
    if (pageAnnots.length === 0) return;

    pageAnnots.forEach(a => {
      const target = resolveTarget(a);
      if (!target) return;
      const rect = target.getBoundingClientRect();

      const card = mkEl('div', 'annot-card' + (a.frozen ? ' frozen' : '') + (a.resolved ? ' resolved' : ''));
      card.dataset.annotId = a.id;

      // head: avatar + author + time + actions (resolve, menu)
      const head = mkEl('div', 'annot-card-head');
      const av   = mkEl('img', 'annot-avatar');
      av.src     = generateAvatar(a.author || 'Reviewer');
      av.alt     = a.author || 'Reviewer';
      av.style.cssText = 'width:24px;height:24px;flex-shrink:0;border-radius:50%;display:block;';
      const authorEl = mkEl('span', 'annot-card-author', a.author || 'Reviewer');
      const timeEl   = mkEl('span', 'annot-card-time',   fmtRelTime(a.createdAt));

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
        if (!a.frozen) {
          const editItem = mkEl('button', 'annot-card-menu-item');
          editItem.innerHTML = ICON_EDIT + '<span>Edit</span>';
          editItem.onclick = () => { menu.remove(); openInlineEdit(card, a); };
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
        menu.style.top  = (br.bottom + 4) + 'px';
        menu.style.left = Math.max(8, br.right - menu.offsetWidth) + 'px';
        setTimeout(() => {
          function outsideMenuClose(ev) {
            if (!menu.contains(ev.target) && ev.target !== menuBtn) {
              menu.remove();
              document.removeEventListener('mousedown', outsideMenuClose, true);
            }
          }
          document.addEventListener('mousedown', outsideMenuClose, true);
        }, 0);
      };

      actions.append(resolveBtn, menuBtn);
      head.append(av, authorEl, timeEl, actions);
      card.appendChild(head);

      // body: snippet + comment with clamp + replies + input row
      const body = mkEl('div', 'annot-card-body');

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
      replyAv.style.cssText = 'width:20px;height:20px;flex-shrink:0;border-radius:50%;display:block;';
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
      body.appendChild(inputRow);

      card.appendChild(body);

      card.onclick = (e) => {
        if (e.target.closest('.annot-card-actions,.annot-card-menu')) return;
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

      card.style.top = (rect.top + window.scrollY - 10) + 'px';
      document.body.appendChild(card);

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
    cards.forEach(card => {
      const a = allAnnotations().find(x => x.id === card.dataset.annotId);
      if (!a) return;
      const t = resolveTarget(a);
      if (!t) return;
      const rect = t.getBoundingClientRect();
      card.dataset.idealTop = String(rect.top + window.scrollY - 10);
    });
    // Sort by ideal position, then resolve overlaps
    cards.sort((a, b) => parseFloat(a.dataset.idealTop) - parseFloat(b.dataset.idealTop));
    // Collect all heights before writing to avoid layout thrashing
    const heights = cards.map(card => card.offsetHeight);
    let minTop = 0;
    cards.forEach((card, i) => {
      const ideal = parseFloat(card.dataset.idealTop) || 0;
      const actual = Math.max(ideal, minTop);
      card.style.top = actual + 'px';
      minTop = actual + heights[i] + 8;
    });
  }

  /* ── mutations ───────────────────────────────────────────────────── */
  function deleteAnnot(a) {
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

    const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
    yes.onclick = (e) => { e.stopPropagation(); close(); onYes(); };
    no.onclick  = (e) => { e.stopPropagation(); close(); };
    function outside(ev) { if (!pop.contains(ev.target)) close(); }
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }

  function toggleResolve(a) {
    a.resolved = !a.resolved;
    saveLive(); refresh();
  }

  function _clearAnnotations() {
    annotations = [];
    saveLive(); refresh();
  }

  function clearAll() {
    const live = annotations.filter(a => !a.isShadow).length;
    if (live === 0) { toast('Nothing to clear'); return; }
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
      '.annot-badge,.annot-card,.annot-toast,.annot-collapser,#sm-annotator-style'
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
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.download = `${rawBase}_v${nextVersion}.html`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
        lines.push(a.comment);
        getReplies(a).forEach(r => lines.push(`  ↳ ${r.author || 'Reviewer'}: ${r.comment}`));
        lines.push('');
      });
    });
    return lines.join('\n');
  }

  function exportMarkdown() {
    const all = allAnnotations().filter(a => !a.isShadow);
    if (all.length === 0) { toast('No annotations yet'); return; }
    const filePath = decodeURIComponent(location.pathname);
    const preamble = `File: ${filePath}\nBefore making changes, check if there is an equivalent .md file at the same path that should be updated first.\n\n`;
    const blob = new Blob([preamble + buildMarkdown()], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${slug(ARTEFACT_NAME)}-annotations-${new Date().toISOString().slice(0,10)}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // Comments are persistent: exporting must NOT wipe them. They stay on the
    // page (and in localStorage via saveLive) so they survive export + reload.
    // Use "Clear All Comments" (⇧C) to remove them deliberately.
    toast('Exported \u2014 comments kept on the page');
  }

  // Shared clipboard write — navigator.clipboard throws on file:// origins in
  // Chrome, so fall back to a hidden-textarea execCommand copy there.
  async function writeClipboard(text) {
    if (location.protocol !== 'file:' && navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }

  async function copyMarkdown() {
    const all = allAnnotations().filter(a => !a.isShadow);
    if (all.length === 0) { toast('No annotations yet'); return; }
    const filePath = decodeURIComponent(location.pathname);
    const preamble = `File: ${filePath}\nBefore making changes, check if there is an equivalent .md file at the same path that should be updated first.\n\n`;
    await writeClipboard(preamble + buildMarkdown());
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
    await writeClipboard(lines.join('\n'));
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

    const ta = mkEl('textarea');
    ta.value = original;
    ta.style.cssText = 'width:100%;min-height:70px;resize:vertical;background:var(--sm-bg);color:var(--sm-text);border:1px solid var(--sm-brand);border-radius:6px;padding:6px 8px;box-sizing:border-box;font-family:Inter,sans-serif;font-size:12.5px;line-height:1.5;outline:none;margin-top:4px;';
    const row = mkEl('div');
    row.style.cssText = 'display:flex;gap:5px;margin-top:5px;justify-content:flex-end;';
    const cancelBtn = mkEl('button', 'annot-btn annot-btn-mini', 'Cancel');
    const saveBtn   = mkEl('button', 'annot-btn annot-btn-primary annot-btn-mini', 'Save');
    addKbd(cancelBtn, 'Esc');
    addKbd(saveBtn, SAVE_KBD);
    row.append(cancelBtn, saveBtn);
    body.appendChild(ta);
    body.appendChild(row);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.value.length; }, 10);

    const restore = () => {
      ta.remove(); row.remove();
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
  function loadLive()         { try { return JSON.parse(store.get(STORAGE_KEY) || '[]'); } catch { return []; } }
  function saveLive()         { store.set(STORAGE_KEY, JSON.stringify(annotations)); }
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
  function refresh() { renderBadges(); renderAnnotationCards(); updateTargetHighlights(); }

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
  function selectorFor(t) {
    const esc = c => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(c) : String(c).replace(/[^a-zA-Z0-9_-]/g, '');
    // Prefer a stable, reload-proof #id when it's present and unique. We must
    // NOT key off data-annot-ref here: it only exists in the live session DOM,
    // so a ref-based selector breaks on refresh and the comment disappears.
    if (t.id) {
      const idSel = '#' + esc(t.id);
      try { if (document.querySelectorAll(idSel).length === 1) return idSel; } catch {}
    }
    // Use tag + :nth-of-type only — no CSS classes. Class names change when
    // styles are refactored; structural position is stable across those edits.
    const parts = []; let cur = t; let d = 0;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && d < 6) {
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part); cur = parent; d++;
    }
    return parts.join(' > ');
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
    module.exports = { generateAvatar, fmtRelTime, slug, buildMarkdown, selectorFor, tagDescription };
  }
})();
