/* Orbital Network Academy — game controller: screens, galaxy map, missions, grading, dialogs, Repair Bay, Captain's Log. */
(function (ONA) {
  'use strict';
  var U = ONA.util, $ = U.$, $$ = U.$$, el = U.el, esc = U.esc, store = ONA.store, sfx = ONA.sfx, fx = ONA.fx, art = ONA.art;

  var MISSION_SIZE = 12;
  var REPAIR_SIZE = 15;
  var DRILL_SIZE = 10;
  var ORDER_ROW = 62;   // row pitch; refreshed from the list's --order-row (CSS) each time a sequence renders

  var G = (ONA.game = { screen: null, run: null, selected: 1, dialogOpen: false, modalOpen: false });

  // ------------------------------------------------------------------ helpers
  function fmt(s) {
    // light inline formatting: `code`
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function playable(l) { return questionsFor(l.id).length > 0; }
  function questionsFor(levelId) { return ONA.QUESTIONS.filter(function (q) { return q.level === levelId; }); }
  function partsOf(q) { return q.type === 'multipart' ? q.parts : [q]; }
  function nextLevel(l) {
    return ONA.LEVELS.filter(function (x) { return !x.bonus && x.id > l.id; }).sort(function (a, b) { return a.id - b.id; })[0];
  }
  function multFor(streak) { return streak >= 10 ? 3 : streak >= 6 ? 2 : streak >= 3 ? 1.5 : 1; }
  function shortHost(url) { return url.replace(/^https:\/\//, '').replace(/\/$/, ''); }
  function starsHtml(n, max) { var s = ''; for (var i = 0; i < (max || 3); i++) s += art.starIcon(i < n); return '<span class="stars" aria-label="' + n + ' of 3 stars">' + s + '</span>'; }

  // ------------------------------------------------------------------ screens
  function show(name) {
    // leaving the mission for a menu cancels any run-ending sequence still in flight (alarms, dialog, debrief)
    if (name !== 'mission' && name !== 'debrief') cancelSeq();
    if (G.screen === name) return;
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); s.setAttribute('aria-hidden', s.id === 'screen-' + name ? 'false' : 'true'); });
    document.body.dataset.screen = name;
    G.screen = name;
    syncMood();
    $('#topbar').classList.toggle('hidden', name === 'title' || name === 'mission');
    if (name === 'map') renderMap();
    if (name === 'bay') renderBay();
    if (name === 'log') renderLog();
    renderTopbar();
    var focusable = $('#screen-' + name + ' [data-autofocus]');
    if (focusable) setTimeout(function () { focusable.focus({ preventScroll: true }); }, 60);
  }
  G.show = show;

  // ------------------------------------------------------------------ audio wiring
  function syncMood() { ONA.music.setMood(ONA.music.moodFor(G.screen, G.run, G.journeyOpen)); }
  // Holo-sim journey opened/closed (js/journeys.js): calm bed, music lowered under the narration, restored after.
  // The run itself is untouched: the clock is frozen by journeyOpen and journeys never call the answer/damage path.
  G.onJourney = function () { syncMood(); ONA.audio.apply(); };

  // First user gesture (Enter / click / any key): create the AudioContext and start music.
  // The "Music on" toast shows once per visit, the first time music actually starts. The flag is set only then,
  // so a first gesture that doesn't start music (e.g. M muting everything) still gets the toast later.
  // Returns true when this call started music for the first time; { quiet: true } lets the caller show the
  // toast itself instead of its usual one (M / N), so there's never a duplicate.
  var musicToastShown = false, MUSIC_ON_TOAST = 'Music on · N toggles music, M mutes all';
  function startAudio(opts) {
    sfx.unlock();
    ONA.audio.apply();
    var first = ONA.music.sync() && !musicToastShown;
    if (first) {
      musicToastShown = true;
      if (!(opts && opts.quiet)) toast(MUSIC_ON_TOAST);
    }
    return first;
  }
  G.startAudio = startAudio;

  function applyAudio() {
    ONA.audio.apply();
    ONA.music.sync();
    syncMute();
  }

  // ------------------------------------------------------------------ the ship (js/ship.js draws it)
  // Lives = hull integrity on the ship; misses damage the module their topic maps to;
  // the Repair Bay is the hangar where those modules get welded. The SVG is decorative
  // (aria-hidden); damage and repairs are announced here for screen readers.
  var shipCtl = null;
  function announce(text) {
    var l = $('#ship-live'); if (!l) return;
    l.textContent = '';
    setTimeout(function () { l.textContent = text; }, 40);
  }
  G.announce = announce;
  function shipModOf(q) { return ONA.ship.module(ONA.ship.moduleForQuestion(q)); }

  function mountMissionShip(run) {
    var bay = ONA.ship.baySeverity(store), dmg = {};
    // Repair runs show the bay damage as it is; missions show it as old scorch marks, so fresh hits stand out.
    Object.keys(bay).forEach(function (k) { dmg[k] = run.mode === 'repair' ? bay[k] : 1; });
    run.shipDmg = dmg; run.shipHits = {};
    var lo = ONA.ship.loadout(store);
    shipCtl = ONA.ship.mount($('#ship-view'), { loadout: lo, damage: dmg, shield: 1 });
    $('#sp-tier').textContent = lo.tier.name + ' · T' + (lo.tier.index + 1);
    $('#screen-mission').classList.remove('power-down');
  }

  function renderShipPanel() {
    var run = G.run; if (!run || !shipCtl) return;
    var max = run.maxShields, frac = max ? run.shields / max : 1, hull = '';
    shipCtl.setShield(frac, max ? max - run.shields : 0);
    shipCtl.setBurn(run.streak);
    if (max) {
      for (var i = 0; i < max; i++) hull += '<i class="' + (i < run.shields ? 'on' : '') + '"></i>';
      $('#sp-hull-pct').textContent = Math.round(frac * 100) + '%';
    } else {
      hull = '<span class="sp-note">' + (run.mode === 'repair' ? 'Docked · repair run' : 'Sim · no hull damage') + '</span>';
      $('#sp-hull-pct').textContent = '—';
    }
    $('#sp-hull').innerHTML = hull;
    $('#sp-hull').classList.toggle('low', !!max && frac <= 0.34);
    $('#sp-burn').style.setProperty('--v', Math.min(10, run.streak) / 10);
    $('#sp-burn-pct').textContent = run.streak >= 3 ? '×' + multFor(run.streak) + ' burn' : run.streak ? 'streak ' + run.streak : 'idle';
    var items;
    if (run.mode === 'repair') {
      items = ONA.ship.damagedModules(store).map(function (m) { return { label: m.label, n: m.count, sev: m.sev }; });
      $('#sp-dmg-title').textContent = 'Modules in the bay';
    } else {
      items = Object.keys(run.shipHits).map(function (id) { return { label: ONA.ship.module(id).label, n: run.shipHits[id], sev: run.shipDmg[id] }; });
      $('#sp-dmg-title').textContent = 'Damage this mission';
    }
    $('#sp-damage').innerHTML = items.length
      ? items.slice(0, 6).map(function (it) { return '<li class="sev-' + it.sev + '"><i></i>' + esc(it.label) + (it.n > 1 ? ' <b>×' + it.n + '</b>' : '') + '</li>'; }).join('') +
        (items.length > 6 ? '<li class="more">+' + (items.length - 6) + ' more</li>' : '')
      : '<li class="ok">All modules nominal</li>';
  }

  // ------------------------------------------------------------------ run-ending sequence (cancellable)
  // Everything scheduled between "the run is over" and "the debrief is on screen" (power-down alarms, the
  // power-down delay, the closing dialog) goes through one token per sequence. Leaving the mission or starting
  // another run cancels it: its timeouts are cleared, an open sequence dialog is closed, the power-down tint and
  // starfield danger are cleared, and the chain checks the token + G.run before opening a dialog or debrief.
  var activeSeq = null;
  function beginSeq(run) {
    cancelSeq();
    var tok = { run: run, cancelled: false, timers: [], inDialog: false };
    tok.later = function (fn, ms) {
      var id = setTimeout(function () { tok.timers = tok.timers.filter(function (x) { return x !== id; }); if (!tok.cancelled) fn(); }, ms);
      tok.timers.push(id);
      return id;
    };
    tok.wait = function (ms) { return new Promise(function (res) { tok.later(res, ms); }); };   // never resolves once cancelled
    tok.live = function () { return !tok.cancelled && G.run === run; };
    activeSeq = tok;
    return tok;
  }
  function cancelSeq() {
    var tok = activeSeq; if (!tok) return;
    activeSeq = null;
    tok.cancelled = true;
    tok.timers.forEach(clearTimeout); tok.timers = [];
    $('#screen-mission').classList.remove('power-down');
    ONA.starfield.danger(false);
    if (tok.inDialog && G.dialogOpen && G.dialogClose) G.dialogClose();
  }
  function endSeq(tok) { if (activeSeq === tok) activeSeq = null; }
  G.cancelSeq = cancelSeq;
  G.seqActive = function () { return !!activeSeq; };

  // Lives ran out: lights flicker off, engines die, the ship tumbles, alarm tint. Then the debrief.
  // All timing runs on the sequence token; under reduced motion the alarms fit inside the shorter window.
  function powerDown(tok) {
    var ms = U.reducedMotion() ? 700 : 2600, gap = Math.min(650, ms / 3);
    $('#screen-mission').classList.add('power-down');
    ONA.starfield.danger(true, 'rgba(255,30,60,0.45)');
    announce('Hull integrity zero. Ship disabled.');
    sfx.alarm(); tok.later(sfx.alarm, gap); tok.later(sfx.alarm, gap * 2);
    if (shipCtl) shipCtl.powerDown();
    return tok.wait(ms);
  }

  function renderTopbar() {
    var t = store.totals(), rk = store.rank(t.xp), bay = store.bay();
    $('#tb-rank').textContent = rk.name;
    $('#tb-xp').textContent = t.xp.toLocaleString() + ' XP';
    $('#tb-xpbar').style.setProperty('--v', rk.progress);
    $('#tb-xpnext').textContent = rk.next ? rk.toNext.toLocaleString() + ' XP to ' + rk.next : 'Max rank';
    $('#tb-stars').textContent = t.stars + ' / ' + ONA.LEVELS.filter(function (l) { return !l.bonus; }).length * 3;
    var b = $('#tb-bay-badge'); b.textContent = bay.due.length; b.classList.toggle('hidden', !bay.due.length);
    $$('.nav-btn').forEach(function (n) { n.classList.toggle('current', n.dataset.go === G.screen); });
    syncMute();
  }

  function syncMute() {
    var m = store.state.settings.muted;
    $$('.mute-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', m ? 'true' : 'false');
      b.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
      b.innerHTML = m
        ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
    });
  }

  // ------------------------------------------------------------------ modal layers (a11y)
  // Each open dialog/modal is a layer: everything else becomes inert, Tab is trapped inside,
  // and focus returns to where it was when the layer closes.
  var LAYER_ROOTS = ['#app', '#topbar', '#dialog', '#modal'];
  G.layers = [];
  function syncInert() {
    var top = G.layers.length ? G.layers[G.layers.length - 1].el : null;
    LAYER_ROOTS.forEach(function (sel) {
      var n = $(sel); if (!n) return;
      var isLayer = n.id === 'dialog' || n.id === 'modal';
      var open = G.layers.some(function (l) { return l.el === n; });
      if (top && n !== top) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); }
      else if (isLayer && !open) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); }
      else { n.removeAttribute('inert'); n.setAttribute('aria-hidden', 'false'); }
    });
  }
  function openLayer(el) {
    G.layers.push({ el: el, prev: document.activeElement });
    syncInert();
  }
  function closeLayer(el) {
    var i = -1;
    G.layers.forEach(function (l, k) { if (l.el === el) i = k; });
    if (i < 0) return;
    var prev = G.layers[i].prev;
    G.layers.splice(i, 1);
    if (el.contains(document.activeElement)) document.activeElement.blur();
    syncInert();
    // Restore focus only to something still visible and interactive.
    if (prev && prev !== document.body && document.contains(prev) && prev.offsetParent !== null && !prev.closest('[inert]')) {
      try { prev.focus({ preventScroll: true }); } catch (e) { /* not focusable any more */ }
    }
  }
  function focusables(root) {
    return $$('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', root)
      .filter(function (n) { return n.offsetParent !== null; });
  }
  function trapTab(e) {
    var top = G.layers[G.layers.length - 1]; if (!top) return false;
    var f = focusables(top.el); e.preventDefault();
    if (!f.length) return true;
    var i = f.indexOf(document.activeElement);
    var next = i < 0 ? (e.shiftKey ? f[f.length - 1] : f[0]) : f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
    next.focus();
    return true;
  }
  G._trapTab = trapTab;

  // ------------------------------------------------------------------ dialog (commander briefing)
  var WHO = { vega: { name: 'Cmdr. Vega', role: 'Academy Flight Command' }, null: { name: 'NULL ROUTE', role: 'Rogue routing intelligence' } };

  function dialog(lines, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!lines || !lines.length) return resolve();
      var box = $('#dialog'), i = 0, typing = null, full = '';
      G.dialogOpen = true;
      box.classList.add('open');
      openLayer(box);
      box.classList.toggle('twist', !!opts.twist);
      $('#dlg-tag').textContent = opts.tag || 'Incoming transmission';
      function finishType() { if (typing) { clearInterval(typing); typing = null; } $('#dlg-text').textContent = full; $('#dlg-next').classList.add('ready'); }
      function showLine() {
        var ln = lines[i], who = WHO[ln.who] || WHO.vega;
        box.dataset.who = ln.who;
        $('#dlg-portrait').innerHTML = art.portrait(ln.who);
        $('#dlg-name').textContent = who.name;
        $('#dlg-role').textContent = who.role;
        $('#dlg-count').textContent = (i + 1) + ' / ' + lines.length;
        full = ln.text;
        $('#dlg-next').classList.remove('ready');
        $('#dlg-next-label').textContent = i === lines.length - 1 ? (opts.done || 'Continue') : 'Next';
        if (U.reducedMotion()) { finishType(); return; }
        var t = $('#dlg-text'), k = 0; t.textContent = '';
        typing = setInterval(function () {
          k += 2; t.textContent = full.slice(0, k);
          if (k % 6 === 0) sfx.tick();
          if (k >= full.length) finishType();
        }, 22);
      }
      function advance() {
        if (typing) return finishType();
        i++;
        if (i >= lines.length) return close();
        showLine();
      }
      function close() {
        finishType();
        box.classList.remove('open');
        G.dialogOpen = false; G.dialogAdvance = null;
        box.removeEventListener('click', onClick);
        closeLayer(box);
        resolve();
      }
      function onClick(e) {
        if (e.target.closest('#dlg-skip')) return close();
        advance();
      }
      G.dialogAdvance = advance; G.dialogClose = close;
      box.addEventListener('click', onClick);
      showLine();
      setTimeout(function () { $('#dlg-next').focus({ preventScroll: true }); }, 30);
    });
  }
  G.dialog = dialog;

  // ------------------------------------------------------------------ modal
  function modal(html, opts) {
    opts = opts || {};
    var m = $('#modal');
    $('#modal-body').innerHTML = html;
    var t = $('#modal-body .modal-title'); if (t) t.id = 'modal-title';
    var wasOpen = G.modalOpen;
    m.classList.add('open'); G.modalOpen = true;
    if (!wasOpen) openLayer(m);
    m.classList.toggle('wide', !!opts.wide);
    var f = $('#modal-body [data-autofocus]') || $('#modal-body button');
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() { if (!G.modalOpen) return; $('#modal').classList.remove('open'); G.modalOpen = false; closeLayer($('#modal')); if (G.onModalClose) { var f = G.onModalClose; G.onModalClose = null; f(); } }
  G.closeModal = closeModal;

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      modal('<h2 class="modal-title">' + esc(title) + '</h2><p class="modal-text">' + esc(text) + '</p>' +
        '<div class="modal-actions"><button class="btn ghost" data-act="no">Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-act="yes" data-autofocus>' + esc(okLabel) + '</button></div>');
      var body = $('#modal-body');
      function h(e) {
        var a = e.target.closest('[data-act]'); if (!a) return;
        body.removeEventListener('click', h);
        G.onModalClose = null; closeModal(); resolve(a.dataset.act === 'yes');
      }
      body.addEventListener('click', h);
      G.onModalClose = function () { body.removeEventListener('click', h); resolve(false); };
    });
  }

  function toast(text, kind) {
    var t = el('div', { class: 'toast ' + (kind || ''), role: 'status', text: text });
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2600);
    setTimeout(function () { t.remove(); }, 3200);
  }

  // ------------------------------------------------------------------ title
  function initTitle() {
    var orbit = 'M60 130a240 70 0 1 0 480 0a240 70 0 1 0 -480 0';
    $('#title-ship').innerHTML = '<svg viewBox="0 0 600 260" class="title-orbit-svg" aria-hidden="true">' +
      '<path d="' + orbit + '" class="orbit-line"/><path d="' + orbit + '" class="orbit-flow"/>' +
      '<g><g transform="translate(-48 -20)">' + art.ship('width="96" height="40"') + '</g>' +
      (U.reducedMotion() ? '' : '<animateMotion dur="16s" repeatCount="indefinite" rotate="auto" path="' + orbit + '"/>') + '</g></svg>';
    $('#title-planet').innerHTML = art.planet('earth');
    var played = store.state.sessions.length > 0;
    $('#btn-begin').textContent = played ? 'Continue mission' : 'Begin training';
    $('#title-sub').textContent = played
      ? 'Welcome back, ' + store.rank(store.state.xp).name + '. The fleet still needs you.'
      : 'Learn networking. Link the fleet. Defeat NULL ROUTE.';
  }

  // ------------------------------------------------------------------ galaxy map
  var mapShipPos = null, shipAnim = 0;

  function planetR(l) { return l.boss ? 78 : l.bonus ? 50 : 64; }
  function shipAnchor(l) { return { x: l.map.x - planetR(l) * 0.2, y: l.map.y - planetR(l) - 40 }; }

  function routePath(pts) {
    // Catmull-Rom → cubic Bezier through the main route.
    if (pts.length < 2) return '';
    var d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += 'C' + (p1.x + (p2.x - p0.x) / 6).toFixed(1) + ' ' + (p1.y + (p2.y - p0.y) / 6).toFixed(1) + ' ' +
        (p2.x - (p3.x - p1.x) / 6).toFixed(1) + ' ' + (p2.y - (p3.y - p1.y) / 6).toFixed(1) + ' ' + p2.x + ' ' + p2.y;
    }
    return d;
  }

  function renderMap() {
    var main = ONA.LEVELS.filter(function (l) { return !l.bonus; }).sort(function (a, b) { return a.id - b.id; });
    var bonus = ONA.LEVELS.filter(function (l) { return l.bonus; });
    var sun = { x: -140, y: 860 };
    var lastUnlocked = 0;
    main.forEach(function (l, i) { if (store.unlocked(l)) lastUnlocked = i; });
    var pts = main.map(function (l) { return l.map; });
    var doneD = routePath(pts.slice(0, lastUnlocked + 1));

    var svg = '<svg id="galaxy" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Galaxy map">' +
      '<defs><radialGradient id="sunG" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff6d6"/><stop offset=".18" stop-color="#ffd27a"/><stop offset=".4" stop-color="#ff9a3c" stop-opacity=".55"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="routeG" x1="0" x2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset=".55" stop-color="#b794f6"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient>' +
      '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>' +
      '<circle cx="' + sun.x + '" cy="' + sun.y + '" r="420" fill="url(#sunG)" class="sun"/>' +
      '<circle cx="' + sun.x + '" cy="' + sun.y + '" r="150" fill="#ffe7a8" opacity=".9"/>';
    // orbit rings around the sun
    main.concat(bonus).forEach(function (l) {
      var r = Math.hypot(l.map.x - sun.x, l.map.y - sun.y);
      svg += '<circle class="orbit" cx="' + sun.x + '" cy="' + sun.y + '" r="' + r.toFixed(0) + '"/>';
    });
    svg += '<path class="route" d="' + routePath(pts) + '"/>';
    svg += '<path class="route done" d="' + doneD + '"/>';
    svg += '<path class="route flow" d="' + doneD + '"/>';
    bonus.forEach(function (b) {
      var from = main[main.length - 2] || main[0];
      svg += '<path class="route bonus" d="M' + from.map.x + ' ' + from.map.y + 'Q' + ((from.map.x + b.map.x) / 2 + 80) + ' ' + ((from.map.y + b.map.y) / 2) + ' ' + b.map.x + ' ' + b.map.y + '"/>';
    });
    main.concat(bonus).forEach(function (l) {
      var r = planetR(l), un = store.unlocked(l) && playable(l), rec = store.levelRec(l.id);
      var cls = 'planet' + (un ? '' : ' locked') + (G.selected === l.id ? ' selected' : '') + (l.boss ? ' boss' : '') + (l.bonus ? ' bonus' : '');
      svg += '<g class="' + cls + '" data-level="' + l.id + '" transform="translate(' + l.map.x + ' ' + l.map.y + ')" role="button" tabindex="0" ' +
        'aria-label="Mission ' + l.id + ': ' + esc(l.name) + (un ? ', ' + rec.bestStars + ' stars' : ', locked') + '" style="--accent:' + l.accent + '">' +
        '<circle class="hit" r="' + (r + 30) + '"/>' +
        '<g class="reticle"><circle r="' + (r + 18) + '"/><path d="M0 ' + -(r + 26) + 'v12M0 ' + (r + 26) + 'v-12M' + -(r + 26) + ' 0h12M' + (r + 26) + ' 0h-12"/></g>' +
        '<svg x="' + -r * 1.55 + '" y="' + -r * 1.55 + '" width="' + r * 3.1 + '" height="' + r * 3.1 + '" viewBox="-110 -110 220 220" class="planet-art">' + art.planet(l.art).replace(/^<svg[^>]*>|<\/svg>$/g, '') + '</svg>' +
        (un ? '' : '<g class="lock">' + '<circle r="20"/>' + '<g transform="translate(-12 -12)"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></g>') +
        '<text class="pl-num" y="' + (r + 40) + '">' + (l.bonus ? 'BONUS' : 'MISSION ' + String(l.id).padStart(2, '0')) + '</text>' +
        '<text class="pl-name" y="' + (r + 64) + '">' + esc(l.name) + '</text>' +
        (l.bonus ? '' : '<g class="pl-stars" transform="translate(-33 ' + (r + 76) + ')">' + [0, 1, 2].map(function (i) {
          return '<path transform="translate(' + i * 24 + ' 0) scale(.85)" class="' + (i < rec.bestStars ? 'on' : '') + '" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>';
        }).join('') + '</g>') +
        '</g>';
    });
    svg += '<g id="map-ship" aria-hidden="true">' + art.ship('x="-56" y="-24" width="112" height="47"') + '</g>';
    svg += '</svg>';
    $('#map-stage').innerHTML = svg;

    var at = U.level(store.state.shipAt) || main[0];
    mapShipPos = shipAnchor(at);
    placeShip(mapShipPos, 0, false);
    if (!U.level(G.selected)) G.selected = at.id;
    renderMissionCard();
    panMap(G.selected, false);

    $$('#galaxy .planet').forEach(function (p) {
      p.addEventListener('click', function () { selectLevel(+p.dataset.level, true); });
      p.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (G.selected === +p.dataset.level) launchSelected(); else selectLevel(+p.dataset.level, true); } });
    });
  }

  // On phones the map is wider than the screen (#map-stage scrolls sideways): centre the given world.
  function panMap(id, smooth) {
    var stage = $('#map-stage'), svg = $('#galaxy'), l = U.level(id);
    if (!stage || !svg || !l || stage.scrollWidth <= stage.clientWidth + 1) return;
    var x = l.map.x / 1600 * svg.getBoundingClientRect().width - stage.clientWidth / 2;
    stage.scrollTo({ left: Math.max(0, x), behavior: smooth && !U.reducedMotion() ? 'smooth' : 'auto' });
  }
  window.addEventListener('resize', function () { if (G.screen === 'map') panMap(G.selected, false); });

  function placeShip(p, angle, flying) {
    var s = $('#map-ship'); if (!s) return;
    var flip = Math.abs(angle) > 90 ? ' scale(1 -1)' : '';
    s.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ') rotate(' + angle.toFixed(1) + ')' + flip);
    s.classList.toggle('flying', !!flying);
  }

  function flyShip(to, done) {
    cancelAnimationFrame(shipAnim);
    var from = mapShipPos;
    if (!from || U.reducedMotion() || (Math.abs(from.x - to.x) < 2 && Math.abs(from.y - to.y) < 2)) { mapShipPos = to; placeShip(to, 0, false); if (done) done(); return; }
    var ns = 'http://www.w3.org/2000/svg', path = document.createElementNS(ns, 'path');
    var mx = (from.x + to.x) / 2, my = Math.min(from.y, to.y) - 110;
    path.setAttribute('d', 'M' + from.x + ' ' + from.y + 'Q' + mx + ' ' + my + ' ' + to.x + ' ' + to.y);
    var len = path.getTotalLength(), dur = U.clamp(len * 1.3, 600, 1500), t0 = performance.now();
    sfx.warp();
    function step(t) {
      var k = U.clamp((t - t0) / dur, 0, 1), e = U.ease(k);
      var p = path.getPointAtLength(e * len), q = path.getPointAtLength(Math.min(len, e * len + 1));
      var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      if (k >= 1) ang = 0;
      placeShip(p, k >= 1 ? 0 : ang, k < 1);
      if (k < 1) shipAnim = requestAnimationFrame(step);
      else { mapShipPos = to; if (done) done(); }
    }
    shipAnim = requestAnimationFrame(step);
  }

  function selectLevel(id, fly) {
    var l = U.level(id); if (!l) return;
    G.selected = id;
    sfx.select();
    $$('#galaxy .planet').forEach(function (p) { p.classList.toggle('selected', +p.dataset.level === id); });
    renderMissionCard();
    panMap(id, true);
    if (fly && store.unlocked(l) && playable(l)) {
      store.state.shipAt = id; store.save();
      flyShip(shipAnchor(l));
    }
  }

  function renderMissionCard() {
    var l = U.level(G.selected), rec = store.levelRec(l.id), qs = questionsFor(l.id);
    var un = store.unlocked(l), canPlay = un && qs.length > 0;
    var types = {}; qs.forEach(function (q) { types[q.type] = (types[q.type] || 0) + 1; });
    var prev = ONA.LEVELS.filter(function (x) { return !x.bonus && x.id < l.id; }).sort(function (a, b) { return b.id - a.id; })[0];
    var lockMsg = !qs.length ? 'Awaiting transmission. This world has no questions yet.'
      : 'Earn ' + starsHtml(2) + ' on <b>' + esc(prev ? prev.name : '') + '</b> to unlock, or enable <b>Free roam</b> in Settings.';
    var h = '<div class="mc-head" style="--accent:' + l.accent + '">' +
      '<div class="mc-art">' + art.planet(l.art) + '</div>' +
      '<div><div class="eyebrow">' + (l.bonus ? 'Bonus world' : 'Mission ' + String(l.id).padStart(2, '0')) + (l.boss ? ' · Boss' : '') + '</div>' +
      '<h2 class="mc-title">' + esc(l.name) + '</h2><div class="mc-body">' + esc(l.body) + '</div></div></div>' +
      '<p class="mc-sub">' + esc(l.subtitle) + '</p>' +
      '<div class="mc-stats">' +
      '<div><span class="k">Best</span>' + starsHtml(rec.bestStars) + '</div>' +
      '<div><span class="k">Accuracy</span><b>' + (rec.plays ? Math.round(rec.bestAccuracy * 100) + '%' : '—') + '</b></div>' +
      '<div><span class="k">Best XP</span><b>' + (rec.bestScore || '—') + '</b></div>' +
      '<div><span class="k">Bank</span><b>' + qs.length + ' Q</b></div>' +
      '</div>' +
      '<div class="mc-flags">' + (l.boss ? '<span class="chip danger">⏱ ' + Math.round((l.timeLimitSec || 900) / 60) + ' min boss clock</span>' : '') +
      '<span class="chip">🛡 ' + (l.shields || 3) + ' shields</span><span class="chip">' + Math.min(l.boss ? qs.length : MISSION_SIZE, qs.length) + ' questions / run</span>' +
      Object.keys(types).map(function (t) { return '<span class="chip ghost">' + TYPE_LABEL[t] + ' ×' + types[t] + '</span>'; }).join('') + '</div>' +
      (canPlay
        ? '<div class="mc-actions"><button class="btn primary big" id="btn-launch" data-autofocus>Launch mission <kbd>Enter</kbd></button>' +
          '<button class="btn ghost" id="btn-train" title="Practice 10 questions from this world without shields or stars">Training sim</button></div>'
        : '<div class="mc-locked">' + art.lockIcon() + '<p>' + lockMsg + '</p></div>');
    var card = $('#mission-card');
    card.innerHTML = h;
    card.style.setProperty('--accent', l.accent);
    if (canPlay) {
      $('#btn-launch').addEventListener('click', launchSelected);
      $('#btn-train').addEventListener('click', function () { startRun(l, 'drill'); });
    }
  }

  function launchSelected() {
    var l = U.level(G.selected);
    if (!l || !store.unlocked(l) || !playable(l)) { sfx.wrong(); return; }
    startRun(l, 'mission');
  }

  // ------------------------------------------------------------------ run setup
  var TYPE_LABEL = { mc: 'Choice', multi: 'Multi-select', numeric: 'Calc', order: 'Sequence', diagram: 'Diagram', multipart: 'Scenario' };

  function pickMissionQuestions(level) {
    var pool = questionsFor(level.id);
    if (level.boss) return pool.slice();
    var scored = pool.map(function (q) {
      var r = store.state.questions[q.id];
      var pri = !r ? 3 : r.box > 0 ? 2 + r.wrong / (r.seen || 1) : Math.random();
      return { q: q, p: pri + Math.random() * 0.5 };
    }).sort(function (a, b) { return b.p - a.p; }).slice(0, MISSION_SIZE).map(function (x) { return x.q; });
    // escalate within the run: easy → hard
    return scored.map(function (q) { return { q: q, k: q.difficulty + Math.random() * 0.9 }; }).sort(function (a, b) { return a.k - b.k; }).map(function (x) { return x.q; });
  }

  function startRun(level, mode, qList, label) {
    var queue = qList || (mode === 'drill' ? U.shuffle(questionsFor(level.id)).slice(0, DRILL_SIZE) : pickMissionQuestions(level));
    if (!queue.length) { toast('Nothing to fly yet.'); return; }
    cancelSeq();                      // a previous run's power-down / closing dialog must not take over this run
    var maxSh = mode === 'mission' ? (level && level.shields) || 3 : 0;
    G.run = {
      id: U.uid(), mode: mode, level: level, label: label, queue: queue, i: 0, part: 0, partScores: [],
      shields: maxSh, maxShields: maxSh, xp: 0, streak: 0, bestStreak: 0, results: [], answerMs: 0, qMs: 0,
      twistAt: mode === 'mission' && level && level.twist && level.twist.length ? Math.floor(queue.length / 2) : -1,
      overdrive: 1, timeLimit: mode === 'mission' && level && level.boss ? (level.timeLimitSec || 900) * 1000 : 0,
      timeLeft: 0, timer: 0, over: false, startTs: Date.now(), sel: null
    };
    var run = G.run;
    run.timeLeft = run.timeLimit;
    show('mission');
    syncMood();      // show() is a no-op when already on the mission screen (back-to-back runs)
    var mp = $('#mission-planet');
    mp.innerHTML = level ? art.planet(level.art) : art.planet('station');
    mp.style.setProperty('--accent', level ? level.accent : '#7cf7c3');
    $('#screen-mission').style.setProperty('--accent', level ? level.accent : '#7cf7c3');
    $('#screen-mission').classList.toggle('boss', !!(level && level.boss && mode === 'mission'));
    $('#screen-mission').classList.remove('overdrive');
    $('#hud-title').textContent = mode === 'repair' ? 'Repair Bay' : mode === 'drill' ? (label || 'Training sim · ' + level.name) : level.name;
    $('#hud-mode').textContent = mode === 'mission' ? (level.boss ? 'Boss mission' : level.bonus ? 'Bonus transmission' : 'Mission ' + String(level.id).padStart(2, '0')) : mode === 'repair' ? 'Leitner review' : 'No shields · no stars';
    $('#hud-planet').innerHTML = level ? art.planet(level.art) : art.planet('station');
    mountMissionShip(run);
    renderHud();
    $('#q-card').innerHTML = '';
    $('#feedback').className = 'feedback';
    ONA.starfield.danger(false);
    var pre = mode === 'mission' ? dialog(level.briefing, { tag: 'Mission briefing · ' + level.name, done: 'Launch' }) : Promise.resolve();
    pre.then(function () {
      if (G.run !== run) return;
      ONA.starfield.warp(900); sfx.warp();
      return U.wait(U.reducedMotion() ? 0 : 650);
    }).then(function () {
      if (G.run !== run) return;
      if (run.timeLimit) startTimer();
      renderQuestion();
    });
  }
  G.startRun = startRun;

  function startTimer() {
    var run = G.run, last = Date.now();
    run.timer = setInterval(function () {
      if (G.run !== run || run.over) return clearInterval(run.timer);
      var now = Date.now();
      if (!G.dialogOpen && !G.modalOpen && !G.journeyOpen) run.timeLeft -= now - last;
      last = now;
      if (run.timeLeft <= 60000 && run.timeLeft > 0 && Math.floor(run.timeLeft / 1000) % 10 === 0) sfx.alarm();
      renderTimer();
      if (run.timeLeft <= 0) { run.timeLeft = 0; renderTimer(); endRun('timeout'); }
    }, 1000);
  }

  // ------------------------------------------------------------------ HUD
  function renderHud() {
    var run = G.run; if (!run) return;
    var sh = '';
    if (run.maxShields) {
      for (var i = 0; i < run.maxShields; i++) sh += art.shieldIcon(i < run.shields ? 'on' : 'off');
      $('#hud-shields').innerHTML = sh;
      $('#hud-shields').setAttribute('aria-label', run.shields + ' of ' + run.maxShields + ' shields');
    } else $('#hud-shields').innerHTML = '<span class="hud-note">Shields offline · practice</span>';
    $('#hud-shields-wrap').classList.toggle('hidden', false);
    var segs = run.queue.map(function (q, k) {
      var r = run.results[k];
      var c = k === run.i ? 'cur' : r == null ? '' : r >= 1 ? 'ok' : r > 0 ? 'part' : 'bad';
      return '<i class="' + c + '"></i>';
    }).join('');
    $('#hud-progress').innerHTML = segs;
    $('#hud-progress-label').textContent = 'Warp fuel · ' + Math.min(run.i + 1, run.queue.length) + ' / ' + run.queue.length;
    var m = multFor(run.streak) * run.overdrive;
    $('#hud-mult').textContent = '×' + (m % 1 ? m.toFixed(2).replace(/0$/, '') : m);
    $('#hud-mult').parentNode.classList.toggle('hot', m > 1);
    $('#hud-streak').textContent = run.streak;
    $('#hud-xp').textContent = run.xp.toLocaleString();
    renderTimer();
    renderShipPanel();
  }
  function renderTimer() {
    var run = G.run, t = $('#hud-timer');
    if (!run || !run.timeLimit) { t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    t.querySelector('b').textContent = U.fmtTime(run.timeLeft);
    t.classList.toggle('critical', run.timeLeft <= 60000);
  }

  // ------------------------------------------------------------------ question rendering
  function curQ() { return G.run.queue[G.run.i]; }
  function curPart() { var q = curQ(); return q.type === 'multipart' ? q.parts[G.run.part] : q; }

  function renderQuestion() {
    var run = G.run, q = curQ(), p = curPart();
    run.sel = null; run.answered = false; run.partStart = Date.now();
    if (run.part === 0) { run.qMs = 0; run.partScores = []; }
    var topic = U.topicLabel(q.topic);
    var diff = '<span class="pips" aria-label="Difficulty ' + q.difficulty + ' of 3">' + [1, 2, 3].map(function (d) { return '<i class="' + (d <= q.difficulty ? 'on' : '') + '"></i>'; }).join('') + '</span>';
    var steps = '';
    if (q.type === 'multipart') {
      steps = '<div class="steps">' + q.parts.map(function (_, k) {
        var s = run.partScores[k];
        return '<span class="step ' + (k === run.part ? 'cur' : s == null ? '' : s ? 'ok' : 'bad') + '">' + (k + 1) + '</span>';
      }).join('<span class="step-line"></span>') + '</div>';
    }
    var html = '<div class="q-meta"><span class="chip type-' + p.type + '">' + TYPE_LABEL[q.type === 'multipart' ? 'multipart' : p.type] + '</span>' +
      '<span class="chip ghost">' + esc(topic) + '</span>' + diff + '<span class="q-num">Q' + (run.i + 1) + '</span></div>';
    if (q.type === 'multipart') html += '<p class="q-scenario">' + fmt(q.prompt) + '</p>' + steps;
    html += '<h2 class="q-prompt" id="q-prompt">' + fmt(p.prompt) + '</h2>';
    html += '<div class="q-body" id="q-body"></div>';
    html += '<div class="q-actions"><span class="hint" id="q-hint"></span><button class="btn primary" id="btn-submit" disabled>Lock in <kbd>Enter</kbd></button></div>';
    var card = $('#q-card');
    card.innerHTML = html;
    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    $('#feedback').className = 'feedback';
    $('#feedback').innerHTML = '';
    RENDER[p.type](p, $('#q-body'));
    if (ONA.journeys) ONA.journeys.decorateQuestion(q, p, card);   // "Watch the journey first" on sequence questions
    $('#btn-submit').addEventListener('click', submit);
    renderHud();
  }

  function setReady(ok) { var b = $('#btn-submit'); if (b) b.disabled = !ok; }

  var RENDER = {
    mc: function (p, body) {
      $('#q-hint').innerHTML = U.touch() ? 'Tap an answer, then Lock in' : 'Press <kbd>1</kbd>–<kbd>' + p.choices.length + '</kbd> then <kbd>Enter</kbd>';
      var list = el('div', { class: 'choices', role: 'radiogroup', 'aria-labelledby': 'q-prompt' });
      p.choices.forEach(function (c, k) {
        var b = el('button', { class: 'choice', role: 'radio', 'aria-checked': 'false', 'data-k': k, html: '<span class="key">' + (k + 1) + '</span><span class="txt">' + fmt(c) + '</span>' });
        b.addEventListener('click', function () { if (G.run.answered) return; pickMc(k); });
        b.addEventListener('dblclick', function () { if (!G.run.answered) submit(); });
        list.appendChild(b);
      });
      body.appendChild(list);
    },
    multi: function (p, body) {
      $('#q-hint').innerHTML = 'Select all that apply' + (U.touch() ? '' : ' · <kbd>1</kbd>–<kbd>' + p.choices.length + '</kbd> toggle');
      G.run.sel = [];
      var list = el('div', { class: 'choices multi', role: 'group', 'aria-labelledby': 'q-prompt' });
      p.choices.forEach(function (c, k) {
        var b = el('button', { class: 'choice', role: 'checkbox', 'aria-checked': 'false', 'data-k': k, html: '<span class="key">' + (k + 1) + '</span><span class="box"></span><span class="txt">' + fmt(c) + '</span>' });
        b.addEventListener('click', function () { if (G.run.answered) return; toggleMulti(k); });
        list.appendChild(b);
      });
      body.appendChild(list);
    },
    numeric: function (p, body) {
      $('#q-hint').innerHTML = U.touch() ? 'Type a number, then Lock in' : 'Type a number · <kbd>Enter</kbd> to lock in';
      var wrap = el('div', { class: 'numeric' });
      var row = el('label', { class: 'num-row' });
      var inp = el('input', { id: 'num-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Answer' + (p.unit ? ' in ' + p.unit : ''), placeholder: '—' });
      row.appendChild(el('span', { class: 'num-prefix', text: p.unit === 'prefix' ? '/' : '' }));
      row.appendChild(inp);
      row.appendChild(el('span', { class: 'num-unit', text: p.unit && p.unit !== 'prefix' ? p.unit : p.unit === 'prefix' ? 'prefix length' : '' }));
      wrap.appendChild(row);
      inp.addEventListener('input', function () { inp.value = inp.value.replace(/[^\d.,\/]/g, ''); setReady(parseNum(inp.value) != null); });
      inp.addEventListener('focus', function () { keepAboveKeyboard(inp); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!G.run.answered && parseNum(inp.value) != null) submit(); else if (G.run.answered) next(); } });
      var q = curQ();
      if (q.topic === 'cidr' || p.calc || /dbx-(aws|azure|scenario)/.test(q.topic)) {
        var det = el('details', { class: 'navcomp' });
        var rows = '';
        for (var pr = 16; pr <= 28; pr++) rows += '<tr><td>/' + pr + '</td><td>' + Math.pow(2, 32 - pr).toLocaleString() + '</td><td>' + (Math.pow(2, 32 - pr) - 5).toLocaleString() + '</td><td>' + (Math.pow(2, 32 - pr) - 4).toLocaleString() + '</td></tr>';
        det.innerHTML = '<summary>Nav computer · prefix table</summary><table><thead><tr><th>Prefix</th><th>Total</th><th>AWS / Azure (−5)</th><th>GCP (−4)</th></tr></thead><tbody>' + rows + '</tbody></table>';
        wrap.appendChild(det);
      }
      body.appendChild(wrap);
      setTimeout(function () { inp.focus({ preventScroll: true }); }, 50);
    },
    order: function (p, body) {
      $('#q-hint').innerHTML = U.touch() ? 'Drag a step, or use ▲ ▼' : 'Drag to reorder · or <kbd>1</kbd>–<kbd>' + p.items.length + '</kbd> pick, <kbd>↑</kbd><kbd>↓</kbd> move';
      var order;
      do { order = U.shuffle(p.items.map(function (_, k) { return k; })); } while (order.every(function (v, k) { return v === k; }) && p.items.length > 1);
      G.run.sel = order; G.run.orderPick = null;
      var list = el('ol', { class: 'order-list', 'aria-labelledby': 'q-prompt' });
      body.appendChild(list);
      ORDER_ROW = parseFloat(getComputedStyle(list).getPropertyValue('--order-row')) || 62;
      list.style.height = p.items.length * ORDER_ROW + 'px';
      p.items.forEach(function (txt, k) {
        var li = el('li', { class: 'order-item', 'data-k': k, tabindex: '0', html:
          '<span class="grip" aria-hidden="true"><i></i><i></i><i></i></span><span class="pos"></span><span class="txt">' + fmt(txt) + '</span>' +
          '<span class="mv"><button class="mv-up" aria-label="Move up" tabindex="-1">▲</button><button class="mv-dn" aria-label="Move down" tabindex="-1">▼</button></span>' });
        list.appendChild(li);
        li.querySelector('.mv-up').addEventListener('click', function (e) { e.stopPropagation(); moveOrder(k, -1); });
        li.querySelector('.mv-dn').addEventListener('click', function (e) { e.stopPropagation(); moveOrder(k, 1); });
        li.addEventListener('focus', function () { G.run.orderPick = k; layoutOrder(); });
        attachDrag(li, k, list);
      });
      layoutOrder();
      setReady(true);
    },
    diagram: function (p, body) {
      $('#q-hint').innerHTML = U.touch() ? 'Tap a component' : 'Click a component · or <kbd>1</kbd>–<kbd>' + p.diagram.nodes.length + '</kbd>';
      var wrap = el('div', { class: 'diagram-wrap', html: ONA.diagram.render(p.diagram, { interactive: true, numbered: true, idPrefix: 'q' }) });
      body.appendChild(wrap);
      $$('.node[data-node]', wrap).forEach(function (n) {
        n.addEventListener('click', function () { if (!G.run.answered) pickNode(n.dataset.node); });
        n.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); if (!G.run.answered) pickNode(n.dataset.node); } });
      });
    }
  };

  function pickMc(k) {
    G.run.sel = k; sfx.select();
    $$('#q-body .choice').forEach(function (b, i) { b.classList.toggle('sel', i === k); b.setAttribute('aria-checked', i === k ? 'true' : 'false'); });
    setReady(true);
  }
  function toggleMulti(k) {
    var s = G.run.sel, i = s.indexOf(k);
    if (i >= 0) s.splice(i, 1); else s.push(k);
    sfx.select();
    $$('#q-body .choice').forEach(function (b, j) { var on = s.indexOf(j) >= 0; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    setReady(s.length > 0);
  }
  function pickNode(id) {
    G.run.sel = id; sfx.select();
    $$('#q-body .node[data-node]').forEach(function (n) { n.classList.toggle('sel', n.dataset.node === id); n.setAttribute('aria-pressed', n.dataset.node === id ? 'true' : 'false'); });
    setReady(true);
  }

  function layoutOrder(skipK) {
    var order = G.run.sel;
    $$('#q-body .order-item').forEach(function (li) {
      var k = +li.dataset.k, pos = order.indexOf(k);
      if (k !== skipK) li.style.transform = 'translateY(' + pos * ORDER_ROW + 'px)';
      li.querySelector('.pos').textContent = pos + 1;
      li.classList.toggle('picked', G.run.orderPick === k);
    });
  }
  window.addEventListener('resize', function () {
    var list = $('#q-body .order-list'); if (!list || !G.run || !Array.isArray(G.run.sel)) return;
    var row = parseFloat(getComputedStyle(list).getPropertyValue('--order-row')) || 62;
    if (row === ORDER_ROW) return;
    ORDER_ROW = row; list.style.height = list.children.length * ORDER_ROW + 'px'; layoutOrder();
  });
  function moveOrder(k, dir) {
    if (G.run.answered) return;
    var o = G.run.sel, pos = o.indexOf(k), np = pos + dir;
    if (np < 0 || np >= o.length) return;
    o.splice(pos, 1); o.splice(np, 0, k);
    G.run.orderPick = k; sfx.select(); layoutOrder();
  }
  function attachDrag(li, k, list) {
    var startY = 0, startTop = 0, dragging = false, pid = null;
    li.addEventListener('pointerdown', function (e) {
      if (G.run.answered || e.target.closest('.mv')) return;
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; pid = e.pointerId; li.setPointerCapture(pid);
      startY = e.clientY; startTop = G.run.sel.indexOf(k) * ORDER_ROW;
      li.classList.add('dragging'); G.run.orderPick = k; layoutOrder(k);
      e.preventDefault();
    });
    li.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var scale = list.getBoundingClientRect().height / list.offsetHeight || 1;
      var top = U.clamp(startTop + (e.clientY - startY) / scale, -10, (G.run.sel.length - 1) * ORDER_ROW + 10);
      li.style.transform = 'translateY(' + top + 'px) scale(1.02)';
      var target = U.clamp(Math.round(top / ORDER_ROW), 0, G.run.sel.length - 1), o = G.run.sel, pos = o.indexOf(k);
      if (target !== pos) { o.splice(pos, 1); o.splice(target, 0, k); sfx.tick(); layoutOrder(k); }
    });
    function end() {
      if (!dragging) return;
      dragging = false; li.classList.remove('dragging');
      try { li.releasePointerCapture(pid); } catch (e) { /* already released */ }
      layoutOrder();
    }
    li.addEventListener('pointerup', end);
    li.addEventListener('pointercancel', end);
  }

  // Phones: the on-screen keyboard covers the lower ~half of the screen. Scroll the play area so a focused
  // field sits in the part that stays visible (visualViewport when the browser reports it, else the top half).
  function keepAboveKeyboard(inp) {
    if (!U.touch()) return;
    var scroller = inp.closest('.play'); if (!scroller) return;
    function fit() {
      if (document.activeElement !== inp) return;
      var vv = window.visualViewport, visible = vv ? Math.min(vv.height, window.innerHeight) : window.innerHeight;
      var limit = Math.min(visible - 16, window.innerHeight * 0.5), r = inp.getBoundingClientRect();
      if (r.bottom > limit) scroller.scrollTop += r.bottom - limit;
      else if (r.top < 70) scroller.scrollTop -= 70 - r.top;
    }
    setTimeout(fit, 60); setTimeout(fit, 400);
    if (window.visualViewport && !inp._vv) {
      inp._vv = true;
      window.visualViewport.addEventListener('resize', fit);
      inp.addEventListener('blur', function off() { window.visualViewport.removeEventListener('resize', fit); inp._vv = false; inp.removeEventListener('blur', off); });
    }
  }

  function parseNum(v) {
    var s = String(v || '').trim().replace(/[,\s]/g, '').replace(/^\//, '');
    if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  }

  // ------------------------------------------------------------------ grading
  function grade(p) {
    var run = G.run;
    switch (p.type) {
      case 'mc': return run.sel === p.answer;
      case 'multi': return U.sameSet(run.sel, p.answer);
      case 'numeric': return parseNum($('#num-input').value) === p.answer;
      case 'order': return run.sel.every(function (v, i) { return v === i; });
      case 'diagram': return run.sel === p.answer;
    }
    return false;
  }
  function ready(p) {
    var run = G.run;
    if (p.type === 'numeric') return parseNum(($('#num-input') || {}).value) != null;
    if (p.type === 'multi') return run.sel && run.sel.length > 0;
    if (p.type === 'order') return true;
    return run.sel !== null && run.sel !== undefined;
  }

  function submit() {
    var run = G.run; if (!run || run.answered || run.over) return;
    var q = curQ(), p = curPart();
    if (!ready(p)) { sfx.wrong(); return; }
    run.answered = true;
    run.qMs += Date.now() - run.partStart;
    var ok = grade(p);
    run.partScores[run.part] = ok ? 1 : 0;
    var card = $('#q-card');
    var gained = 0;
    if (ok) {
      run.streak++; run.bestStreak = Math.max(run.bestStreak, run.streak);
      var base = 40 + 30 * q.difficulty;
      if (q.type === 'multipart') base = Math.round(base * 0.75);
      var fast = q.type !== 'multipart' && Date.now() - run.partStart < 20000 ? 15 : 0;
      gained = Math.round((base * multFor(run.streak) * run.overdrive + fast) * (run.mode === 'mission' ? 1 : 0.5));
      run.xp += gained;
      sfx.correct();
      if (shipCtl) shipCtl.boost();                       // thruster boost + shield shimmer
      if (run.mode === 'repair' && shipCtl) {               // repair runs weld the module this question belongs to
        var wm = shipModOf(q);
        fx.sparks(shipCtl.weld(wm.id), '#ffd27a');
        announce('Welding the ' + wm.label + '.');
      }
      fx.burst($('#btn-submit') || card, { colors: [run.level ? run.level.accent : '#7cf7c3', '#7cf7c3', '#f6c453', '#ffffff'] });
      fx.floatText($('#hud-xp'), '+' + gained + ' XP', 'xp');
      fx.flash('good');
      if (run.maxShields && run.streak > 0 && run.streak % 5 === 0 && run.shields < run.maxShields) {
        run.shields++; setTimeout(function () { sfx.shieldUp(); fx.floatText($('#hud-shields'), 'Shield restored', 'shield'); }, 350);
      }
      if ([3, 6, 10].indexOf(run.streak) >= 0) setTimeout(function () { fx.floatText($('#hud-mult'), 'Streak ×' + multFor(run.streak), 'streak'); }, 200);
    } else {
      run.streak = 0;
      sfx.wrong();
      ONA.audio.duck(0.3, 2.4);   // keep the music low while the explanation is read (even with SFX off)
      fx.shake($('#screen-mission'));
      fx.flash('bad');
      if (run.maxShields) {
        run.shields = Math.max(0, run.shields - 1);
        ONA.starfield.danger(true); setTimeout(function () { if (!run.over && run.shields > 1) ONA.starfield.danger(false); }, 700);
      }
      // the hit lands on the module this topic maps to; damage accumulates through the run
      var hm = shipModOf(q);
      run.shipHits[hm.id] = (run.shipHits[hm.id] || 0) + 1;
      run.shipDmg[hm.id] = Math.min(3, Math.max(run.shipDmg[hm.id] || 0, 1) + 1);
      fx.sparks(shipCtl ? shipCtl.hit(hm.id, run.shipDmg[hm.id]) : $('#hud-shields'));
      announce('Hit: ' + hm.label + ' damaged.' + (run.maxShields ? ' Hull ' + run.shields + ' of ' + run.maxShields + '.' : ''));
    }
    revealAnswer(p, ok);
    showFeedback(q, p, ok, gained);
    renderHud();
    if (run.maxShields && run.shields === 1) ONA.starfield.danger(true, 'rgba(255,40,80,0.35)');
  }

  function revealAnswer(p, ok) {
    var run = G.run;
    $('#q-card').classList.add(ok ? 'is-correct' : 'is-wrong');
    if (p.type === 'mc') {
      $$('#q-body .choice').forEach(function (b, k) { b.disabled = true; if (k === p.answer) b.classList.add('correct'); else if (k === run.sel) b.classList.add('wrong'); });
    } else if (p.type === 'multi') {
      $$('#q-body .choice').forEach(function (b, k) {
        b.disabled = true;
        var want = p.answer.indexOf(k) >= 0, got = run.sel.indexOf(k) >= 0;
        if (want && got) b.classList.add('correct'); else if (want) b.classList.add('missed'); else if (got) b.classList.add('wrong');
      });
    } else if (p.type === 'numeric') {
      var inp = $('#num-input'); inp.readOnly = true;
      inp.parentNode.classList.add(ok ? 'correct' : 'wrong');
    } else if (p.type === 'order') {
      $$('#q-body .order-item').forEach(function (li) {
        var k = +li.dataset.k, pos = run.sel.indexOf(k);
        li.classList.add(pos === k ? 'correct' : 'wrong');
      });
    } else if (p.type === 'diagram') {
      $$('#q-body .node[data-node]').forEach(function (n) {
        n.setAttribute('tabindex', '-1');
        if (n.dataset.node === p.answer) n.classList.add('target'); else if (n.dataset.node === run.sel) n.classList.add('wrong');
      });
    }
    var b = $('#btn-submit'); if (b) b.remove();
  }

  function answerText(p) {
    switch (p.type) {
      case 'mc': return p.choices[p.answer];
      case 'multi': return p.answer.map(function (k) { return p.choices[k]; }).join(' · ');
      case 'numeric': return (p.unit === 'prefix' ? '/' : '') + p.answer.toLocaleString() + (p.unit && p.unit !== 'prefix' ? ' ' + p.unit : '');
      case 'diagram': var n = p.diagram.nodes.filter(function (x) { return x.id === p.answer; })[0]; return n.label + (n.sub ? ' (' + n.sub + ')' : '');
      case 'order': return null;
    }
  }

  function showFeedback(q, p, ok, gained) {
    var run = G.run, isMulti = q.type === 'multipart', last = !isMulti || run.part === q.parts.length - 1;
    var isUrl = function (u) { return typeof u === 'string' && /^https:\/\//.test(u); };
    // `source` = URL or citation text; `docs` = URL or array of URLs (one per cloud, plus references).
    var urls = [];
    [p.source, p.docs, q.source, q.docs].forEach(function (v) {
      (Array.isArray(v) ? v : [v]).forEach(function (u) { if (isUrl(u) && urls.indexOf(u) < 0) urls.push(u); });
    });
    var cite = [p.source, q.source].filter(function (c) { return c && !isUrl(c); })[0];
    var ans = answerText(p), hitLabel = shipModOf(q).label;
    var h = '<div class="fb-head"><span class="fb-badge">' + (ok ? '✓' : '✕') + '</span><div><div class="fb-verdict">' +
      (ok ? ['Link restored', 'Clean signal', 'Route confirmed', 'Nailed it'][Math.floor(Math.random() * 4)] : run.maxShields ? (run.shields ? 'Hull hit' : 'Hull breached') : 'Not quite') + '</div>' +
      '<div class="fb-sub">' + (ok ? '+' + gained + ' XP' + (run.streak >= 3 ? ' · afterburner ×' + multFor(run.streak) : '') + (run.mode === 'repair' ? ' · ' + esc(hitLabel) + ' welded' : '')
        : (run.maxShields ? (run.shields ? run.shields + ' hull point' + (run.shields === 1 ? '' : 's') + ' left' : 'Ship disabled after this answer') + ' · ' : '') + esc(hitLabel) + ' damaged, logged to Repair Bay') + '</div></div></div>';
    if (!ok && ans) h += '<p class="fb-answer"><span class="k">Correct answer</span>' + fmt(ans) + '</p>';
    if (!ok && p.type === 'order') h += '<ol class="fb-order">' + p.items.map(function (t) { return '<li>' + fmt(t) + '</li>'; }).join('') + '</ol>';
    h += '<p class="fb-explain">' + fmt(p.explain) + '</p>';
    if (isMulti && last) h += '<p class="fb-explain scenario"><span class="k">Scenario debrief</span>' + fmt(q.explain) + '</p>';
    // Concept figure + text (js/explainers.js): open after a miss, collapsed after a hit. Falls back to the legacy mini.
    var concept = ONA.explainers ? ONA.explainers.feedback(q, p, ok, isMulti ? run.part : -1) : '';
    var mini = !concept && (!isMulti || last) && q.mini ? ONA.diagram.mini(q.mini) : '';
    h += concept + (mini ? '<div class="fb-mini">' + mini + '</div>' : '');
    h += '<div class="fb-foot"><div class="sources">' +
      (cite ? '<span class="source std cite"><span class="k">Source</span>' + esc(cite) + '</span>' : '') +
      urls.map(function (u, k) {
        return '<a class="source" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + (cite || k ? '' : '<span class="k">Source</span>') + esc(shortHost(u)) + ' ↗</a>';
      }).join('') +
      (!cite && !urls.length ? '<span class="source std"><span class="k">Source</span>Standard networking fact</span>' : '') + '</div>' +
      '<button class="btn primary" id="btn-next" data-autofocus>' + (isMulti && !last ? 'Next step' : run.i === run.queue.length - 1 ? 'Finish' : 'Continue') + ' <kbd>Enter</kbd></button></div>';
    var f = $('#feedback');
    f.innerHTML = h;
    f.className = 'feedback open ' + (ok ? 'good' : 'bad');
    f.setAttribute('aria-live', 'polite');
    $('#btn-next').addEventListener('click', next);
    setTimeout(function () {
      var nb = $('#btn-next'); if (nb) nb.focus({ preventScroll: true });
      if (window.innerWidth < 1100) f.scrollIntoView({ behavior: U.reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }, 80);
  }

  function next() {
    var run = G.run; if (!run || !run.answered || run.over) return;
    var q = curQ();
    if (q.type === 'multipart' && run.part < q.parts.length - 1) {
      if (run.maxShields && run.shields <= 0) return finishQuestion();
      run.part++; renderQuestion(); return;
    }
    finishQuestion();
  }

  function finishQuestion() {
    var run = G.run, q = curQ();
    var score = run.partScores.reduce(function (a, b) { return a + (b || 0); }, 0) / partsOf(q).length;
    run.results[run.i] = score;
    run.answerMs += run.qMs;
    var wasBox = (store.state.questions[q.id] || {}).box || 0;
    var rec = store.recordAnswer(q, score, run.qMs);
    store.save();
    if (run.mode === 'repair' && shipCtl && wasBox > 0) {           // show the bay change on the ship
      var mod = shipModOf(q), bayNow = ONA.ship.baySeverity(store);
      run.shipDmg = bayNow; shipCtl.setDamage(bayNow);
      if (!bayNow[mod.id]) { shipCtl.repaired(mod.id); announce(mod.label + ' fully repaired.'); }
      else if (rec.box !== wasBox) announce(mod.label + ' patched: bay ' + wasBox + ' to ' + (rec.box || 'repaired') + '.');
    }
    run.i++; run.part = 0;
    if (run.maxShields && run.shields <= 0) return endRun('destroyed');
    if (run.i >= run.queue.length) return endRun('complete');
    if (run.i === run.twistAt) {
      $('#q-card').innerHTML = ''; $('#feedback').className = 'feedback';
      ONA.starfield.danger(true, 'rgba(255,60,120,0.4)');
      dialog(run.level.twist, { tag: 'Alert · mid-mission twist', twist: true, done: 'Engage overdrive' }).then(function () {
        if (G.run !== run) return;
        run.overdrive = 1.5;
        $('#screen-mission').classList.add('overdrive');
        if (run.shields > 1) ONA.starfield.danger(false);
        ONA.starfield.warp(500);
        toast('OVERDRIVE · ×1.5 XP for the rest of the mission', 'hot');
        renderQuestion();
      });
      return;
    }
    renderQuestion();
  }

  // ------------------------------------------------------------------ end of run / debrief
  function endRun(outcome) {
    var run = G.run; if (!run || run.over) return;
    run.over = true;
    clearInterval(run.timer);
    ONA.starfield.danger(false);
    var n = run.queue.length, answered = run.results.filter(function (r) { return r != null; }).length;
    var sum = run.results.reduce(function (a, b) { return a + (b || 0); }, 0);
    var acc = n ? sum / n : 0, accAnswered = answered ? sum / answered : 0;
    var stars = 0;
    if (run.mode === 'mission' && outcome === 'complete') stars = acc >= 0.9 ? 3 : acc >= 0.75 ? 2 : acc >= 0.5 ? 1 : 0;
    var info = { outcome: outcome, stars: stars, acc: acc, accAnswered: accAnswered, answered: answered, n: n, newBest: false, unlocked: null, prevStars: 0 };
    if (run.mode === 'mission') {
      var rec = store.levelRec(run.level.id), nl = nextLevel(run.level);
      var wasUnlocked = nl ? store.unlocked(nl) : true;
      info.prevStars = rec.bestStars;
      rec.plays++;
      if (stars > rec.bestStars) { rec.bestStars = stars; info.newBest = true; }
      if (outcome === 'complete' && acc > rec.bestAccuracy) rec.bestAccuracy = acc;
      if (run.xp > rec.bestScore) { rec.bestScore = run.xp; info.newBest = true; }
      if (nl && !wasUnlocked && store.unlocked(nl)) info.unlocked = nl;
    }
    store.state.xp += run.xp;
    store.state.bestStreak = Math.max(store.state.bestStreak, run.bestStreak);
    info.upgrade = store.claimShipUpgrade();       // stars earned a new cosmetic tier?
    store.addSession({
      id: run.id, ts: run.startTs, mode: run.mode, level: run.level ? run.level.id : null, n: n, answered: answered,
      score: +sum.toFixed(3), acc: +accAnswered.toFixed(4), xp: run.xp, ms: run.answerMs, stars: stars, outcome: outcome, bestStreak: run.bestStreak
    });
    var outro = run.mode === 'mission' && outcome === 'complete' && stars >= 1 ? run.level.outro : null;
    var tok = beginSeq(run);
    // open a dialog only if this run still owns the screen; mark it so cancelling the sequence closes it
    var seqDialog = function (lines, opts) {
      if (!tok.live()) return Promise.resolve();
      tok.inDialog = true;
      return dialog(lines, opts).then(function () { tok.inDialog = false; });
    };
    var pre = outcome === 'destroyed'
      ? powerDown(tok).then(function () {
        return seqDialog([{ who: 'null', text: 'HULL INTEGRITY ZERO. YOUR LINK IS MINE.' }, { who: 'vega', text: 'Your ship is disabled, Cadet. We\'re towing it to the Repair Bay. Weld those damaged modules, then fly again.' }], { tag: 'Ship disabled', twist: true, done: 'Return to base' });
      })
      : outcome === 'timeout'
        ? seqDialog([{ who: 'null', text: 'TIME IS A ROUTE YOU CANNOT TAKE BACK.' }, { who: 'vega', text: 'Out of time. Study the scenarios in the Repair Bay and come back faster.' }], { tag: 'Boss clock expired', twist: true, done: 'Debrief' })
        : outro ? seqDialog(outro, { tag: 'Mission debrief', done: 'Debrief' }) : Promise.resolve();
    if (outcome !== 'complete') sfx.fail();
    pre.then(function () {
      if (!tok.live()) return;                        // the player left or started another run: no stale debrief
      endSeq(tok);
      // Level cleared: the music plays a victory sting (instead of the SFX fanfare) and then settles into calm.
      info.stung = run.mode === 'mission' && outcome === 'complete' && info.stars >= 1 && ONA.music.sting();
      ONA.starfield.danger(false);
      renderDebrief(run, info); show('debrief'); animateStars(info.stars);
      if (info.upgrade) {
        var tu = ONA.ship.TIERS[info.upgrade.to];
        setTimeout(function () { sfx.shieldUp(); toast('Ship upgraded: ' + tu.name + ' · ' + tu.feature, 'good'); }, 900);
        announce('Ship upgraded to ' + tu.name + ': ' + tu.feature + '.');
      }
    });
  }
  G.endRun = endRun;

  function renderDebrief(run, info) {
    var title = info.outcome === 'destroyed' ? 'Ship disabled' : info.outcome === 'timeout' ? 'Out of time' : run.mode === 'mission' ? 'Mission complete' : run.mode === 'repair' ? 'Repairs complete' : 'Sim complete';
    var lvl = run.level;
    var missed = run.queue.filter(function (q, k) { return run.results[k] != null && run.results[k] < 1; });
    var avgMs = info.answered ? run.answerMs / info.answered : 0;
    var destroyed = info.outcome === 'destroyed', lo = ONA.ship.loadout(store);
    var hitMods = ONA.ship.modulesForQuestions(missed), hitDmg = {};
    hitMods.forEach(function (m) { hitDmg[m.id] = Math.min(3, 1 + m.count); });
    var dbArt = destroyed
      ? '<div class="db-art db-wreck">' + ONA.ship.svg({ loadout: lo, damage: run.shipDmg || hitDmg, disabled: true, shield: 0 }) + '</div>'
      : '<div class="db-art">' + (lvl ? art.planet(lvl.art) : art.planet('station')) + '</div>';
    var damageHtml = '';
    if (missed.length) {
      damageHtml = '<div class="db-missed"><div class="k">' + missed.length + ' sent to Repair Bay · ' + hitMods.length + ' module' + (hitMods.length === 1 ? '' : 's') + ' damaged</div>' +
        '<div class="db-damage">' +
        (destroyed ? '' : '<div class="db-ship">' + ONA.ship.svg({ loadout: lo, damage: hitDmg, stagger: hitMods.map(function (m) { return m.id; }), shield: 0, cls: 'docked db-dmg-ship' }) + '</div>') +
        '<ul class="db-mods">' + hitMods.map(function (m, i) {
          return '<li class="sev-' + hitDmg[m.id] + '" style="--d:' + (0.35 + i * 0.28).toFixed(2) + 's"><span class="dot"></span><div><b>' + esc(m.label) + '</b><span>' + esc(m.topics.join(', ')) + (m.count > 1 ? ' · ×' + m.count : '') + '</span></div></li>';
        }).join('') + '</ul></div>' +
        '<details class="db-qs"><summary>Show the ' + missed.length + ' question' + (missed.length === 1 ? '' : 's') + '</summary><ul>' + missed.map(function (q) { return '<li><span class="chip ghost">' + esc(U.topicLabel(q.topic)) + '</span>' + fmt(q.prompt.length > 110 ? q.prompt.slice(0, 107) + '…' : q.prompt) + '</li>'; }).join('') + '</ul></details></div>';
    }
    var up = info.upgrade ? ONA.ship.TIERS[info.upgrade.to] : null;
    var upHtml = up ? '<div class="db-upgrade"><div class="db-up-ship">' + ONA.ship.svg({ loadout: lo, shield: 0.55, cls: 'upgraded' }) + '</div><div><span class="k">Ship upgraded · Tier ' + (info.upgrade.to + 1) + '</span><b>' + esc(up.name) + '</b><span>' + esc(up.feature) + '</span></div></div>' : '';
    var h = '<div class="db-wrap" style="--accent:' + (lvl ? lvl.accent : '#7cf7c3') + '">' +
      dbArt +
      '<div class="db-main glass">' +
      '<div class="eyebrow">' + esc(lvl ? lvl.name : 'Repair Bay') + ' · ' + (run.mode === 'mission' ? 'Debrief' : run.mode === 'repair' ? 'Leitner review' : 'Training sim') + '</div>' +
      '<h1 class="db-title ' + (info.outcome === 'complete' ? '' : 'bad') + '">' + title + '</h1>' +
      (destroyed ? '<p class="db-sub">Hull integrity 0%. NULL ROUTE cut the link and your ship was towed to the Repair Bay.</p>' : '') +
      upHtml +
      (run.mode === 'mission' ? '<div class="db-stars" id="db-stars">' + [0, 1, 2].map(function () { return art.starIcon(false); }).join('') + '</div>' : '') +
      (info.newBest && info.stars ? '<div class="badge-new">New personal best</div>' : '') +
      '<div class="db-stats">' +
      stat('Accuracy', Math.round(info.acc * 100) + '%', info.answered < info.n ? Math.round(info.accAnswered * 100) + '% of answered' : info.answered + ' questions') +
      stat('XP earned', '+' + run.xp.toLocaleString(), run.mode === 'mission' ? 'full XP' : 'practice ½ XP') +
      stat('Best streak', run.bestStreak, 'in a row') +
      stat('Avg time', U.fmtSec(avgMs), 'per question') +
      (run.maxShields ? stat('Hull', Math.round((100 * run.shields) / run.maxShields) + '%', run.shields + ' of ' + run.maxShields + ' hull points') : '') +
      '</div>' +
      (info.unlocked ? '<div class="db-unlock">' + art.planet(info.unlocked.art) + '<div><span class="k">New world unlocked</span><b>' + esc(info.unlocked.name) + '</b></div></div>' : '') +
      (run.mode === 'mission' && info.outcome === 'complete' && info.stars < 2 ? '<p class="db-tip">Score <b>75%+</b> for ' + starsHtml(2) + ' to unlock the next world.</p>' : '') +
      damageHtml +
      '<div class="db-actions">' +
      '<button class="btn primary big" id="db-map" data-autofocus>Galaxy map <kbd>Enter</kbd></button>' +
      (run.mode === 'mission' ? '<button class="btn ghost" id="db-retry">Retry mission</button>' : '') +
      (store.bay().due.length ? '<button class="btn ghost" id="db-bay">Repair Bay (' + store.bay().due.length + ')</button>' : '') +
      '</div></div></div>';
    $('#screen-debrief').innerHTML = h;
    if (hitMods.length) announce(hitMods.length + ' module' + (hitMods.length === 1 ? '' : 's') + ' damaged: ' + hitMods.map(function (m) { return m.label; }).join(', ') + '.');
    $('#db-map').addEventListener('click', function () { G.run = null; show('map'); });
    var r = $('#db-retry'); if (r) r.addEventListener('click', function () { startRun(lvl, 'mission'); });
    var b = $('#db-bay'); if (b) b.addEventListener('click', function () { G.run = null; show('bay'); });
    if (info.outcome === 'complete' && (run.mode !== 'mission' || info.stars >= 1)) setTimeout(function () { if (!info.stung) sfx.fanfare(); fx.burst($('.db-title'), { n: 120, power: 700 }); }, 250);
  }
  function stat(k, v, sub) { return '<div class="stat"><span class="k">' + esc(k) + '</span><b>' + esc(String(v)) + '</b><span class="s">' + esc(sub) + '</span></div>'; }

  function animateStars(n) {
    var stars = $$('#db-stars .star-ico');
    stars.forEach(function (s, i) {
      if (i >= n) return;
      setTimeout(function () { s.classList.add('on', 'pop'); sfx.star(i); fx.burst(s, { n: 30, power: 260, colors: ['#f6c453', '#fff3c4', '#ffffff'] }); }, U.reducedMotion() ? 0 : 500 + i * 380);
    });
  }

  // ------------------------------------------------------------------ Repair Bay
  function renderBay() {
    var bay = store.bay(), all = store.bayAll();
    var labels = ['', 'Critical', 'Damaged', 'Patched', 'Stable', 'Nearly repaired'];
    var hrs = store.BOX_HOURS;
    var lo = ONA.ship.loadout(store), mods = ONA.ship.damagedModules(store), tier = lo.tier;
    var h = '<div class="page-head"><div><div class="eyebrow">Hangar · spaced repetition</div><h1 class="page-title">Repair Bay</h1>' +
      '<p class="page-sub">Every question you miss damages one module of your ship and docks here in bay 1. Answer it on a repair run and the module gets welded up a bay. Bays come back for review later (now → 4h → 1d → 3d → 7d), and clearing bay 5 fully repairs the part. Miss it again and it drops back to bay 1.</p></div>' +
      '<div class="bay-cta"><button class="btn primary big" id="bay-start" data-autofocus ' + (bay.due.length ? '' : 'disabled') + '>Start repair run · ' + Math.min(bay.due.length, REPAIR_SIZE) + ' due</button>' +
      '<button class="btn ghost" id="bay-all" ' + (all.length ? '' : 'disabled') + ' title="Practice every damaged part now. Hits only move a part up a bay once its review is due.">Drill all damaged (' + all.length + ')</button></div></div>';
    // the docked ship, one labelled callout per damaged module
    h += '<section class="hangar glass" id="hangar">' + ONA.ship.hangar(lo, mods) + '</section>';
    var main = ONA.LEVELS.filter(function (l) { return !l.bonus; });
    var cleared = lo.decals.map(function (d) { return d.id; });
    h += '<div class="hangar-grid">' +
      '<section class="glass card hangar-card"><h3 class="card-title">Hangar <span class="muted">Tier ' + (tier.index + 1) + ' of ' + ONA.ship.TIERS.length + '</span></h3>' +
      '<div class="hc-class"><span class="k">Ship class</span><b>' + esc(tier.name) + '</b><span>' + esc(tier.feature) + '</span></div>' +
      (tier.next
        ? '<div class="hc-next"><span class="k">Next upgrade</span><b>' + esc(tier.next.name) + '</b><span>' + esc(tier.next.feature) + '. Unlocks at ' + tier.next.stars + '★, you have ' + tier.stars + '★.</span>' +
          '<div class="hc-bar"><span style="--v:' + (tier.stars / tier.next.stars).toFixed(3) + '"></span></div></div>'
        : '<div class="hc-next max"><span class="k">Next upgrade</span><b>Fully upgraded</b><span>Every tier unlocked.</span></div>') +
      '<div class="hc-decals"><span class="k">Hull decals · one per world cleared (1★+)</span><div class="decal-row">' +
      main.map(function (l) { var on = cleared.indexOf(l.id) >= 0; return '<span class="decal-chip' + (on ? ' on' : '') + '" style="--accent:' + l.accent + '"><i></i>' + esc(l.name) + '</span>'; }).join('') + '</div></div>' +
      '<ol class="hc-tiers">' + ONA.ship.TIERS.map(function (t, k) {
        return '<li class="' + (k <= tier.index ? 'got' : '') + (k === tier.index ? ' cur' : '') + '"><b>' + esc(t.name) + '</b><span>' + t.stars + '★ · ' + esc(t.feature) + '</span></li>';
      }).join('') + '</ol>' +
      '<div class="hc-stat"><span class="k">Modules fully repaired</span><b>' + store.state.ship.repairs + '</b></div></section>' +
      '<section class="glass card modules-card"><h3 class="card-title">Damaged modules <span class="muted">' + mods.length + ' of ' + ONA.ship.MODULES.length + '</span></h3>' +
      (mods.length
        ? '<ul class="mod-list">' + mods.map(function (m) {
            return '<li class="sev-' + m.sev + '" data-mod="' + m.id + '"><span class="sev-pip"></span><div><b>' + esc(m.label) + '</b><span>' + esc(m.topics.join(', ')) + '</span></div><span class="mod-count">' + m.count + ' part' + (m.count === 1 ? '' : 's') + ' · bay ' + m.worstBox + '</span></li>';
          }).join('') + '</ul><p class="mod-legend"><span class="sev-3">smoking: bay 1</span><span class="sev-2">cracked: bay 2–3</span><span class="sev-1">scorched: bay 4–5</span></p>'
        : '<p class="empty">Every module is pristine. Fly a mission: any question you miss damages the module for its topic.</p>') +
      '</section></div>';
    h += '<div class="bays">';
    for (var b = 1; b <= 5; b++) {
      var c = bay.boxes[b];
      h += '<div class="bay glass b' + b + '"><div class="bay-num">BAY ' + b + '</div><div class="bay-count">' + c + '</div><div class="bay-label">' + labels[b] + '</div>' +
        '<div class="bay-int">' + (hrs[b] ? 'review every ' + (hrs[b] >= 24 ? hrs[b] / 24 + 'd' : hrs[b] + 'h') : 'review now') + '</div>' +
        '<div class="bay-bar"><span style="--v:' + (bay.total ? c / bay.total : 0) + '"></span></div>' +
        '<svg class="drone" viewBox="0 0 60 40" aria-hidden="true"><ellipse cx="30" cy="22" rx="18" ry="8"/><path d="M12 22H4M48 22h8M30 14V6"/><circle cx="30" cy="5" r="2.4" class="blink"/></svg></div>';
    }
    h += '</div>';
    $('#screen-bay').innerHTML = '<div class="page">' + h + '</div>';
    var s = $('#bay-start');
    s.addEventListener('click', function () {
      var due = U.shuffle(store.bay().due).slice(0, REPAIR_SIZE).map(U.qById);
      startRun(null, 'repair', due, 'Repair run');
    });
    $('#bay-all').addEventListener('click', function () {
      startRun(null, 'repair', U.shuffle(store.bayAll()).slice(0, 20).map(U.qById), 'Drill all damaged');
    });
  }

  // ------------------------------------------------------------------ Captain's Log
  function renderLog() {
    var t = store.totals(), rk = store.rank(t.xp);
    var topics = store.topicStats(), types = store.typeStats();
    var sessions = store.state.sessions.slice(-20);
    var main = ONA.LEVELS.filter(function (l) { return !l.bonus; });
    // per-sector accuracy (radar)
    var bySector = store.levelStats();
    var radarAxes = ONA.LEVELS.filter(function (l) { return !l.bonus || (bySector[l.id] && bySector[l.id].possible); }).map(function (l) {
      var s = bySector[l.id]; return { label: l.name, value: s ? s.acc : null };
    });
    var tried = topics.filter(function (s) { return s.possible > 0; });
    var weakest = tried.slice().sort(function (a, b) { return a.acc - b.acc || b.seen - a.seen; }).filter(function (s) { return s.acc < 1; }).slice(0, 5);
    var topicRows = tried.slice().sort(function (a, b) { return a.acc - b.acc; }).map(function (s) { return { label: U.topicLabel(s.topic), value: s.acc, note: Math.round(s.acc * 100) + '% · ' + s.possible }; });
    var maxMs = 1;
    Object.keys(types).forEach(function (k) { if (types[k].seen) maxMs = Math.max(maxMs, types[k].ms / types[k].seen); });
    var typeRows = Object.keys(TYPE_LABEL).filter(function (k) { return types[k] && types[k].seen; }).map(function (k) {
      var avg = types[k].ms / types[k].seen; return { label: TYPE_LABEL[k], value: avg / maxMs, note: U.fmtSec(avg), tone: 'info' };
    });
    var trend = sessions.map(function (s, i) {
      var l = U.level(s.level);
      return { value: s.acc, label: new Date(s.ts).toLocaleString() + ' · ' + (s.mode === 'mission' && l ? l.name : s.mode), short: String(store.state.sessions.length - sessions.length + i + 1) };
    });
    var avgMs = t.seen ? t.ms / t.seen : 0;

    var h = '<div class="page-head"><div><div class="eyebrow">Flight telemetry</div><h1 class="page-title">Captain\'s Log</h1>' +
      '<p class="page-sub">' + esc(rk.name) + ' · ' + t.sessions + ' sorties logged. Accuracy = credit earned ÷ graded attempts. Scenario questions earn partial credit per step (2 of 3 steps = 0.67).</p></div>' +
      '<div class="log-actions"><button class="btn ghost" id="log-export">Export JSON</button><label class="btn ghost" for="log-import-file">Import JSON</label><input type="file" id="log-import-file" accept="application/json,.json" hidden>' +
      '<button class="btn danger ghost" id="log-reset">Reset progress</button></div></div>';
    h += '<div class="kpis">' +
      kpi('Accuracy', t.possible ? Math.round(100 * t.acc) + '%' : '—', fmtScore(t.earned) + ' / ' + t.possible + ' earned') +
      kpi('Answered', t.seen, 'graded attempts') +
      kpi('Avg time', t.seen ? U.fmtSec(avgMs) : '—', 'per question') +
      kpi('Best streak', t.bestStreak, 'all-time') +
      kpi('XP', t.xp.toLocaleString(), rk.name) +
      kpi('Stars', t.stars + ' / ' + main.length * 3, 'mission ratings') + '</div>';
    h += '<div class="log-grid">' +
      '<section class="glass card radar-card"><h3 class="card-title">Accuracy by sector</h3>' + ONA.charts.radar(radarAxes, { label: 'Accuracy by sector' }) + '</section>' +
      '<section class="glass card trend-card"><h3 class="card-title">Accuracy trend <span class="muted">last ' + sessions.length + ' sorties</span></h3>' + ONA.charts.line(trend, { label: 'Accuracy trend over sessions' }) + '</section>' +
      '<section class="glass card weak-card"><h3 class="card-title">Weakest 5 topics</h3>' +
      (weakest.length ? '<ol class="weak">' + weakest.map(function (s) {
        return '<li><span class="w-name">' + esc(U.topicLabel(s.topic)) + '</span><span class="w-acc ' + (s.acc < 0.6 ? 'bad' : 'ok') + '">' + Math.round(s.acc * 100) + '%</span><button class="btn tiny" data-drill="' + s.topic + '">Drill</button></li>';
      }).join('') + '</ol><button class="btn primary" id="drill-weak">Drill all 5 weak topics</button>' : '<p class="empty">No weak spots yet. Fly a few missions.</p>') + '</section>' +
      '<section class="glass card best-card"><h3 class="card-title">Best scores</h3><table class="best"><thead><tr><th>World</th><th>Stars</th><th>Acc.</th><th>XP</th><th>Runs</th></tr></thead><tbody>' +
      ONA.LEVELS.map(function (l) {
        var r = store.levelRec(l.id);
        return '<tr style="--accent:' + l.accent + '"><td><span class="dot"></span>' + esc(l.name) + '</td><td>' + (l.bonus ? '—' : starsHtml(r.bestStars)) + '</td><td>' + (r.plays ? Math.round(r.bestAccuracy * 100) + '%' : '—') + '</td><td>' + (r.bestScore || '—') + '</td><td>' + r.plays + '</td></tr>';
      }).join('') + '</tbody></table></section>' +
      '<section class="glass card topics-card"><h3 class="card-title">Accuracy per topic <span class="muted">weakest first</span></h3>' + ONA.charts.bars(topicRows, { empty: 'Answer questions to chart topics.' }) + '</section>' +
      '<section class="glass card time-card"><h3 class="card-title">Time per question <span class="muted">by type</span></h3>' + ONA.charts.bars(typeRows, { empty: 'No timings yet.' }) + '</section>' +
      (ONA.journeys ? ONA.journeys.logCard() : '') +
      '</div>';
    $('#screen-log').innerHTML = '<div class="page">' + h + '</div>';

    $('#log-export').addEventListener('click', function () {
      U.download('orbital-network-academy-progress-' + new Date().toISOString().slice(0, 10) + '.json', store.exportJSON());
      toast('Progress exported');
    });
    $('#log-import-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { store.importJSON(rd.result); toast('Progress imported', 'good'); applySettings(); renderLog(); renderTopbar(); }
        catch (err) { toast('Import failed: ' + err.message, 'bad'); }
      };
      rd.readAsText(f);
    });
    $('#log-reset').addEventListener('click', function () {
      confirmBox('Reset all progress?', 'This wipes XP, stars, Repair Bay and the Captain\'s Log on this device. Export first if you want a backup.', 'Reset everything', true).then(function (yes) {
        if (!yes) return; store.reset(); toast('Progress reset'); renderLog(); renderTopbar();
      });
    });
    $$('[data-drill]').forEach(function (b) { b.addEventListener('click', function () { drillTopics([b.dataset.drill], U.topicLabel(b.dataset.drill)); }); });
    var dw = $('#drill-weak'); if (dw) dw.addEventListener('click', function () { drillTopics(weakest.map(function (s) { return s.topic; }), 'Weak-spot drill'); });
  }
  function fmtScore(x) { return Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(1); }
  function kpi(k, v, s) { return '<div class="kpi glass"><span class="k">' + esc(k) + '</span><b>' + esc(String(v)) + '</b><span class="s">' + esc(s) + '</span></div>'; }

  function drillTopics(topics, label) {
    var qs = ONA.QUESTIONS.filter(function (q) { return topics.indexOf(q.topic) >= 0; });
    startRun(null, 'drill', U.shuffle(qs).slice(0, DRILL_SIZE), 'Drill · ' + label);
  }

  // ------------------------------------------------------------------ settings
  function openSettings() {
    var s = store.state.settings;
    modal('<h2 class="modal-title">Ship settings</h2>' +
      toggleRow('set-free', 'Free roam', 'Unlock every world, whatever your star ratings.', s.freeRoam) +
      toggleRow('set-sound', 'All sound', 'Master switch for music and effects<span class="kbd-only"> (<kbd>M</kbd>)</span>. Everything is synthesized in the browser.', !s.muted) +
      audioRow('music', 'Music', 'Ambient soundtrack that shifts with each area<span class="kbd-only"> (<kbd>N</kbd>)</span>.') +
      audioRow('sfx', 'Sound effects', 'Answer, warp and UI sounds.') +
      '<div class="set-row"><div><b>Motion</b><span>Auto follows your OS "reduce motion" setting.</span></div><div class="seg" role="radiogroup" aria-label="Motion">' +
      ['auto', 'reduce', 'full'].map(function (m) { return '<button role="radio" aria-checked="' + (s.motion === m) + '" data-motion="' + m + '" class="' + (s.motion === m ? 'on' : '') + '">' + { auto: 'Auto', reduce: 'Reduced', full: 'Full' }[m] + '</button>'; }).join('') + '</div></div>' +
      '<h3 class="modal-sub kbd-only">Keyboard</h3><ul class="keys kbd-only"><li><kbd>1</kbd>–<kbd>9</kbd> pick an answer or diagram node</li><li><kbd>Enter</kbd> lock in / continue / launch</li><li><kbd>↑</kbd><kbd>↓</kbd> move the picked step in sequence questions</li><li><kbd>←</kbd><kbd>→</kbd> cycle worlds on the galaxy map</li><li><kbd>M</kbd> mute all · <kbd>N</kbd> music on/off · <kbd>Esc</kbd> pause / close</li></ul>' +
      '<div class="modal-actions"><button class="btn primary" data-close data-autofocus>Done</button></div>');
    var b = $('#modal-body');
    $('#set-free').addEventListener('change', function (e) { store.setting('freeRoam', e.target.checked); if (G.screen === 'map') renderMap(); });
    $('#set-sound').addEventListener('change', function (e) { store.setting('muted', !e.target.checked); startAudio(); applyAudio(); syncAudioControls(); if (e.target.checked) sfx.click(); });
    ['music', 'sfx'].forEach(function (k) {
      $('#set-' + k).addEventListener('change', function (e) { store.setting(k, e.target.checked); startAudio(); applyAudio(); syncAudioControls(); if (k === 'sfx' && e.target.checked) sfx.click(); });
      var range = $('#set-' + k + '-vol');
      // live while dragging (no save per pixel), saved once on release
      range.addEventListener('input', function () { store.setting(k + 'Vol', range.value / 100, { noSave: true }); startAudio(); ONA.audio.apply(); syncAudioControls(); });
      range.addEventListener('change', function () { store.setting(k + 'Vol', range.value / 100); if (k === 'sfx') sfx.select(); });
    });
    syncAudioControls();
    $$('[data-motion]', b).forEach(function (btn) {
      btn.addEventListener('click', function () {
        store.setting('motion', btn.dataset.motion);
        $$('[data-motion]', b).forEach(function (x) { x.classList.toggle('on', x === btn); x.setAttribute('aria-checked', x === btn); });
        applySettings();
      });
    });
  }
  function audioRow(key, label, desc) {
    var s = store.state.settings, vol = Math.round(s[key + 'Vol'] * 100);
    return '<div class="set-row audio-row"><label class="set-main" for="set-' + key + '"><div><b>' + label + '</b><span>' + desc + '</span></div>' +
      '<input type="checkbox" class="switch" id="set-' + key + '" ' + (s[key] ? 'checked' : '') + '></label>' +
      '<div class="vol"><input type="range" class="range" min="0" max="100" step="1" value="' + vol + '" id="set-' + key + '-vol" aria-label="' + label + ' volume" style="--v:' + vol + '%">' +
      '<output for="set-' + key + '-vol" id="set-' + key + '-vol-out">' + vol + '%</output></div></div>';
  }
  // Keep switches, sliders and the "muted by All sound" dimming in step with settings (also after M / N).
  function syncAudioControls() {
    if (!G.modalOpen || !$('#set-music')) return;
    var s = store.state.settings;
    $('#set-sound').checked = !s.muted;
    ['music', 'sfx'].forEach(function (k) {
      var vol = Math.round(s[k + 'Vol'] * 100), r = $('#set-' + k + '-vol');
      $('#set-' + k).checked = s[k];
      r.value = vol; r.style.setProperty('--v', vol + '%');
      $('#set-' + k + '-vol-out').textContent = vol + '%';
      r.closest('.audio-row').classList.toggle('dim', s.muted || !s[k]);
    });
  }
  function toggleRow(id, label, desc, on) {
    return '<label class="set-row" for="' + id + '"><div><b>' + label + '</b><span>' + desc + '</span></div><input type="checkbox" class="switch" id="' + id + '" ' + (on ? 'checked' : '') + '></label>';
  }
  function applySettings() {
    document.documentElement.classList.toggle('reduce-motion', U.reducedMotion());
    document.documentElement.classList.toggle('motion-full', store.state.settings.motion === 'full');
    ONA.starfield.motion();
    applyAudio();
  }

  function pauseMenu() {
    var run = G.run;
    modal('<h2 class="modal-title">Paused</h2><p class="modal-text">' + esc(run.level ? run.level.name : 'Repair Bay') + ' · question ' + (run.i + 1) + ' of ' + run.queue.length + (run.timeLimit ? '. The boss clock is frozen while paused.' : '') + '</p>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="abort">Abort to map</button><button class="btn primary" data-close data-autofocus>Resume</button></div>');
    $('#modal-body [data-act="abort"]').addEventListener('click', function () {
      clearInterval(run.timer); run.over = true; G.run = null; closeModal(); ONA.starfield.danger(false); show('map');
    });
  }

  // ------------------------------------------------------------------ keyboard
  // Letter shortcuts (M, N) and answer keys are suppressed while a form control has focus: text and numeric
  // inputs, volume sliders (range), textarea, select and contenteditable. Explicit exception: checkboxes (the
  // Settings switches), which never consume letter keys, so M / N still work while one is focused.
  function isFormField(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return (t.type || 'text').toLowerCase() !== 'checkbox';
    return false;
  }
  G.isFormField = isFormField;

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === 'Tab' && (G.dialogOpen || G.modalOpen)) { trapTab(e); return; }
    var typing = isFormField(e.target);
    if (k === 'm' || k === 'M') { if (!typing) { toggleMute(); return; } }
    if (k === 'n' || k === 'N') { if (!typing) { toggleMusic(); return; } }
    if (G.dialogOpen) {
      if (k === 'Enter' || k === ' ') { e.preventDefault(); G.dialogAdvance && G.dialogAdvance(); }
      else if (k === 'Escape') { G.dialogClose && G.dialogClose(); }
      return;
    }
    if (G.modalOpen) { if (k === 'Escape') closeModal(); return; }
    if (G.screen === 'title') { if (k === 'Enter' || k === ' ') { e.preventDefault(); begin(); } return; }
    if (G.screen === 'map') {
      var lv = ONA.LEVELS.slice().sort(function (a, b) { return a.id - b.id; }), idx = lv.findIndex(function (l) { return l.id === G.selected; });
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); selectLevel(lv[(idx + 1) % lv.length].id, true); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); selectLevel(lv[(idx - 1 + lv.length) % lv.length].id, true); }
      else if (/^[1-9]$/.test(k) && U.level(+k)) selectLevel(+k, true);
      else if (k === 'Enter' && !(e.target.closest && e.target.closest('button, .planet'))) { e.preventDefault(); launchSelected(); }
      return;
    }
    if (G.screen === 'debrief') {
      if (k === 'Enter' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); $('#db-map') && $('#db-map').click(); }
      return;
    }
    if (G.screen !== 'mission' || !G.run) { if (k === 'Escape' && G.screen !== 'map') show('map'); return; }
    var run = G.run;
    if (k === 'Escape') { pauseMenu(); return; }
    if (typing) return;
    if (k === 'Enter') {
      if (e.target.closest && e.target.closest('.hud button, .mv button, a, summary')) return;
      e.preventDefault();
      if (run.answered) next(); else submit();
      return;
    }
    if (run.answered || !$('#q-body')) return;
    var p = curPart();
    if (/^[1-9]$/.test(k)) {
      var n = +k - 1;
      if (p.type === 'mc' && n < p.choices.length) pickMc(n);
      else if (p.type === 'multi' && n < p.choices.length) toggleMulti(n);
      else if (p.type === 'diagram' && n < p.diagram.nodes.length) pickNode(p.diagram.nodes[n].id);
      else if (p.type === 'order' && n < p.items.length) { run.orderPick = run.sel[n]; sfx.select(); layoutOrder(); }
    } else if (p.type === 'order' && (k === 'ArrowUp' || k === 'ArrowDown') && run.orderPick != null) {
      e.preventDefault(); moveOrder(run.orderPick, k === 'ArrowUp' ? -1 : 1);
    }
  }

  // M / mute button: mute-all (music + SFX). The music and SFX settings underneath are kept.
  function toggleMute() {
    var muted = store.setting('muted', !store.state.settings.muted);
    var firstMusic = startAudio({ quiet: true });
    applyAudio(); syncAudioControls();
    if (!muted) sfx.click();
    toast(muted ? 'All sound off · M to turn back on' : firstMusic ? MUSIC_ON_TOAST : 'Sound on');
  }

  // N: music only. If everything is muted, turning music on also lifts the mute-all.
  function toggleMusic() {
    var s = store.state.settings, on = !(s.music && !s.muted);
    store.setting('music', on);
    if (on && s.muted) store.setting('muted', false);
    var firstMusic = startAudio({ quiet: true });
    applyAudio(); syncAudioControls();
    toast(on ? (firstMusic ? MUSIC_ON_TOAST : 'Music on') : 'Music off · N to turn back on');
  }
  G.toggleMusic = toggleMusic;

  function begin() {
    startAudio(); sfx.click();
    ONA.starfield.warp(700);
    show('map');
  }

  // ------------------------------------------------------------------ boot
  G.init = function () {
    syncInert();
    applySettings();
    initTitle();
    $('#btn-begin').addEventListener('click', begin);
    $$('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { sfx.click(); var go = b.dataset.go; if (G.run && !G.run.over) return; show(go); });
    });
    $$('.settings-btn').forEach(function (b) { b.addEventListener('click', function () { sfx.click(); openSettings(); }); });
    $$('.mute-btn').forEach(function (b) { b.addEventListener('click', toggleMute); });
    $('#hud-pause').addEventListener('click', pauseMenu);
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', onKey);
    // Autoplay rules: audio may only start from a user gesture. The first pointer or key press starts it.
    // Capture phase, so it runs before onKey: M/N on the very first press then act on a live context.
    function firstGesture(e) {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab' || e.key === 'Shift')) return;
      document.removeEventListener('pointerdown', firstGesture, true);
      document.removeEventListener('keydown', firstGesture, true);
      // let the M/N handler decide what plays (unless a form field swallows the key: then start normally)
      if (e.type === 'keydown' && /^[mMnN]$/.test(e.key) && !isFormField(e.target)) { sfx.unlock(); return; }
      startAudio();
    }
    document.addEventListener('pointerdown', firstGesture, true);
    document.addEventListener('keydown', firstGesture, true);
    function resumeOnActivation(e) {
      if (!e.isTrusted) return;   // only real taps / clicks are user activation; scripted clicks never start audio
      var c = ONA.audio.ctx;
      if (!c || c.state !== 'suspended' || document.hidden) return;
      startAudio();
    }
    document.addEventListener('touchend', resumeOnActivation, true);
    document.addEventListener('click', resumeOnActivation, true);
    var start = (location.hash || '').replace('#', '');
    show(['map', 'log', 'bay'].indexOf(start) >= 0 ? start : 'title');
  };
})(window.ONA);
