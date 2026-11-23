/* Holo-sim JOURNEYS engine: animated, clickable walkthroughs (data in data/journeys.js).
 *
 *   ONA.journeys.open(id, { src: 'library' | 'feedback' | 'hint', qid })   opens the holo-sim overlay
 *   ONA.journeys.button(q, where)        "Learn: <journey>" button HTML for a mapped question ('' otherwise)
 *   ONA.journeys.decorateQuestion(q, p, card)  adds "Watch the journey first" to order questions (game.js hook)
 *   ONA.journeys.logCard()               Captain's Log card HTML (game.js hook)
 *   ONA.journeys.renderLibrary()         fills #screen-journeys (runs when that screen is shown)
 *   ONA.journeys.scene(j, i)             scene SVG for step i (pure; the validator renders every step)
 *
 * The overlay is its own a11y layer: #app/#topbar go inert, Tab is trapped, Esc closes and focus returns.
 * Keys while open: ←/→ step, Space or P autoplay, R replay, 1–4 answer the check, Esc close. The game's key
 * handler never sees them (capture phase), and the boss clock is frozen (ONA.game.journeyOpen).
 * Reduced motion: no travelling packets or pulses, just the state of each step.
 */
(function (root) {
  'use strict';
  var ONA = (root.ONA = root.ONA || {});
  var C = { cyan: '#4fd1ff', mint: '#7cf7c3', gold: '#f6c453', rose: '#ff4d6d', violet: '#b794f6', orange: '#ff8a5b', ice: '#c7d2fe' };
  var LEG = 1.5;          // seconds per travel leg
  var UID = 0;

  function E(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function RM() { try { return !!(ONA.util && ONA.util.reducedMotion && ONA.util.reducedMotion()); } catch (e) { return false; } }
  function icon(kind) { return ONA.art && ONA.art.icon ? ONA.art.icon(kind) : ''; }
  function kc(kind) { return ONA.art && ONA.art.kindColor ? ONA.art.kindColor(kind) : C.cyan; }
  function list() { return ONA.JOURNEYS || []; }
  function get(id) { return list().filter(function (j) { return j.id === id; })[0]; }
  function tx(x, y, s, c, a) { return '<text x="' + r1(x) + '" y="' + r1(y) + '" class="' + c + '"' + (a ? ' text-anchor="' + a + '"' : '') + '>' + E(s) + '</text>'; }

  // ------------------------------------------------------------------ space bodies (centred on 0,0)
  function bodyArt(n) {
    var ico = '<g class="jb-ico" transform="translate(-12 -12)">' + icon(n.kind) + '</g>';
    switch (n.body) {
      case 'ship': {
        var ship = ONA.art && ONA.art.ship ? ONA.art.ship().replace(/^<svg[^>]*>|<\/svg>$/g, '') : '';
        return '<g class="jb-ship"><ellipse class="jb-thrust" cx="-30" cy="0" rx="14" ry="5"/><svg x="-42" y="-21" width="84" height="42" viewBox="-70 -34 140 68" overflow="visible">' + ship + '</svg></g>';
      }
      case 'mother':
        return '<g class="jb-mother"><ellipse class="jb-orbit" rx="48" ry="15"/><circle class="jb-hull" r="30"/><circle class="jb-core" r="22"/>' + ico +
          '<circle class="jb-beacon" cx="0" cy="-30" r="3"/><circle class="jb-beacon b2" cx="30" cy="0" r="2.4"/></g>';
      case 'sat':
        return '<g class="jb-sat"><rect class="jb-wing" x="-46" y="-7" width="26" height="14" rx="2"/><rect class="jb-wing" x="20" y="-7" width="26" height="14" rx="2"/>' +
          '<path class="jb-wgrid" d="M-37-7v14M-28-7v14M29-7v14M38-7v14"/><line class="jb-ant" x1="0" y1="-19" x2="0" y2="-30"/><circle class="jb-beacon" cx="0" cy="-31" r="2.6"/>' +
          '<rect class="jb-hull" x="-19" y="-19" width="38" height="38" rx="9"/><g transform="scale(.82)">' + ico + '</g></g>';
      case 'gate':
        return '<g class="jb-gate"><path class="jb-hull" d="M0-28L24-14V14L0 28L-24 14V-14Z"/><path class="jb-core" d="M0-20L17-10V10L0 20L-17 10V-10Z"/>' + ico + '</g>';
      case 'planet':
        return '<g class="jb-planet"><circle class="jb-sphere" r="24"/><ellipse class="jb-pring" rx="38" ry="9" transform="rotate(-18)"/>' + ico + '</g>';
      default: // station
        return '<g class="jb-station"><rect class="jb-wing" x="-52" y="-6" width="20" height="12" rx="2"/><rect class="jb-wing" x="32" y="-6" width="20" height="12" rx="2"/>' +
          '<path class="jb-strut" d="M-32 0h6M26 0h6"/><circle class="jb-hull" r="26"/><circle class="jb-core" r="19"/>' + ico + '<circle class="jb-beacon" cx="0" cy="-26" r="2.6"/></g>';
    }
  }
  function zoneSvg(z, u) {
    var c = z.color || C.cyan;
    if (z.shape === 'nebula') {
      var cx = z.x + z.w / 2, cy = z.y + z.h / 2;
      var stars = '';
      for (var i = 0; i < 9; i++) stars += '<circle cx="' + r1(z.x + ((i * 53) % z.w)) + '" cy="' + r1(z.y + ((i * 97) % z.h)) + '" r="' + (i % 3 ? 0.8 : 1.4) + '" class="jz-star"/>';
      return '<g class="jz neb"><ellipse cx="' + cx + '" cy="' + cy + '" rx="' + z.w / 2 + '" ry="' + z.h / 2 + '" fill="url(#' + u + 'neb)"/>' + stars + tx(cx, z.y + 16, z.label || '', 'jz-l neb', 'middle') + '</g>';
    }
    var ring = z.shape === 'ring';
    return '<g class="jz ' + (ring ? 'ring' : 'box') + '" style="--c:' + c + '"><rect class="jz-r" x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" rx="' + (ring ? 22 : 12) + '"/>' +
      (ring ? '<rect class="jz-r2" x="' + (z.x + 5) + '" y="' + (z.y + 5) + '" width="' + (z.w - 10) + '" height="' + (z.h - 10) + '" rx="18"/>' +
        [[z.x + 12, z.y + z.h - 12], [z.x + z.w - 12, z.y + 12], [z.x + z.w - 12, z.y + z.h - 12]].map(function (p, k) { return '<circle class="jz-dock" style="animation-delay:' + (k * 0.6) + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="2.4"/>'; }).join('') : '') +
      tx(z.x + 16, z.y + 20, z.label || '', 'jz-l') + '</g>';
  }
  function pill(x, y, s, tone) {
    var w = String(s).length * 6.7 + 18;
    return '<g class="jp ' + (tone || '') + '" transform="translate(' + r1(x) + ' ' + r1(y) + ')"><rect x="' + r1(-w / 2) + '" y="-11" width="' + r1(w) + '" height="22" rx="11"/>' + tx(0, 4, s, 'jp-t', 'middle') + '</g>';
  }
  function xmark(x, y) { return '<g class="jx" transform="translate(' + r1(x) + ' ' + r1(y) + ')"><circle r="11"/><path d="M-5-5L5 5M5-5L-5 5"/></g>'; }

  // ------------------------------------------------------------------ travel path
  function pointOf(j, p) { if (Array.isArray(p)) return p; var n = nodeOf(j, p); return n ? [n.x, n.y] : null; }
  function nodeOf(j, id) { return (j.nodes || []).filter(function (n) { return n.id === id; })[0]; }
  function trim(a, b, d) { var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1; return [a[0] + dx / L * d, a[1] + dy / L * d]; }
  function travelPts(j, s) {
    if (!s.from || !s.to) return null;
    var pts = [pointOf(j, s.from)].concat((s.via || []).map(function (v) { return pointOf(j, v); }), [pointOf(j, s.to)]);
    var out = pts.slice();
    out[0] = trim(pts[0], pts[1], 36);
    var n = out.length - 1;
    out[n] = s.blocked ? trim(pts[n - 1], pts[n], Math.max(20, 0.68 * Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]))) : trim(pts[n], pts[n - 1], 40);
    return out;
  }
  function dOf(pts) { return 'M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join(' L'); }

  // ------------------------------------------------------------------ scene
  function involved(s) { var a = []; ['from', 'to'].forEach(function (k) { if (s[k]) a.push(s[k]); }); (s.via || []).forEach(function (v) { if (typeof v === 'string') a.push(v); }); return a.concat(s.hl || []); }
  function scene(j, i, opts) {
    opts = opts || {};
    var s = j.steps[i], u = 'jr' + (++UID), rm = opts.static || RM();
    if (s.figure && ONA.explainers) return '<div class="jr-figure">' + ONA.explainers.render(s.figure.fig, s.figure.params) + '</div>';
    var W = j.w || 720, H = j.h || 400, now = involved(s), seen = {};
    for (var k = 0; k <= i; k++) involved(j.steps[k]).forEach(function (id) { seen[id] = 1; });
    var out = '<svg class="jr-scene" viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="' + E(j.title + ', step ' + (i + 1) + ': ' + s.title) + '">' +
      '<defs><pattern id="' + u + 'grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="jr-gridline"/></pattern>' +
      '<radialGradient id="' + u + 'neb"><stop offset="0" stop-color="#b794f6" stop-opacity=".34"/><stop offset=".55" stop-color="#4fd1ff" stop-opacity=".1"/><stop offset="1" stop-color="#4fd1ff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + u + 'pkt"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="' + (s.blocked || s.tone === 'bad' ? C.rose : C.gold) + '"/><stop offset="1" stop-color="' + (s.blocked || s.tone === 'bad' ? C.rose : C.gold) + '" stop-opacity="0"/></radialGradient>' +
      '<marker id="' + u + 'arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" class="jr-arrowhead"/></marker></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#' + u + 'grid)" class="jr-grid" aria-hidden="true"/>';
    out += '<g aria-hidden="true">' + (j.zones || []).map(function (z) { return zoneSvg(z, u); }).join('') + '</g>';
    // faint guide wires between every pair this journey ever uses
    var pairs = {};
    j.steps.forEach(function (st) {
      if (!st.from || !st.to) return;
      var seq = [st.from].concat((st.via || []).filter(function (v) { return typeof v === 'string'; }), [st.to]);
      for (var q = 0; q < seq.length - 1; q++) pairs[[seq[q], seq[q + 1]].sort().join('|')] = [seq[q], seq[q + 1]];
    });
    out += '<g class="jr-guides" aria-hidden="true">' + Object.keys(pairs).map(function (key) {
      var a = pointOf(j, pairs[key][0]), b = pointOf(j, pairs[key][1]);
      return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>';
    }).join('') + '</g>';
    // travel
    var pts = travelPts(j, s), dur = 0;
    if (pts) {
      var d = dOf(pts), bad = s.blocked || s.tone === 'bad', legs = s.back ? 2 : 1;
      dur = LEG * legs;
      out += '<g class="jr-travel' + (bad ? ' bad' : '') + (rm ? ' static' : '') + '" aria-hidden="true">' +
        '<path class="jr-trail" d="' + d + '" pathLength="1" style="animation-duration:' + LEG + 's" marker-end="url(#' + u + 'arr)"' + (s.back ? ' marker-start="url(#' + u + 'arr)"' : '') + '/>' +
        '<path class="jr-trail-flow" d="' + d + '"/>';
      if (s.back) out += '<path class="jr-trail back" d="' + dOf(pts.slice().reverse()) + '" pathLength="1" style="animation-duration:' + LEG + 's;animation-delay:' + LEG + 's"/>';
      var end = s.back ? pts[0] : pts[pts.length - 1];
      var full = s.back ? dOf(pts.concat(pts.slice(0, -1).reverse())) : d;
      var label = s.packet && s.packet.title ? s.packet.title : '';
      var lw = label.length * 6.4 + 16;
      var pkt = '<circle r="15" fill="url(#' + u + 'pkt)"/><circle r="4.6" class="jr-pkt-core"/>' +
        (label ? '<g class="jr-pkt-label" style="animation-delay:' + dur + 's" transform="translate(0 -22)"><rect x="' + r1(-lw / 2) + '" y="-10" width="' + r1(lw) + '" height="19" rx="9.5" class="jr-pkt-tag"/>' + tx(0, 4, label, 'jr-pkt-t', 'middle') + '</g>' : '');
      if (rm) out += '<g class="jr-pkt" transform="translate(' + r1(end[0]) + ' ' + r1(end[1]) + ')">' + pkt + '</g>';
      else out += '<g class="jr-pkt">' + pkt + '<animateMotion dur="' + dur + 's" fill="freeze" calcMode="linear" path="' + full + '"/></g>';
      if (s.blocked) { var bp = pts[pts.length - 1]; out += '<g class="jr-block" style="animation-delay:' + LEG + 's">' + xmark(bp[0], bp[1]) + '</g>'; }
      out += '</g>';
    }
    // nodes
    out += (j.nodes || []).map(function (n) {
      var st = now.indexOf(n.id) >= 0 ? 'active' : seen[n.id] ? 'seen' : 'idle';
      if (s.blocked && n.id === s.to) st += ' denied';
      var c = n.color || kc(n.kind);
      return '<g class="jn ' + st + (n.id === opts.sel ? ' sel' : '') + '" data-node="' + E(n.id) + '" role="button" tabindex="0" aria-label="' + E(n.label + (n.sub ? ' (' + n.sub + ')' : '') + '. ' + (n.info || '')) + '" style="--c:' + c + '" transform="translate(' + n.x + ' ' + n.y + ')">' +
        '<circle class="jn-halo" r="40"/><circle class="jn-hit" r="44"/>' + bodyArt(n) +
        tx(0, 46, n.label, 'jn-l', 'middle') + (n.sub ? tx(0, 60, n.sub, 'jn-s', 'middle') : '') + '<circle class="jn-sel" r="44"/></g>';
    }).join('');
    // arrival ping + badges
    if (pts && !s.blocked) {
      var dest = pointOf(j, s.back ? s.from : s.to);
      out += '<circle class="jr-ping" cx="' + dest[0] + '" cy="' + dest[1] + '" r="30" style="animation-delay:' + dur + 's" aria-hidden="true"/>';
    }
    out += '<g aria-hidden="true">' + (s.badges || []).map(function (b, k) {
      var n = nodeOf(j, b.node); if (!n) return '';
      var y = n.y < 110 ? n.y + 84 : n.y - 50;
      return '<g class="jr-badge" style="animation-delay:' + (dur ? dur : 0.2 + k * 0.12).toFixed(2) + 's">' + pill(n.x, y, b.text, b.tone) + '</g>';
    }).join('') + '</g>';
    return out + '</svg>';
  }

  // ------------------------------------------------------------------ overlay state + DOM
  var S = { open: false, j: null, i: 0, auto: false, timer: null, sel: null, check: null, src: null, prev: null, gen: 0, pend: [] };
  var $ = function (id) { return document.getElementById(id); };

  // Deferred UI work (the open-class rAF and the focus moves). Every id is tracked so close() can cancel it, and every
  // callback re-checks that the overlay is still open and is the same open instance (S.gen), so a fast Esc can't
  // re-add .open to a hidden overlay or steal focus back from the opener.
  function live(gen) { return S.open && S.gen === gen; }
  function later(fn, ms) {
    var gen = S.gen, rec = { t: 'to' };
    rec.id = setTimeout(function () { drop(rec); if (live(gen)) fn(); }, ms);
    S.pend.push(rec);
  }
  function frame(fn) {
    var gen = S.gen, rec = { t: 'raf' };
    rec.id = requestAnimationFrame(function () { drop(rec); if (live(gen)) fn(); });
    S.pend.push(rec);
  }
  function drop(rec) { var k = S.pend.indexOf(rec); if (k >= 0) S.pend.splice(k, 1); }
  function cancelPending() {
    S.pend.forEach(function (r) { if (r.t === 'raf') cancelAnimationFrame(r.id); else clearTimeout(r.id); });
    S.pend = [];
  }
  function visible(n) { return !!(n && document.contains(n) && n.offsetParent !== null && !n.disabled); }
  function focusIfVisible(n) { if (visible(n)) { try { n.focus({ preventScroll: true }); } catch (e) { /* gone */ } } }

  function ensureDom() {
    if ($('journey')) return;
    var el = document.createElement('div');
    el.id = 'journey'; el.className = 'jr'; el.hidden = true;
    el.innerHTML = '<div class="jr-scrim" data-jr-close></div>' +
      '<section class="jr-box glass corners" role="dialog" aria-modal="true" aria-labelledby="jr-title" aria-describedby="jr-narr">' +
      '<header class="jr-head"><div><div class="eyebrow" id="jr-eyebrow">Holo-sim journey</div><h2 class="jr-title" id="jr-title"></h2></div>' +
      '<button class="icon-btn jr-close" id="jr-close" aria-label="Close journey (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>' +
      '<div class="jr-main"><div class="jr-stage-wrap"><div class="jr-stage" id="jr-stage"></div><div class="jr-tip" id="jr-tip" role="status" hidden></div>' +
      '<div class="jr-scan-hint" id="jr-scan-hint">Tap a component to scan it</div></div>' +
      '<aside class="jr-side" id="jr-side"><div class="jr-stepno" id="jr-stepno"></div><h3 class="jr-steptitle" id="jr-steptitle"></h3>' +
      '<div class="jr-say"><div class="jr-portrait" aria-hidden="true">' + (ONA.art && ONA.art.portrait ? ONA.art.portrait('vega') : '') + '</div><p class="jr-narr" id="jr-narr" aria-live="polite"></p></div>' +
      '<div class="jr-packet" id="jr-packet"></div><div class="jr-check" id="jr-check" hidden></div></aside></div>' +
      '<footer class="jr-ctrl"><button class="btn ghost" id="jr-back"><span aria-hidden="true">←</span> Back</button>' +
      '<div class="jr-dots" id="jr-dots" role="group" aria-label="Journey progress"></div>' +
      '<div class="jr-ctrl-r"><button class="btn ghost" id="jr-auto" aria-pressed="false">Autoplay</button><button class="btn ghost" id="jr-replay" aria-label="Replay this step (R)">Replay</button>' +
      '<button class="btn primary" id="jr-next">Next <span aria-hidden="true">→</span></button></div></footer></section>';
    document.body.appendChild(el);
    $('jr-close').addEventListener('click', close);
    el.querySelector('.jr-scrim').addEventListener('click', close);
    $('jr-back').addEventListener('click', back);
    $('jr-next').addEventListener('click', next);
    $('jr-auto').addEventListener('click', toggleAuto);
    $('jr-replay').addEventListener('click', replay);
    $('jr-dots').addEventListener('click', function (e) { var b = e.target.closest('[data-step]'); if (b) { stopAuto(); go(+b.dataset.step); } });
    $('jr-stage').addEventListener('click', function (e) { var n = e.target.closest('.jn'); if (n) scan(n.dataset.node); else hideTip(); });
    $('jr-check').addEventListener('click', function (e) {
      var c = e.target.closest('[data-choice]'); if (c) return answer(+c.dataset.choice);
      if (e.target.closest('[data-retry]')) return renderCheck();
      if (e.target.closest('[data-finish]')) return close();
    });
  }

  function sfx(name) { try { if (ONA.sfx && ONA.sfx[name]) ONA.sfx[name](); } catch (e) { /* audio optional */ } }

  function open(id, o) {
    var j = get(id); if (!j || typeof document === 'undefined') return false;
    o = o || {};
    ensureDom();
    if (S.open) stopAuto();
    cancelPending(); S.gen++;
    S.j = j; S.i = 0; S.sel = null; S.check = null; S.src = o.src || 'library'; S.qid = o.qid || null;
    if (!S.open) S.prev = document.activeElement;
    S.open = true;
    if (ONA.game) { ONA.game.journeyOpen = true; if (ONA.game.onJourney) ONA.game.onJourney(true); }
    ['app', 'topbar'].forEach(function (k) { var n = $(k); if (n) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); } });
    var lv = ONA.util && ONA.util.level ? ONA.util.level(j.level) : null;
    $('jr-eyebrow').textContent = 'Holo-sim journey' + (lv ? ' · ' + lv.name : '');
    $('jr-title').textContent = j.title;
    var el = $('journey'); el.hidden = false; el.setAttribute('aria-hidden', 'false');
    el.classList.toggle('figure-mode', false);
    frame(function () { if (!el.hidden) el.classList.add('open'); });
    if (S.src === 'hint' && ONA.store && ONA.store.journeyHint) ONA.store.journeyHint(id);
    sfx('click');
    renderDots(); go(0);
    later(function () { focusIfVisible($('jr-next')); }, 40);
    return true;
  }
  function close() {
    if (!S.open) return;
    stopAuto();
    cancelPending(); S.gen++;
    S.open = false;
    if (ONA.game) { ONA.game.journeyOpen = false; if (ONA.game.onJourney) ONA.game.onJourney(false); }
    var el = $('journey'); el.classList.remove('open'); el.hidden = true; el.setAttribute('aria-hidden', 'true');
    var layers = ONA.game && ONA.game.layers ? ONA.game.layers.length : 0;
    if (!layers) ['app', 'topbar'].forEach(function (k) { var n = $(k); if (n) { n.removeAttribute('inert'); n.setAttribute('aria-hidden', 'false'); } });
    var p = S.prev; S.prev = null;
    focusIfVisible(p);
    if (document.body.dataset.screen === 'journeys') {
      // The library re-renders (fresh badge state), which replaces the opener button: hand focus to its replacement.
      var lib = $('screen-journeys'), had = !!(p && lib && lib.contains(p)), sel = p && p.dataset && p.dataset.journeyOpen ? p.dataset.journeyOpen : null;
      var idx = had && sel ? Array.prototype.indexOf.call(lib.querySelectorAll('[data-journey-open="' + sel + '"]'), p) : -1;
      renderLibrary();
      if (idx >= 0) focusIfVisible(lib.querySelectorAll('[data-journey-open="' + sel + '"]')[idx]);
    }
  }

  function renderDots() {
    var j = S.j, h = '';
    j.steps.forEach(function (s, k) { h += '<button class="jr-dot" data-step="' + k + '" aria-label="Step ' + (k + 1) + ': ' + E(s.title) + '"><i></i></button>'; });
    h += '<button class="jr-dot check" data-step="' + j.steps.length + '" aria-label="Check yourself"><i></i></button>';
    $('jr-dots').innerHTML = h;
  }
  function syncDots() {
    Array.prototype.forEach.call($('jr-dots').children, function (b, k) {
      b.classList.toggle('cur', k === S.i); b.classList.toggle('done', k < S.i);
      if (k === S.i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }

  function go(i) {
    var j = S.j; if (!j) return;
    S.i = Math.max(0, Math.min(j.steps.length, i)); S.sel = null; hideTip();
    var isCheck = S.i === j.steps.length;
    $('journey').classList.toggle('checking', isCheck);
    $('jr-back').disabled = S.i === 0;
    $('jr-next').innerHTML = isCheck ? 'Done <span aria-hidden="true">✓</span>' : S.i === j.steps.length - 1 ? 'Check yourself <span aria-hidden="true">→</span>' : 'Next <span aria-hidden="true">→</span>';
    $('jr-next').disabled = isCheck && !(S.check && S.check.solved);
    $('jr-replay').disabled = isCheck;
    syncDots();
    if (isCheck) { stopAuto(); renderCheck(); return; }
    var s = j.steps[S.i];
    $('jr-check').hidden = true;
    $('jr-packet').hidden = false;
    $('journey').classList.toggle('figure-mode', !!s.figure);
    $('jr-scan-hint').hidden = !!s.figure;
    $('jr-stepno').textContent = 'Step ' + (S.i + 1) + ' of ' + j.steps.length;
    $('jr-steptitle').textContent = s.title;
    $('jr-narr').textContent = s.say;
    $('jr-packet').innerHTML = s.packet ? '<div class="jr-packet-k">' + (s.figure ? 'Readout' : 'Inside the packet') + ' · <b>' + E(s.packet.title) + '</b></div><dl>' +
      s.packet.fields.map(function (f) { return '<div><dt>' + E(f[0]) + '</dt><dd>' + E(f[1]) + '</dd></div>'; }).join('') + '</dl>' : '';
    drawStage();
    sfx('select');
  }
  function drawStage() { var j = S.j; if (S.i < j.steps.length) $('jr-stage').innerHTML = scene(j, S.i, { sel: S.sel }); }
  function next() {
    var j = S.j; if (!j) return;
    if (S.i === j.steps.length) { if (S.check && S.check.solved) close(); return; }
    go(S.i + 1);
  }
  function back() { if (S.i > 0) { stopAuto(); go(S.i - 1); } }
  function replay() { if (S.i < S.j.steps.length) { drawStage(); sfx('select'); } }

  function toggleAuto() { if (S.auto) stopAuto(); else startAuto(); }
  function startAuto() {
    if (S.i >= S.j.steps.length) return;
    S.auto = true; $('jr-auto').setAttribute('aria-pressed', 'true'); $('jr-auto').textContent = 'Pause';
    var tick = function () {
      if (!S.open || !S.auto) return;
      if (S.i >= S.j.steps.length - 1) { stopAuto(); return; }
      go(S.i + 1); S.timer = setTimeout(tick, dwell());
    };
    S.timer = setTimeout(tick, dwell());
  }
  function dwell() { var s = S.j.steps[S.i]; return Math.max(4200, (s.say || '').length * 42); }
  function stopAuto() { S.auto = false; clearTimeout(S.timer); var b = $('jr-auto'); if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Autoplay'; } }

  // node scanner tooltip
  function scan(id) {
    var j = S.j, n = nodeOf(j, id); if (!n) return;
    S.sel = id;
    Array.prototype.forEach.call(document.querySelectorAll('#jr-stage .jn'), function (g) { g.classList.toggle('sel', g.dataset.node === id); });
    var t = $('jr-tip'), W = j.w || 720, H = j.h || 400;
    t.innerHTML = '<b>' + E(n.label) + '</b>' + (n.sub ? '<span class="jr-tip-sub">' + E(n.sub) + '</span>' : '') + '<p>' + E(n.info || '') + '</p>';
    t.style.left = (n.x / W * 100) + '%';
    t.style.top = (n.y / H * 100) + '%';
    t.classList.toggle('below', n.y < H * 0.45);
    t.classList.toggle('left', n.x > W * 0.62);
    t.classList.toggle('right', n.x < W * 0.38);
    t.hidden = false;
    sfx('select');
  }
  function hideTip() { var t = $('jr-tip'); if (t) t.hidden = true; S.sel = null; Array.prototype.forEach.call(document.querySelectorAll('#jr-stage .jn.sel'), function (g) { g.classList.remove('sel'); }); }

  // check yourself
  function renderCheck() {
    var j = S.j, c = j.check;
    S.check = S.check && S.check.solved ? S.check : { picked: null, wrong: S.check ? S.check.wrong : 0, solved: false };
    $('jr-packet').hidden = true;
    $('jr-scan-hint').hidden = true;
    $('journey').classList.remove('figure-mode');
    $('jr-stepno').textContent = 'Check yourself';
    $('jr-steptitle').textContent = 'One quick question';
    $('jr-narr').textContent = 'Lock it in, Cadet. Pick one answer.';
    $('jr-stage').innerHTML = badgeArt(j, S.check.solved);
    var h = '<p class="jr-q">' + E(c.prompt) + '</p><div class="jr-choices" role="group" aria-label="Answers">' +
      c.choices.map(function (t, k) { return '<button class="choice jr-choice" data-choice="' + k + '"><span class="key">' + (k + 1) + '</span><span class="txt">' + E(t) + '</span></button>'; }).join('') + '</div><div class="jr-result" id="jr-result" aria-live="polite"></div>';
    var el = $('jr-check'); el.innerHTML = h; el.hidden = false;
    if (S.check.solved) showResult(c.answer, true, S.check.reward);
    var chk = S.check;
    later(function () { if (S.check === chk && !chk.solved) focusIfVisible(el.querySelector('.jr-choice')); }, 30);
  }
  function answer(k) {
    var j = S.j, c = j.check; if (!S.check || S.check.solved) return;
    var ok = k === c.answer;
    if (!ok) { S.check.wrong++; sfx('wrong'); }
    else {
      S.check.solved = true; sfx('correct');
      S.check.reward = ONA.store && ONA.store.completeJourney ? ONA.store.completeJourney(j.id, S.check.wrong === 0) : { first: false, xp: 0 };
      var xpEl = document.getElementById('tb-xp'); if (xpEl && ONA.store) xpEl.textContent = ONA.store.state.xp.toLocaleString() + ' XP';
      $('jr-stage').innerHTML = badgeArt(j, true);
    }
    showResult(k, ok, S.check.reward);
  }
  function showResult(k, ok, reward) {
    var c = S.j.check;
    Array.prototype.forEach.call(document.querySelectorAll('#jr-check .jr-choice'), function (b, i) {
      b.disabled = ok; b.classList.toggle('correct', ok && i === c.answer); b.classList.toggle('wrong', !ok && i === k);
    });
    var r = $('jr-result');
    r.className = 'jr-result ' + (ok ? 'good' : 'bad');
    r.innerHTML = ok
      ? '<div class="jr-verdict">Journey complete</div><p>' + E(c.explain) + '</p>' +
        '<div class="jr-reward">' + (reward && reward.first ? '<span class="jr-xp">+' + reward.xp + ' XP</span> Holo-sim badge earned' : 'Badge already earned · replay logged') + '</div>' +
        '<button class="btn primary" data-finish>Finish <kbd>Enter</kbd></button>'
      : '<div class="jr-verdict">Not quite</div><p>Look again at the steps, or try another answer.</p><button class="btn ghost" data-retry>Try again</button>';
    $('jr-next').disabled = !ok;
    var chk = S.check;
    if (ok) later(function () { if (S.check === chk) focusIfVisible(document.querySelector('#jr-check [data-finish]')); }, 30);
  }
  function badgeArt(j, earned) {
    var lv = ONA.util && ONA.util.level ? ONA.util.level(j.level) : null, c = lv ? lv.accent : C.cyan;
    return '<svg class="jr-badge-art' + (earned ? ' earned' : '') + '" viewBox="0 0 400 260" aria-hidden="true" style="--c:' + c + '">' +
      '<circle cx="200" cy="120" r="92" class="jba-glow"/><path class="jba-ring" d="M200 34l22 18 28-4 10 26 26 12-4 28 18 22-18 22 4 28-26 12-10 26-28-4-22 18-22-18-28 4-10-26-26-12 4-28-18-22 18-22-4-28 26-12 10-26 28 4z"/>' +
      '<circle cx="200" cy="120" r="56" class="jba-core"/>' + (ONA.art && ONA.art.starIcon ? '<g transform="translate(170 90) scale(2.5)">' + ONA.art.starIcon(earned).replace(/^<svg[^>]*>|<\/svg>$/g, '') + '</g>' : '') +
      tx(200, 244, earned ? 'Badge earned · ' + j.title : 'Answer to earn the badge', 'jba-t', 'middle') + '</svg>';
  }

  // ------------------------------------------------------------------ keyboard (capture: runs before the game's handler)
  function focusables() {
    return Array.prototype.slice.call(document.querySelectorAll('#journey button:not([disabled]), #journey [tabindex="0"]')).filter(function (n) { return n.offsetParent !== null || n.closest('svg'); });
  }
  function onKey(e) {
    if (!S.open) return;
    var k = e.key, t = e.target;
    if (k === 'm' || k === 'M' || k === 'n' || k === 'N') return;       // mute / music keys stay global
    e.stopImmediatePropagation();
    if (k === 'Tab') {
      var f = focusables(); if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); if (!$('jr-tip').hidden) hideTip(); else close(); return; }
    var node = t && t.closest && t.closest('.jn');
    if (node && (k === 'Enter' || k === ' ')) { e.preventDefault(); scan(node.dataset.node); return; }
    var onButton = t && t.closest && t.closest('button');
    if (k === 'ArrowRight') { e.preventDefault(); stopAuto(); next(); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); back(); return; }
    if ((k === 'r' || k === 'R')) { replay(); return; }
    if ((k === ' ' && !onButton) || k === 'p' || k === 'P') { e.preventDefault(); toggleAuto(); return; }
    if (S.i === S.j.steps.length && /^[1-9]$/.test(k)) { var n = +k - 1; if (n < S.j.check.choices.length) answer(n); return; }
    if (k === 'Enter' && !onButton) { e.preventDefault(); next(); }
  }

  // ------------------------------------------------------------------ entry points
  function button(q, where) {
    var j = q && q.journey && get(q.journey); if (!j) return '';
    return '<button class="btn jr-learn ' + (where === 'hint' ? 'hint' : '') + '" data-journey-open="' + E(j.id) + '" data-src="' + (where || 'feedback') + '" data-qid="' + E(q.id) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg>' +
      (where === 'hint' ? 'Watch the journey first' : 'Learn: ' + E(j.title)) + '</button>';
  }
  // Order (sequence) questions get a pre-answer "Watch the journey first" button. It counts as a hint;
  // the game has no hint penalty, so there's no score cost (the store just counts the views).
  function decorateQuestion(q, p, card) {
    if (!card || !q || !q.journey || p.type !== 'order') return;
    var bar = card.querySelector('.q-actions'); if (!bar) return;
    var wrap = document.createElement('div'); wrap.className = 'jr-hint-wrap'; wrap.innerHTML = button(q, 'hint');
    bar.insertBefore(wrap, bar.firstChild);
  }
  function stats() {
    var st = ONA.store && ONA.store.state ? ONA.store.state.journeys || {} : {};
    return list().map(function (j) { var r = st[j.id] || {}; return { j: j, done: r.done || 0, firstTry: !!r.firstTry, hints: r.hints || 0, qs: (ONA.JOURNEY_MAP && ONA.JOURNEY_MAP[j.id] || []).length }; });
  }
  function logCard() {
    var s = stats(), done = s.filter(function (x) { return x.done; }).length;
    return '<section class="glass card journeys-card"><h3 class="card-title">Holo-sim journeys <span class="muted">' + done + ' / ' + s.length + ' completed</span></h3>' +
      '<div class="jl-meter"><span style="--v:' + (s.length ? done / s.length : 0) + '"></span></div><ul class="jl-list">' +
      s.map(function (x) {
        return '<li class="' + (x.done ? 'done' : '') + '"><span class="jl-dot" aria-hidden="true"></span><span class="jl-name">' + E(x.j.title) + '</span>' +
          '<span class="jl-meta">' + (x.done ? '✓ ' + (x.done > 1 ? x.done + ' runs' : 'done') + (x.firstTry ? ' · first try' : '') : 'not yet') + '</span>' +
          '<button class="btn tiny" data-journey-open="' + x.j.id + '" data-src="library">' + (x.done ? 'Replay' : 'Launch') + '</button></li>';
      }).join('') + '</ul><button class="btn ghost" data-journey-library>Open the journeys library</button></section>';
  }
  function renderLibrary() {
    var host = document.getElementById('screen-journeys'); if (!host) return;
    var s = stats(), done = s.filter(function (x) { return x.done; }).length;
    var byLevel = {};
    s.forEach(function (x) { (byLevel[x.j.level] = byLevel[x.j.level] || []).push(x); });
    var h = '<div class="page"><div class="page-head"><div><div class="eyebrow">Holo-sim deck</div><h1 class="page-title">Journeys</h1>' +
      '<p class="page-sub">Animated walkthroughs of how each flow really works: watch the packet move, scan any component, then answer one check question for a badge (+' + (ONA.store ? ONA.store.JOURNEY_XP : 40) + ' XP the first time). ' +
      'Every journey is open from the start, whatever worlds you\'ve unlocked: they are study material, so you can watch one before flying its world.</p></div>' +
      '<div class="jl-total"><b>' + done + '</b> / ' + s.length + ' completed</div></div>';
    ONA.LEVELS.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (l) {
      var xs = byLevel[l.id]; if (!xs) return;
      h += '<section class="jl-world" style="--accent:' + l.accent + '"><h2 class="jl-world-t"><span class="jl-planet" aria-hidden="true">' + (ONA.art ? ONA.art.planet(l.art) : '') + '</span>' +
        '<span><span class="eyebrow">World ' + (l.bonus ? '★' : l.id) + '</span>' + E(l.name) + '</span></h2><div class="jl-grid">' +
        xs.map(function (x) {
          var j = x.j, thumb = j.steps[0].figure ? scene(j, 0, { static: true }) : scene(j, Math.min(1, j.steps.length - 1), { static: true });
          return '<article class="jl-card glass' + (x.done ? ' done' : '') + '"><div class="jl-thumb" aria-hidden="true" inert>' + thumb + '</div>' +
            '<div class="jl-body"><h3>' + E(j.title) + '</h3><p>' + E(j.tagline) + '</p><div class="jl-tags"><span class="chip ghost">' + j.steps.length + ' steps</span>' +
            '<span class="chip ghost">' + x.qs + ' questions</span>' + (x.done ? '<span class="chip good">✓ badge</span>' : '') + '</div>' +
            '<button class="btn primary" data-journey-open="' + j.id + '" data-src="library">' + (x.done ? 'Replay journey' : 'Launch journey') + '</button></div></article>';
        }).join('') + '</div></section>';
    });
    host.innerHTML = h + '</div>';
  }

  // ------------------------------------------------------------------ wiring (browser only)
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', function (e) {
      // Enter/Space on a "Learn" button must open the journey, not also advance the question.
      if (S.open || (e.key !== 'Enter' && e.key !== ' ')) return;
      var b = e.target && e.target.closest && e.target.closest('[data-journey-open]');
      if (b) { e.preventDefault(); e.stopImmediatePropagation(); open(b.dataset.journeyOpen, { src: b.dataset.src, qid: b.dataset.qid }); }
    }, true);
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-journey-open]');
      if (b) { e.preventDefault(); open(b.dataset.journeyOpen, { src: b.dataset.src, qid: b.dataset.qid }); return; }
      if (e.target.closest && e.target.closest('[data-journey-library]') && ONA.game && ONA.game.show) ONA.game.show('journeys');
    });
    var watch = function () {
      new MutationObserver(function () { if (document.body.dataset.screen === 'journeys') renderLibrary(); }).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
    };
    if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
  }

  ONA.journeys = { open: open, close: close, button: button, decorateQuestion: decorateQuestion, logCard: logCard, renderLibrary: renderLibrary, scene: scene, get: get, list: list,
    state: function () { return { open: S.open, id: S.j && S.j.id, step: S.i, auto: S.auto, sel: S.sel, solved: !!(S.check && S.check.solved) }; },
    pending: function () { return S.pend.length; } };
})(typeof window !== 'undefined' ? window : globalThis);
