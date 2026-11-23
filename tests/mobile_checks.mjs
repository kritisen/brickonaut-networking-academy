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

// Phone audio. Everything below is driven by taps, except one explicitly labelled hardware-keyboard N check.
//  - the iOS playback session type is set before the AudioContext is constructed (constructor spy + audioSession stub)
//  - the first tap gets a running context with music; the unlock listeners remove themselves; "Music on" once
//  - a stuck context shows the 44 px "Tap for sound" chip (no "on" claim) and tapping it fixes it
//  - mute (tap) and music off (Settings toggle, tap) never show the chip; turning them back on resumes
//  - hidden → visible with a resume() that never settles re-arms the gesture unlock synchronously
//  - an 'interrupted' state (stubbed) re-arms, asks to resume and shows the chip; leaving it disarms and hides it
//  - pageshow (bfcache): handler-level check only — a dispatched event, not a real back/forward restore
//  - old-iOS fallback (forced): the silent <audio> loop exists only while sound is wanted and the page is visible,
//    is removed on hidden / mute / music+SFX off, recovers from a refused play() and from an OS pause
//  - stale "Sound on" / "Music on" checks stay silent after a mute / music-off that came first
// Headless Chromium can't reproduce iOS Safari's silent switch, real interruptions or its autoplay refusals.
export async function mobileAudioPass(h) {
  const { send, evaluate, sleep, waitFor, problems, key } = h;
  const fail = (m) => problems.push('mobile audio: ' + m);
  const until = async (expr, ms = 2000) => { try { await waitFor(expr, ms); return true; } catch { return false; } };
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await evaluate(`ONA.store.setting('muted', false); ONA.store.setting('music', true); ONA.store.setting('sfx', true); true`);
  const tap = async (sel) => {
    const c = await evaluate(`(() => { const n = document.querySelector('${sel}'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!c) { fail('nothing to tap at ' + sel); return; }
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(120);
  };
  const watchToasts = `window.__toastLog = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.classList && n.classList.contains('toast')) window.__toastLog.push(n.textContent); }))).observe(document.getElementById('toasts'), { childList: true }); true`;

  // ---- 1. session type before construction: stub navigator.audioSession + spy the AudioContext constructor
  const spy = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const sess = { type: 'auto' }; Object.defineProperty(Navigator.prototype, 'audioSession', { configurable: true, get: () => sess });
    window.__sess = sess; window.__ac = [];
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(o) { window.__ac.push({ ev: 'construct', type: sess.type }); super(o); }
      resume() { window.__ac.push({ ev: 'resume', type: sess.type }); return super.resume(); }
    };
  })()` });
  await send('Page.reload'); await waitFor(`!!(window.ONA && ONA.game && ONA.game.screen === 'title')`); await sleep(400);
  const atLoad = await evaluate(`({ type: window.__sess.type, ctx: !!ONA.audio.ctx })`);
  if (atLoad.type !== 'playback' || atLoad.ctx) fail('audioSession.type should be "playback" at load, before any context: ' + JSON.stringify(atLoad));
  await evaluate(`window.__sess.type = 'auto'; true`);            // the defensive path: something reset it before the first tap
  await tap('#btn-begin');
  await until(`ONA.audio.ctx && ONA.audio.ctx.state === 'running'`);
  const log = await evaluate(`window.__ac.slice()`);
  if (!log.length || log[0].ev !== 'construct' || log.some((e) => e.type !== 'playback')) fail('audioSession.type must be "playback" before the AudioContext is constructed or resumed: ' + JSON.stringify(log));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: spy.identifier });

  // ---- 2. plain page from here on
  await send('Page.reload'); await waitFor(`!!(window.ONA && ONA.game && ONA.game.screen === 'title')`); await sleep(500);
  await evaluate(watchToasts);
  const ST = `(() => { const a = ONA.audio, c = document.getElementById('sound-chip'), r = c.getBoundingClientRect();
    return { ctx: a.ctx ? a.ctx.state : null, playing: ONA.music.playing(), armed: a._armed(), chip: !c.hidden, w: Math.round(r.width), h: Math.round(r.height),
      onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, muted: ONA.store.state.settings.muted, music: ONA.store.state.settings.music,
      sfx: ONA.store.state.settings.sfx, toasts: window.__toastLog.slice(), loop: a._loop(), pendingToast: ONA.game._soundToasts().pending }; })()`;
  const stuck = async () => { await evaluate(`ONA.audio.ctx.suspend().then(() => true)`); await sleep(1400); };
  const pre = await evaluate(ST);
  if (pre.ctx) fail('AudioContext exists before the first tap: ' + pre.ctx);
  await tap('#btn-begin');
  const ran = await until(`ONA.audio.ctx && ONA.audio.ctx.state === 'running' && ONA.music.playing()`);
  await sleep(1300);
  const s1 = await evaluate(ST);
  if (!ran) fail('first tap did not get a running context with music: ' + JSON.stringify(s1));
  if (s1.loop) fail('no silent <audio> loop should exist in a browser that does not need it: ' + JSON.stringify(s1.loop));
  if (s1.armed || s1.chip) fail('after a successful first tap the unlock listeners should be gone and no chip shown: ' + JSON.stringify(s1));
  if (s1.toasts.filter((t) => /^Music on/.test(t)).length !== 1) fail('"Music on" should show exactly once after the first tap: ' + JSON.stringify(s1.toasts));

  // ---- 3. stuck context → chip → tap it
  let n0 = s1.toasts.length;
  await stuck();
  const s2 = await evaluate(ST);
  if (!s2.chip || s2.w < 44 || s2.h < 44 || !s2.onScreen || !s2.armed) fail('a stuck context should re-arm the unlock and show a 44 px "Tap for sound" chip on screen: ' + JSON.stringify(s2));
  if (s2.toasts.slice(n0).some((t) => /Music on|Sound on/.test(t))) fail('claimed sound is on while the context is suspended: ' + JSON.stringify(s2.toasts));
  await tap('#sound-chip');
  if (!(await until(`ONA.audio.ctx.state === 'running' && document.getElementById('sound-chip').hidden && !ONA.audio._armed()`)))
    fail('tapping "Tap for sound" should get the context running and hide the chip: ' + JSON.stringify(await evaluate(ST)));

  // ---- 4. mute by tap: no chip while muted; unmute by tap resumes and says "Sound on"
  await tap('#topbar .mute-btn');
  await stuck();
  const s3 = await evaluate(ST);
  if (!s3.muted || s3.chip) fail('muted: no chip even with a suspended context: ' + JSON.stringify(s3));
  await tap('#topbar .mute-btn');
  const unmuted = await until(`!ONA.store.state.settings.muted && ONA.audio.ctx.state === 'running' && ONA.music.playing()`);
  await sleep(300);
  const s4 = await evaluate(ST);
  if (!unmuted || s4.chip || s4.toasts[s4.toasts.length - 1] !== 'Sound on') fail('unmute by tap should resume and toast "Sound on": ' + JSON.stringify(s4));

  // ---- 5. music off / on with taps on the Settings toggle
  await tap('#topbar .settings-btn'); await until('ONA.game.modalOpen');
  await tap('#set-music');
  await stuck();
  const s5 = await evaluate(ST);
  if (s5.music || s5.chip || s5.playing) fail('music off (Settings tap): no music and no chip even when stuck: ' + JSON.stringify(s5));
  await tap('#set-music');
  if (!(await until(`ONA.store.state.settings.music && ONA.audio.ctx.state === 'running' && ONA.music.playing() && document.getElementById('sound-chip').hidden`)))
    fail('music back on (Settings tap) should resume: ' + JSON.stringify(await evaluate(ST)));
  await tap('#modal [data-close]'); await sleep(300);
  // hardware-keyboard N on a phone (not touch): off, then on again with "Music on"
  await key('n'); await sleep(200);
  await key('n');
  await until(`ONA.store.state.settings.music && ONA.audio.ctx.state === 'running' && ONA.music.playing()`); await sleep(300);
  const s6 = await evaluate(ST);
  if (!s6.music || s6.toasts.slice(-2).join(' | ') !== 'Music off · N to turn back on | Music on') fail('keyboard N off/on: ' + JSON.stringify(s6.toasts.slice(-3)));

  // ---- 6. hidden → visible while resume() never settles: the gesture unlock re-arms synchronously
  const vis = await evaluate(`(async () => {
    const a = ONA.audio, c = a.ctx, wasArmed = a._armed();
    a.setHidden(true); await c.suspend();
    const armedWhileHidden = a._armed();
    c.resume = () => new Promise(() => {});                // Safari: pending until a gesture
    a.setHidden(false);
    const armedNow = a._armed();                          // same tick, before any promise could settle
    delete c.resume; await c.resume(); await new Promise((r) => setTimeout(r, 100));
    return { wasArmed, armedWhileHidden, armedNow, after: a._armed(), state: c.state };
  })()`);
  if (vis.wasArmed || vis.armedWhileHidden || !vis.armedNow || vis.after || vis.state !== 'running') fail('visible again with a pending resume must re-arm synchronously, then disarm once running: ' + JSON.stringify(vis));

  // ---- 7. 'interrupted' (stubbed state): re-arm, ask to resume, chip; back to running: disarm, chip gone
  const int1 = await evaluate(`(() => {
    const a = ONA.audio, c = a.ctx; window.__fake = 'interrupted'; window.__resumes = 0;
    Object.defineProperty(c, 'state', { configurable: true, get: () => window.__fake });
    c.resume = function () { window.__resumes++; return Promise.resolve(); };
    c.dispatchEvent(new Event('statechange'));
    return { armed: a._armed(), resumes: window.__resumes };
  })()`);
  await sleep(1300);
  const int2 = await evaluate(`(() => { const a = ONA.audio, c = a.ctx; const chip = !document.getElementById('sound-chip').hidden;
    delete c.state; delete c.resume; c.dispatchEvent(new Event('statechange'));
    return { chip, armedAfter: a._armed(), state: c.state }; })()`);
  await sleep(200);
  const chipAfter = await evaluate(`!document.getElementById('sound-chip').hidden`);
  if (!int1.armed || int1.resumes < 1 || !int2.chip || int2.armedAfter || chipAfter || int2.state !== 'running') fail('interrupted state should re-arm, resume and show the chip, then recover: ' + JSON.stringify({ int1, int2, chipAfter }));

  // ---- 8. pageshow from the bfcache (handler-level: a dispatched event, not a real restore)
  await evaluate(`ONA.audio.ctx.suspend().then(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); return true; })`);
  if (!(await until(`ONA.audio.ctx.state === 'running'`))) fail('pageshow handler should resume the context: ' + JSON.stringify(await evaluate(ST)));

  // ---- 9. old-iOS silent-loop fallback (forced in Chromium)
  const LOOPING = `(() => { const l = ONA.audio._loop(); return !!l && !l.paused && l.src && l.loop; })()`;
  await evaluate(`ONA.audio._forceSilentLoop = true; true`);
  await tap('#topbar .mute-btn');
  const m1 = (await evaluate(ST)).loop;
  await tap('#topbar .mute-btn');
  const looping = await until(LOOPING);
  if (m1 || !looping) fail('silent loop: none while muted, playing once unmuted: ' + JSON.stringify({ m1, looping }));
  // hidden → removed; visible → armed; next tap → back
  const hid = await evaluate(`(() => { const a = ONA.audio; a.setHidden(true); const gone = !a._loop(); a.setHidden(false); return { gone, armed: a._armed() }; })()`);
  await tap('#topbar .tb-stars');
  if (!hid.gone || !hid.armed || !(await until(LOOPING + ` && !ONA.audio._armed()`))) fail('silent loop: removed while hidden, re-armed when visible, back on the next tap: ' + JSON.stringify(hid));
  // music + SFX both off → removed; SFX back on → back (inside that tap)
  await tap('#topbar .settings-btn'); await until('ONA.game.modalOpen');
  await tap('#set-music'); await tap('#set-sfx'); await sleep(200);
  const off = await evaluate(ST);
  await tap('#set-sfx');
  const back = await until(LOOPING);
  await tap('#set-music'); await sleep(200);
  await tap('#modal [data-close]'); await sleep(300);
  if (off.loop || off.music || off.sfx || !back) fail('silent loop: removed with music and SFX both off, back when SFX come on: ' + JSON.stringify({ loop: off.loop, back }));
  // play() refused → stays armed + chip; tap the chip once play() works again → playing, chip gone
  await tap('#topbar .mute-btn');
  await evaluate(`HTMLMediaElement.prototype.__play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('refused', 'NotAllowedError')); }; true`);
  await tap('#topbar .mute-btn'); await sleep(1400);
  const ref = await evaluate(ST);
  await evaluate(`HTMLMediaElement.prototype.play = HTMLMediaElement.prototype.__play; delete HTMLMediaElement.prototype.__play; true`);
  await tap('#sound-chip');
  const recovered = await until(LOOPING + ` && document.getElementById('sound-chip').hidden && !ONA.audio._armed()`);
  if (!ref.loop || !ref.loop.paused || !ref.armed || !ref.chip || ref.toasts.slice(-1)[0] === 'Sound on' || !recovered) fail('silent loop: a refused play() keeps the unlock armed with the chip (and no "Sound on"), and the next tap recovers: ' + JSON.stringify({ loop: ref.loop, armed: ref.armed, chip: ref.chip, last: ref.toasts.slice(-1), recovered }));
  // paused by the OS → re-armed → the next tap replays it
  const paused = await evaluate(`(async () => { ONA.audio._loopEl().pause(); await new Promise((r) => setTimeout(r, 50)); return ONA.audio._armed(); })()`);
  await tap('#topbar .tb-stars');
  if (!paused || !(await until(LOOPING + ` && !ONA.audio._armed()`))) fail('silent loop: an OS pause re-arms and the next tap replays it: ' + JSON.stringify({ paused }));
  await evaluate(`ONA.audio._forceSilentLoop = false; true`);
  await tap('#topbar .mute-btn'); await tap('#topbar .mute-btn'); await sleep(300);

  // ---- 10. stale toast checks: unmute then mute before sound is live → no "Sound on" / blocked toast afterwards
  const PENDING = `(async () => { const c = ONA.audio.ctx; await c.suspend(); c.resume = () => new Promise(() => {}); return true; })()`;
  const RELEASE = `(async () => { const c = ONA.audio.ctx; delete c.resume; await c.resume(); return c.state; })()`;
  await evaluate(PENDING);
  await tap('#topbar .mute-btn');                       // mute
  n0 = (await evaluate(ST)).toasts.length;
  await tap('#topbar .mute-btn');                       // unmute: a "Sound on" check starts polling
  await tap('#topbar .mute-btn');                       // mute again before sound is live
  await evaluate(RELEASE); await sleep(1000);
  const st1 = await evaluate(ST);
  if (st1.toasts.slice(n0).some((t) => /Sound on|didn't start|Music on/.test(t))) fail('a stale unmute toast fired after the mute that followed it: ' + JSON.stringify(st1.toasts.slice(n0)));
  await tap('#topbar .mute-btn'); await until(`ONA.audio.ctx.state === 'running'`); await sleep(300);
  // same for music: N on then N off before sound is live (hardware keyboard) → no "Music on" afterwards
  await evaluate(PENDING);
  await key('n'); await sleep(80);                      // off
  n0 = (await evaluate(ST)).toasts.length;
  await key('n'); await sleep(60); await key('n');       // on (pending) → off again
  await evaluate(RELEASE); await sleep(1000);
  const st2 = await evaluate(ST);
  if (st2.toasts.slice(n0).some((t) => /Music on|didn't start/.test(t)) || st2.pendingToast) fail('a stale "Music on" fired after music was switched off again: ' + JSON.stringify(st2.toasts.slice(n0)));
  await key('n'); await until(`ONA.store.state.settings.music && ONA.audio.ctx.state === 'running' && ONA.music.playing()`); await sleep(300);

  const end = await evaluate(ST);
  if (end.muted || !end.music || end.loop || end.ctx !== 'running' || end.chip) fail('should end unmuted with music, running, no silent loop, no chip: ' + JSON.stringify(end));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
  return { sessionLog: log.map((e) => e.ev + ':' + e.type), chip: { w: s2.w, h: s2.h }, visibility: vis, interrupted: { ...int1, chip: int2.chip } };
}
