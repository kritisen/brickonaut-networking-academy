// Phone viewport checks, run from smoke_browser.mjs (also on their own: node tests/smoke_browser.mjs --mobile-only).
// For every phone size and every screen: no horizontal page overflow, nothing visible spilling past the viewport
// edges (except inside a horizontal scroller), the key buttons on screen and at least 44 px in both directions,
// and the mission ship never covering the question. Screenshots go to screenshots/mobile/ (the tracked README set)
// and screenshots/mobile-all/ (everything, gitignored).

export const PHONES = [
  { id: 'se', w: 375, h: 667, label: 'iPhone SE' },
  { id: 'i15', w: 390, h: 844, label: 'iPhone 14/15' },
  { id: 'android', w: 412, h: 915, label: 'large Android' },
  { id: 'land', w: 844, h: 390, label: 'phone landscape' }
];

// The README set: which (phone, screen) pairs get a tracked screenshot.
const TRACKED = {
  'i15-title': '01-title', 'i15-map': '02-galaxy-map', 'i15-mc': '03-multiple-choice', 'i15-order': '04-sequence',
  'se-numeric': '05-numeric-se', 'i15-diagram': '06-diagram', 'i15-feedback': '07-feedback-concept', 'i15-journey': '08-journey',
  'i15-log': '09-captains-log', 'land-mc': '10-landscape-question'
};

// Measure the current screen. `keys` = selectors of controls that must be reachable and tappable.
const MEASURE = (keys) => `(() => {
  const vw = innerWidth, vh = innerHeight, out = { vw, vh };
  const XOK = '#map-stage, .diagram-wrap, .fc-fig, .navcomp';   // designed sideways-scroll frames
  out.docW = document.documentElement.scrollWidth; out.bodyW = document.body.scrollWidth;
  const layers = ['#topbar', '.screen.active', '#dialog.open', '#modal.open', '#journey.open'];
  const roots = layers.map((s) => document.querySelector(s)).filter((n) => n && !n.classList.contains('hidden'));
  const visible = (n) => { const st = getComputedStyle(n); return st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity !== 0; };
  const shown = (n) => { for (let p = n; p && p !== document.body; p = p.parentElement) { if (!visible(p)) return false; } return true; };
  const decorative = (n) => !!n.closest('[aria-hidden="true"]:not(.screen), .mission-planet, .title-planet, .title-orbit, #starfield, #fx');
  const xScroller = (n) => { for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX; if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return p; } return null; };
  const clippedBy = (n, r) => { for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX; if (ox !== 'visible') { const q = p.getBoundingClientRect(); if (r.right > q.right + 1 || r.left < q.left - 1) return true; return false; } } return false; };
  const name = (n) => (n.id ? '#' + n.id : n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) +
    (n.textContent ? ' "' + n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 28) + '"' : '');
  out.overflow = []; out.clipped = [];
  roots.forEach((root) => root.querySelectorAll('*').forEach((n) => {
    if (n.closest('svg') && n.tagName.toLowerCase() !== 'svg') return;          // judge an SVG by its box, not its children
    const r = n.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (r.right <= vw + 1 && r.left >= -1) return;
    if (!shown(n) || decorative(n) || xScroller(n)) return;
    // Allowlist: content inside a designed sideways-scroll frame (map, wide diagram / figure, prefix table) is meant
    // to run past the screen edge and is reached by scrolling that frame; anything else clipped is a bug.
    if (n.parentElement && n.parentElement.closest(XOK)) return;
    (clippedBy(n, r) ? out.clipped : out.overflow).push(name(n) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
  }));
  out.overflow = out.overflow.slice(0, 8); out.clipped = out.clipped.slice(0, 8);
  // sideways scrolling is only allowed where it's designed in (pannable map, wide diagrams / figures)
  out.xscroll = [];
  roots.forEach((root) => [root, ...root.querySelectorAll('*')].forEach((n) => {
    if (n.scrollWidth <= n.clientWidth + 1 || !n.clientWidth || n.matches(XOK) || !shown(n)) return;
    const ox = getComputedStyle(n).overflowX; if (ox !== 'auto' && ox !== 'scroll') return;
    out.xscroll.push(name(n) + ' ' + n.scrollWidth + '>' + n.clientWidth);
  }));
  // small tap targets anywhere on the layers (report), key controls (assert)
  const TAPS = 'button, a[href], summary, input:not([type=hidden]), [role="button"], [role="radio"], [role="checkbox"], .order-item';
  out.small = [];
  roots.forEach((root) => root.querySelectorAll(TAPS).forEach((n) => {
    if (!shown(n) || n.closest('svg.ship, .jl-thumb, [inert]')) return;
    const r = n.getBoundingClientRect(); if (!r.width || !r.height) return;
    const lab = n.closest('label, .set-row'); const lr = lab && lab.getBoundingClientRect();
    const w = Math.max(r.width, lr ? lr.width : 0), h = Math.max(r.height, lr ? lr.height : 0);
    if (Math.min(w, h) < 44 - 0.5) out.small.push(name(n) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }));
  out.small = [...new Set(out.small)].slice(0, 20);
  out.keys = [];
  ${JSON.stringify(keys)}.forEach((sel) => {
    const all = [...document.querySelectorAll(sel)].filter(shown);
    if (!all.length) { out.keys.push({ sel, missing: true }); return; }
    all.slice(0, 6).forEach((n) => {
      n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = n.getBoundingClientRect();
      out.keys.push({ sel, w: Math.round(r.width), h: Math.round(r.height), inX: r.left >= -1 && r.right <= vw + 1, inY: r.top >= -1 && r.bottom <= vh + 1 });
    });
  });
  // the mission ship must never sit on top of the question / feedback
  const ship = document.getElementById('ship-panel');
  if (document.body.dataset.screen === 'mission' && ship && shown(ship)) {
    const a = ship.getBoundingClientRect();
    out.shipH = Math.round(a.height);
    ['q-card', 'feedback'].forEach((id) => { const c = document.getElementById(id), b = c.getBoundingClientRect();
      const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (b.height && ox * oy > 4) out.shipOverlap = id; });
  }
  const q = document.getElementById('q-prompt'); if (q && document.body.dataset.screen === 'mission') { const r = q.getBoundingClientRect(); out.promptTop = Math.round(r.top); }
  return out;
})()`;

export async function mobilePass(h, { audit = false } = {}) {
  const { send, evaluate, sleep, shot, waitFor, clearDialogs, answer, problems, key } = h;
  const report = {};
  const numericId = await evaluate(`ONA.QUESTIONS.find(q => q.type === 'numeric' && q.topic === 'cidr').id`);
  const firstOf = await evaluate(`(() => { const o = {}; ONA.QUESTIONS.forEach(q => { if (!o[q.type]) o[q.type] = q.id; }); return o; })()`);
  await evaluate(`ONA.store.setting('freeRoam', true); true`);

  for (const ph of PHONES) {
    await send('Emulation.setDeviceMetricsOverride', { width: ph.w, height: ph.h, deviceScaleFactor: 2, mobile: true, screenOrientation: ph.w > ph.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(400);
    const check = async (screen, keys = [], { tag = screen } = {}) => {
      await sleep(450);
      const m = await evaluate(MEASURE(keys));
      report[ph.id + '-' + tag] = m;
      const where = `mobile ${ph.label} ${ph.w}x${ph.h} / ${tag}:`;
      if (!audit) {
        if (m.docW > m.vw || m.bodyW > m.vw) problems.push(`${where} horizontal page overflow (doc ${m.docW}px > ${m.vw}px)`);
        if (m.overflow.length) problems.push(`${where} content past the viewport edge: ` + m.overflow.join(', '));
        if (m.xscroll.length) problems.push(`${where} unexpected sideways scrolling: ` + m.xscroll.join(', '));
        m.keys.forEach((k) => {
          if (k.missing) problems.push(`${where} key control missing: ${k.sel}`);
          else if (k.w < 44 || k.h < 44 || !k.inX || !k.inY) problems.push(`${where} key control ${k.sel} ${k.w}x${k.h} ${k.inX && k.inY ? '' : 'off-screen'}(needs >=44x44, on screen)`);
        });
        if (m.shipOverlap) problems.push(`${where} ship panel covers the ${m.shipOverlap}`);
        if (m.small.length) problems.push(`${where} tap targets under 44x44: ` + m.small.join(', '));
        if (m.clipped.length) problems.push(`${where} content clipped at the viewport edge: ` + m.clipped.join(', '));
      }
      const name = ph.id + '-' + tag;
      if (TRACKED[name]) await shot('mobile/' + TRACKED[name]);
      await shot('mobile-all/' + name);
      return m;
    };
    const drill = async (id) => {
      await evaluate(`ONA.game.run = null; ONA.game.closeModal(); ONA.game.startRun(null, 'drill', [ONA.util.qById('${id}')], 'Phone check'); true`);
      await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(500);
      await evaluate(`document.querySelector('#screen-mission .play').scrollTop = 0; true`);
    };
    const finish = async () => { await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await waitFor(`ONA.game.screen === 'debrief'`); };

    // title
    await evaluate(`ONA.game.run = null; ONA.game.closeModal(); ONA.game.show('title'); true`); await sleep(700);
    await check('title', ['#btn-begin']);
    // galaxy map + mission card
    await evaluate(`ONA.game.show('map'); true`); await sleep(900);
    await check('map', ['#btn-launch', '#topbar .nav-btn', '#topbar .icon-btn']);
    // briefing dialog
    await evaluate(`ONA.game.startRun(ONA.util.level(1), 'mission'); true`); await sleep(1500);
    await check('briefing', ['#dlg-next', '#dlg-skip']);
    await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(300);
    // question types
    await drill(firstOf.mc); await key('1'); await check('mc', ['#q-body .choice', '#btn-submit', '#hud-pause']);
    await answer(false); await sleep(900); await check('feedback', ['#btn-next', '#feedback .fb-concept > summary']);
    await finish(); await sleep(500);
    await check('debrief', ['#db-map']);
    await drill(firstOf.multi); await check('multi', ['#q-body .choice', '#btn-submit']); await answer(true); await finish();
    await drill(numericId);
    await evaluate(`document.getElementById('num-input').focus(); true`); await sleep(300);
    const inp = await evaluate(`(() => { const i = document.getElementById('num-input'), r = i.getBoundingClientRect(); return { mode: i.inputMode, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, font: parseFloat(getComputedStyle(i).fontSize) }; })()`);
    report[ph.id + '-numeric-input'] = inp;
    if (!audit) {
      if (inp.mode !== 'numeric') problems.push(`mobile ${ph.label}: numeric input should use inputmode=numeric (got ${inp.mode})`);
      if (inp.font < 16) problems.push(`mobile ${ph.label}: numeric input font ${inp.font}px < 16px (iOS zooms the page)`);
      // the on-screen keyboard covers roughly the lower half: the input must sit in the upper part once focused
      if (ph.h > ph.w && inp.bottom > inp.vh * 0.55) problems.push(`mobile ${ph.label}: focused numeric input too low (bottom ${inp.bottom}/${inp.vh}), the keyboard would cover it`);
    }
    await check('numeric', ['#q-body .num-row', '#btn-submit', '#q-body .navcomp summary']);
    // the visualViewport path: the keyboard opens (visual viewport shrinks to 34% of the screen, below the 50% fallback) → the field follows it up
    if (ph.h > ph.w) {
      const vv = await evaluate(`new Promise((res) => {
        const i = document.getElementById('num-input'), kb = Math.round(innerHeight * 0.34);
        const before = Math.round(i.getBoundingClientRect().bottom);
        Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => kb });
        visualViewport.dispatchEvent(new Event('resize'));
        setTimeout(() => { const r = i.getBoundingClientRect(); delete visualViewport.height; res({ kb, before, bottom: Math.round(r.bottom), focused: document.activeElement === i }); }, 250);
      })`);
      report[ph.id + '-numeric-keyboard'] = vv;
      if (!audit && vv.before <= vv.kb - 15) problems.push(`mobile ${ph.label}: keyboard test did not exercise the resize path (field already at ${vv.before}px)`);
      if (!audit && (!vv.focused || vv.bottom > vv.kb - 15)) problems.push(`mobile ${ph.label}: with the keyboard open (visible height ${vv.kb}px) the numeric field ends at ${vv.bottom}px, under the keyboard`);
    }
    await answer(true); await finish();
    await drill('l3-tls-order'); await check('order', ['#q-body .order-item .mv button', '#btn-submit']);
    // touch drag: drag the first item down one row with real touch events
    const drag = await evaluate(`(() => { const li = [...document.querySelectorAll('#q-body .order-item')].find(n => ONA.game.run.sel.indexOf(+n.dataset.k) === 0);
      li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect();
      return { k: +li.dataset.k, x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + r.height / 2), row: Math.round(r.height) }; })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: drag.x, y: drag.y }] });
    for (let s = 1; s <= 8; s++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: drag.x, y: drag.y + Math.round(s * (drag.row + 12) / 8) }] }); await sleep(20); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
    const dragged = await evaluate(`ONA.game.run.sel.indexOf(${drag.k})`);
    report[ph.id + '-order-drag'] = dragged;
    if (!audit && dragged !== 1) problems.push(`mobile ${ph.label}: touch drag on a sequence item did not move it (position ${dragged})`);
    const up = await evaluate(`(() => { const k = ${drag.k}; const b = document.querySelector('#q-body .order-item[data-k="' + k + '"] .mv-up'); b.click(); return ONA.game.run.sel.indexOf(k); })()`);
    if (!audit && up !== 0) problems.push(`mobile ${ph.label}: the sequence "move up" button did not move the item`);
    await answer(true); await finish();
    const dg = await evaluate(`(() => { const q = ONA.QUESTIONS.find(q => q.type === 'diagram'); return q && q.id; })()`);
    await drill(dg); await check('diagram', ['#btn-submit']);
    const nodes = await evaluate(`(() => [...document.querySelectorAll('#q-body .node[data-node]')].map(n => { const r = n.querySelector('.disc, circle').getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }))()`);
    report[ph.id + '-diagram-nodes'] = nodes;
    if (!audit && Math.min(...nodes) < 32) problems.push(`mobile ${ph.label}: diagram nodes too small to tap (${nodes.join(',')} px)`);
    await answer(true); await finish();
    // multipart scenario (boss)
    if (firstOf.multipart) { await drill(firstOf.multipart); await check('scenario', ['#btn-submit']); await evaluate(`ONA.game.run = null; true`); }
    // journey player + library
    await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.journeys.open('dns'); true`); await sleep(200);
    await key('ArrowRight'); await sleep(80); await key('ArrowRight'); await sleep(2200);
    await check('journey', ['#jr-next', '#jr-back', '#jr-close', '#jr-dots .jr-dot']);
    const st = await evaluate(`(() => { const s = document.getElementById('jr-stage').getBoundingClientRect(); return { w: Math.round(s.width), h: Math.round(s.height) }; })()`);
    report[ph.id + '-journey-stage'] = st;
    if (!audit && st.w < Math.min(ph.w, ph.h) * 0.85 && ph.h > ph.w) problems.push(`mobile ${ph.label}: journey stage too narrow (${st.w}px)`);
    await key('Escape'); await sleep(300);
    await evaluate(`ONA.game.show('journeys'); true`); await sleep(900);
    await check('journeys', ['#screen-journeys .jl-card .btn']);
    await evaluate(`ONA.game.show('bay'); true`); await sleep(900);
    await check('bay', ['#screen-bay .btn']);
    await evaluate(`ONA.game.show('log'); true`); await sleep(1200);
    await check('log', ['#screen-log .log-actions .btn']);
    await evaluate(`document.getElementById('screen-log').scrollTop = 900; true`); await sleep(300);
    await check('log', [], { tag: 'log-lower' });
    await evaluate(`document.querySelector('#topbar .settings-btn').click(); true`); await waitFor('ONA.game.modalOpen'); await sleep(300);
    await check('settings', ['#modal .set-row', '#modal [data-close]']);
    await evaluate(`ONA.game.closeModal(); ONA.game.show('map'); true`); await sleep(300);
    // keyboard hints are hidden on touch devices
    const hints = await evaluate(`(() => [...document.querySelectorAll('.title-hint, .map-legend, #btn-launch kbd, #topbar kbd')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length)()`);
    if (!audit && hints) problems.push(`mobile ${ph.label}: ${hints} keyboard hints still visible on a touch device`);
  }
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
  return report;
}
