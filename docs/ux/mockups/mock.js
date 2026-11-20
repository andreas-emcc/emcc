// UXA mockups: the mockup's own controls and the repeated parts. Static, no build, nothing loaded
// from the internet. The icons are a few of Lucide's (ISC), as the SDK's icon set is.
(function () {
  const I = {
    chevron: '<path d="m9 18 6-6-6-6"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    side: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    bottom: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15h18"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    off: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    shapes: '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
    cross: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    unit: '<rect x="3" y="6" width="18" height="12"/><path d="m3 6 18 12"/><path d="m21 6-18 12"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>',
    play: '<path d="m6 3 14 9-14 9V3z"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.500 1.500L13 8 4.800 6.200c-.5-.1-.9.1-1.100.5l-.3.5c-.2.5-.1 1 .3 1.300L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.500 5.300c.3.4.8.5 1.300.3l.5-.2c.4-.3.6-.7.5-1.200z"/>',
    ship: '<path d="M2 21c.6.5 1.200 1 2.500 1 2.500 0 2.500-2 5-2 1.300 0 1.900.5 2.500 1 .6.5 1.200 1 2.500 1 2.500 0 2.500-2 5-2 1.300 0 1.900.5 2.500 1"/><path d="M19.380 20A11.600 11.600 0 0 0 21 14l-9-4-9 4c0 2.900.940 5.340 2.810 7.760"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.750 10.750 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.750 10.750 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.750 9.750 0 0 1 6.740 2.740L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.750 9.750 0 0 1-6.740-2.740L3 16"/><path d="M8 16H3v5"/>',
  };
  const icon = (n, cls) =>
    `<svg class="emc2-icon ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || I.info}</svg>`;
  window.uxIcon = icon;

  // ---- State: direction, look, scheme, density (URL parameters win, then what was chosen last) ----
  const DEF = { dir: 'lines', look: 'signal', scheme: 'dark', density: 'compact', head: 'soft' };
  // The owner's mix (2026-11-13): Lines for the workspace, Cards for Settings and the Monitor.
  const PAGE = (location.pathname.split('/').pop() || 'view.html').replace('.html', '');
  const EMBED = new URLSearchParams(location.search).has('embed');
  DEF.dir = PAGE === 'view' ? 'lines' : 'cards';
  let st = { ...DEF };
  try {
    const kept = JSON.parse(localStorage.getItem('uxmock2') || '{}');
    Object.assign(st, kept.all || {}, { dir: (kept.dir || {})[PAGE] || DEF.dir });
  } catch (e) { /* no storage */ }
  new URLSearchParams(location.search).forEach((v, k) => { if (k in DEF) st[k] = v; });
  const root = document.documentElement;
  function apply() {
    for (const k in DEF) root.dataset[k] = st[k];
    if (!EMBED) {
      try {
        const kept = JSON.parse(localStorage.getItem('uxmock2') || '{}');
        const { dir, ...all } = st;
        localStorage.setItem('uxmock2', JSON.stringify({ all, dir: { ...(kept.dir || {}), [PAGE]: dir } }));
      } catch (e) { /* no storage */ }
    }
    document.querySelectorAll('#mockbar button[data-k]').forEach((b) => b.setAttribute('aria-pressed', String(st[b.dataset.k] === b.dataset.v)));
  }
  apply();

  const OPTS = {
    dir: [['lines', '1 Lines'], ['surfaces', '2 Surfaces'], ['cards', '3 Cards']],
    look: [['night-watch', 'Night Watch'], ['chart-room', 'Chart Room'], ['signal', 'Signal']],
    scheme: [['dark', 'Dark'], ['light', 'Light']],
    density: [['compact', 'Compact'], ['comfortable', 'Comfortable']],
    head: [['soft', 'Soft'], ['full', 'Full accent'], ['title', 'Title only']],
  };
  const NAMES = { dir: 'Direction', look: 'Look', scheme: 'Scheme', density: 'Density', head: 'Open head' };
  const PAGES = [['view.html', 'View', 'map'], ['settings.html', 'Settings', 'sliders'], ['monitor.html', 'Monitor', 'activity']];
  const MOCKONLY = [['colours.html', 'Colour review']];

  document.addEventListener('DOMContentLoaded', () => {
    const here = location.pathname.split('/').pop() || 'view.html';
    // The mockup's control bar
    const bar = document.createElement('div');
    bar.id = 'mockbar';
    bar.innerHTML = '<b>Mockup controls</b>' +
      Object.keys(OPTS).map((k) => `<span class="seg"><span>${NAMES[k]}</span>${OPTS[k].map(([v, t]) => `<button data-k="${k}" data-v="${v}">${t}</button>`).join('')}</span>`).join('') +
      `<span class="seg" id="mockextra"></span><span class="seg">${MOCKONLY.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</span>`;
    if (!EMBED) document.body.prepend(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      st[b.dataset.k] = b.dataset.v;
      if (b.dataset.k === 'look') st.density = b.dataset.v === 'chart-room' ? 'comfortable' : 'compact';
      apply();
    });

    // The top bar
    const top = document.querySelector('.ux-top');
    if (top) {
      top.innerHTML = `<span class="ux-logo">emcc</span><nav class="ux-views">` +
        PAGES.map(([h, t, i]) => `<a class="ux-view" href="${h}" ${h === here ? 'aria-current="page"' : ''}>${icon(i)}${t}</a>`).join('') +
        `</nav><span class="ux-grow"></span>
        <button class="emc2-button">${icon('bookmark')}Bookmarks</button>
        <button class="emc2-button">${icon('eye')}Look</button>
        <button class="emc2-button">${icon('grid')}Setups</button>
        <span class="ux-clock">131518Z NOV 26</span>
        <span class="ux-chip ux-warn">${icon('warn')}No login</span>`;
    }

    // Icons, panel tools, grips
    document.querySelectorAll('i[data-i]').forEach((el) => { el.outerHTML = icon(el.dataset.i, el.className); });
    document.querySelectorAll('.ux-head').forEach((h) => {
      const t = document.createElement('span');
      t.className = 'ux-head-tools';
      t.innerHTML = [['up', 'Move up'], ['down', 'Move down'], ['side', 'Move to the other side'], ['bottom', 'Move to the bottom pane']]
        .map(([i, l]) => `<button class="emc2-icon-button" title="${l}" aria-label="${l}">${icon(i)}</button>`).join('');
      h.append(t);
    });
    document.querySelectorAll('.ux-pane').forEach((p) => { const g = document.createElement('span'); g.className = 'ux-grip'; g.title = 'Drag to resize'; p.append(g); });
    apply();

    document.addEventListener('click', (e) => {
      const tog = e.target.closest('.ux-head-toggle');
      if (tog) tog.closest('.ux-panel').toggleAttribute('data-open');
      const info = e.target.closest('.ux-info');
      if (info) {
        const more = info.closest('.emc2-field').querySelector('.ux-more');
        more.hidden = !more.hidden;
        info.setAttribute('aria-expanded', String(!more.hidden));
      }
      const tile = e.target.closest('.ux-tile');
      if (tile) {
        document.querySelectorAll('.ux-tile[aria-pressed="true"]').forEach((t) => t.setAttribute('aria-pressed', 'false'));
        tile.setAttribute('aria-pressed', 'true');
      }
    });

    // Unsaved changes: every editing surface counts its own and shows them in its own save bar
    document.addEventListener('input', (e) => {
      const surf = e.target.closest('[data-surface]');
      if (!surf || e.target.closest('.ux-search')) return;
      (surf._dirty = surf._dirty || new Set()).add(e.target);
      setBar(surf);
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-reset]');
      if (!b) return;
      const surf = b.closest('[data-surface]');
      surf._dirty = new Set();
      setBar(surf);
    });
    document.querySelectorAll('[data-surface]').forEach(setBar);
  });

  function setBar(surf) {
    const bar = surf.querySelector(':scope > .ux-savebar, :scope > .ux-foot');
    if (!bar) return;
    const n = surf._dirty ? surf._dirty.size : Number(bar.dataset.demo || 0);
    bar.toggleAttribute('data-dirty', n > 0);
    const s = bar.querySelector('.ux-state');
    if (s) s.innerHTML = n > 0 ? `${icon('pencil')}${n} unsaved change${n > 1 ? 's' : ''}` : `${icon('check')}All saved`;
    bar.querySelectorAll('[data-reset]').forEach((b) => { b.disabled = n === 0; });
  }

  // A field: label, control, a short hint, and the long help behind an (i)
  window.uxField = (label, control, hint, more, cls) =>
    `<label class="emc2-field ${cls || ''}"><span class="ux-labelrow"><span class="emc2-field-label">${label}</span>${more ? `<button type="button" class="ux-info" aria-expanded="false" aria-label="More about ${label}">${icon('info')}</button>` : ''}</span>${control}${hint ? `<span class="ux-hint">${hint}</span>` : ''}${more ? `<span class="ux-more" hidden>${more}</span>` : ''}</label>`;
  window.uxInput = (v, cls) => `<input class="emc2-input ${cls || ''}" value="${v}">`;
  window.uxSelect = (opts) => `<select class="emc2-input">${opts.map((o) => `<option>${o}</option>`).join('')}</select>`;
})();
