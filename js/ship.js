/* The player's ship: data, pure logic, inline-SVG renderer, mission controller, hangar scene.
 *
 *  - MODULES: every question topic maps to one ship module ("NAT Thruster", "DNS Antenna", …).
 *    A question sitting in the Repair Bay = a damaged module; its worst Leitner bay sets the severity.
 *  - TIERS: cosmetic upgrades unlocked by total stars (plating, fins, nacelles + gold plasma, gold trim + halo).
 *    Every world cleared (1★+) adds a hull decal in that world's colour.
 *  - svg(): one ship drawing reused on the title, galaxy map, mission panel, debrief and hangar,
 *    so the tier always matches. Decorative: aria-hidden; game.js announces damage/repairs in a live region.
 *  - Animation is CSS only (transform / opacity), no animated filters, so the starfield never stutters.
 */
(function (ONA) {
  'use strict';
  var SHIP = (ONA.ship = {});
  var VB = { x: -180, y: -64, w: 310, h: 128 };
  SHIP.VIEWBOX = VB.x + ' ' + VB.y + ' ' + VB.w + ' ' + VB.h;

  // ---------------------------------------------------------------- data
  SHIP.MODULES = [
    { id: 'antenna', label: 'DNS Antenna', topics: ['dns', 'hybrid-dns'], at: [15, -32] },
    { id: 'comms', label: 'TLS Comms Array', topics: ['tls', 'proxy'], at: [42, -22] },
    { id: 'bridge', label: 'Command Bridge', topics: ['dbx-scenario'], at: [66, -10] },
    { id: 'nav', label: 'Subnet Nav Computer', topics: ['cidr'], at: [76, 12] },
    { id: 'hull', label: 'VPC Hull Plating', topics: ['dbx-aws-vpc', 'dbx-azure-vnet', 'dbx-gcp-vpc'], at: [18, 4] },
    { id: 'router', label: 'Routing Core', topics: ['routing', 'osi'], at: [-16, -4] },
    { id: 'conduit', label: 'PrivateLink Conduit', topics: ['dbx-pl-aws', 'dbx-pl-azure', 'dbx-psc-gcp', 'endpoints'], at: [-28, 9] },
    { id: 'emitter', label: 'Firewall Shield Emitter', topics: ['firewall', 'dbx-ingress'], at: [-40, -21] },
    { id: 'valves', label: 'Port & Protocol Valves', topics: ['ports', 'tcp-udp'], at: [-52, 14] },
    { id: 'reactor', label: 'Control-Plane Reactor', topics: ['dbx-planes', 'dbx-scc'], at: [-72, -1] },
    { id: 'nat', label: 'NAT Thruster', topics: ['nat'], at: [-66, -47] },
    { id: 'gyro', label: 'Load-Balancer Gyro', topics: ['load-balancing'], at: [-24, 21] },
    { id: 'dish', label: 'Hybrid Link Dish', topics: ['hybrid'], at: [-48, 41] },
    { id: 'engine', label: 'Serverless Engine', topics: ['dbx-serverless', 'dbx-egress'], at: [-107, 0] }
  ];
  var BY_ID = {}, BY_TOPIC = {};
  SHIP.MODULES.forEach(function (m) { BY_ID[m.id] = m; m.topics.forEach(function (t) { BY_TOPIC[t] = m.id; }); });
  SHIP.FALLBACK = 'hull';                       // topics added later (e.g. a new level) land on the hull
  SHIP.module = function (id) { return BY_ID[id] || null; };
  SHIP.moduleForTopic = function (topic) { return BY_TOPIC[topic] || SHIP.FALLBACK; };
  SHIP.moduleForQuestion = function (q) { return SHIP.moduleForTopic(q && q.topic); };

  SHIP.TIERS = [
    { name: 'Scout', stars: 0, feature: 'Standard-issue cadet hull' },
    { name: 'Cutter', stars: 3, feature: 'Reinforced hull plating' },
    { name: 'Frigate', stars: 7, feature: 'Stabilizer fins' },
    { name: 'Cruiser', stars: 11, feature: 'Twin nacelles + plasma-gold engines' },
    { name: 'Flagship', stars: 15, feature: 'Gold trim, wingtip pods + ion halo' }
  ];

  // Pure: tier from total stars.
  SHIP.tierFor = function (stars) {
    stars = Math.max(0, +stars || 0);
    var i = 0;
    while (i + 1 < SHIP.TIERS.length && stars >= SHIP.TIERS[i + 1].stars) i++;
    var t = SHIP.TIERS[i], nx = SHIP.TIERS[i + 1] || null;
    return { index: i, name: t.name, feature: t.feature, stars: stars, next: nx, toNext: nx ? nx.stars - stars : 0 };
  };

  // Pure: severity 1–3 of a module from the worst (lowest) Leitner bay of its questions.
  // bay 1 → 3 (smoking), bay 2–3 → 2 (cracked + sparking), bay 4–5 → 1 (scorch only, nearly repaired).
  SHIP.sevForBox = function (box) { return box <= 0 ? 0 : box === 1 ? 3 : box <= 3 ? 2 : 1; };

  // Damaged modules from the Repair Bay: [{ id, label, count, worstBox, sev, topics: [labels], ids }], worst first.
  SHIP.damagedModules = function (store) {
    var out = {};
    store.bayAll().forEach(function (qid) {
      var q = ONA.util.qById(qid); if (!q) return;
      var id = SHIP.moduleForQuestion(q), box = store.state.questions[qid].box;
      var m = out[id] = out[id] || { id: id, label: BY_ID[id].label, count: 0, worstBox: 9, sev: 0, topics: [], ids: [] };
      m.count++; m.ids.push(qid);
      m.worstBox = Math.min(m.worstBox, box);
      var tl = ONA.util.topicLabel(q.topic); if (m.topics.indexOf(tl) < 0) m.topics.push(tl);
    });
    return Object.keys(out).map(function (k) { var m = out[k]; m.sev = SHIP.sevForBox(m.worstBox); return m; })
      .sort(function (a, b) { return b.sev - a.sev || b.count - a.count || a.label.localeCompare(b.label); });
  };
  SHIP.baySeverity = function (store) {
    var d = {}; SHIP.damagedModules(store).forEach(function (m) { d[m.id] = m.sev; }); return d;
  };

  // Pure: modules hit by a list of missed questions (debrief): [{ id, label, count, topics }]
  SHIP.modulesForQuestions = function (qs) {
    var out = {}, order = [];
    qs.forEach(function (q) {
      var id = SHIP.moduleForQuestion(q);
      if (!out[id]) { out[id] = { id: id, label: BY_ID[id].label, count: 0, topics: [] }; order.push(id); }
      out[id].count++;
      var tl = ONA.util.topicLabel(q.topic); if (out[id].topics.indexOf(tl) < 0) out[id].topics.push(tl);
    });
    return order.map(function (id) { return out[id]; });
  };

  // What the ship looks like right now: tier from stars, decals from worlds cleared.
  SHIP.loadout = function (store) {
    var stars = 0, decals = [];
    ONA.LEVELS.forEach(function (l) {
      var r = store.state.levels[l.id], best = r ? r.bestStars : 0;
      if (l.bonus) return;
      stars += best;
      if (best >= 1) decals.push({ id: l.id, accent: l.accent, name: l.name });
    });
    return { tier: SHIP.tierFor(stars), decals: decals };
  };

  // ---------------------------------------------------------------- SVG
  var uidN = 0;
  function dmgFx(a, delay, scale) {
    // scaled up (default 1.6) so damage still reads when the ship is drawn small (mission panel, debrief);
    // the big hangar drawing passes 1.
    return '<g class="dmg-fx" transform="translate(' + a[0] + ' ' + a[1] + ') scale(' + (scale || 1.6) + ')"' + (delay != null ? ' style="--d:' + delay + 's"' : '') + '>' +
      '<circle class="dmg-ring" r="7"/>' +
      '<path class="scorch" d="M-8-1c2-6 10-6 12-1s-1 8-7 7-7-1-5-6z"/>' +
      '<path class="crack" d="M-6-4l4 3-2 3 5-1 3 3M-2-1l3-4 5 1"/>' +
      '<g class="sparks"><circle cx="1" cy="-1" r="1.2"/><circle cx="-3" cy="2" r=".9"/><circle cx="4" cy="1.5" r="1"/></g>' +
      '<g class="smoke"><circle class="puff" r="3.4"/><circle class="puff" r="2.8"/><circle class="puff" r="3.8"/></g>' +
      '</g>';
  }

  var PARTS = {
    antenna: function (u) { return '<path d="M10-17L16-37" class="strut"/><path d="M10-30a7 7 0 0 1 10 5" class="strut thin"/><circle cx="16" cy="-38" r="2.3" class="lt tip"/>'; },
    comms: function () { return '<path d="M38-16v-7M42-17v-9M46-16v-6" class="strut thin"/><circle cx="42" cy="-27" r="1.4" class="lt mint"/>'; },
    bridge: function (u) {
      return '<path d="M89-5C83-12 68-16 50-15L44-8C60-7 77-5 89-5Z" fill="url(#gl' + u + ')" class="canopy"/>' +
        '<path d="M81-9C73-12 63-13 54-12" class="glint"/><circle cx="60" cy="-10" r="1.7" class="lt cockpit"/>';
    },
    nav: function (u) { return '<ellipse cx="74" cy="12" rx="10" ry="3.6" fill="url(#hd' + u + ')" class="trim"/><circle cx="83" cy="12" r="1.9" class="lt cyan"/>'; },
    hull: function () { return '<path d="M2-2H34L32 10H4Z" class="plate"/><g class="rivet"><circle cx="6" cy="1" r=".8"/><circle cx="30" cy="1" r=".8"/><circle cx="7" cy="7.5" r=".8"/><circle cx="29" cy="7.5" r=".8"/></g>'; },
    router: function (u) { return '<circle cx="-16" cy="-4" r="5.6" class="housing"/><circle cx="-16" cy="-4" r="3.4" fill="url(#rc' + u + ')" class="core"/>'; },
    conduit: function () { return '<path d="M-88 9H40" class="pipe"/><path d="M-88 9H40" class="flow"/>'; },
    emitter: function () { return '<path d="M-46-18a6 6 0 0 1 12 0z" class="dome"/><circle cx="-40" cy="-22" r="1.4" class="lt white"/>'; },
    valves: function () { return '<g class="valve"><circle cx="-58" cy="14" r="2"/><circle cx="-52" cy="14" r="2"/><circle cx="-46" cy="14" r="2"/></g><g class="lt valve-lt"><circle cx="-58" cy="14" r=".7"/><circle cx="-52" cy="14" r=".7"/><circle cx="-46" cy="14" r=".7"/></g>'; },
    reactor: function () { return '<rect x="-80" y="-6" width="16" height="10" rx="2" class="housing"/><path d="M-77-4v6M-74-4v6M-71-4v6M-68-4v6" class="grill"/>'; },
    nat: function (u) { return '<rect x="-72" y="-50" width="11" height="6" rx="1.5" fill="url(#hl' + u + ')" class="trim"/><path d="M-72-47h-5" class="rcs"/>'; },
    gyro: function () { return '<ellipse cx="-24" cy="21" rx="7.5" ry="3" class="gyro-ring"/><circle cx="-24" cy="21" r="1.4" class="lt violet"/>'; },
    dish: function () { return '<path d="M-48 36v4" class="strut thin"/><path d="M-55 40a7 7 0 0 0 14 0z" class="dish-face"/><circle cx="-48" cy="43" r="1.2" class="lt mint"/>'; },
    engine: function (u) { return '<path d="M-102-10L-113-8V8L-102 10Z" class="nozzle"/><ellipse cx="-113" cy="0" rx="2" ry="7" fill="url(#eg' + u + ')"/>'; }
  };

  /* opts: { loadout, damage: {modId: sev}, shield: 0..1, compact: bool, cls: '', attrs: '', stagger: [modIds], disabled: bool, fxScale: number } */
  SHIP.svg = function (opts) {
    opts = opts || {};
    var u = 's' + (++uidN), lo = opts.loadout || { tier: SHIP.tierFor(0), decals: [] };
    var T = lo.tier.index, dmg = opts.damage || {}, compact = !!opts.compact;
    var stagger = opts.stagger || [];
    var cls = 'ship tier-' + T + (compact ? ' compact' : '') + (opts.disabled ? ' disabled static-off' : '') + (opts.cls ? ' ' + opts.cls : '');
    var style = '--shield:' + (opts.shield == null ? 1 : opts.shield) + ';--burn:0';
    var defs =
      '<linearGradient id="hl' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7ff"/><stop offset=".42" stop-color="#b8c3ea"/><stop offset=".78" stop-color="#58639a"/><stop offset="1" stop-color="#262c5e"/></linearGradient>' +
      '<linearGradient id="hd' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d89be"/><stop offset="1" stop-color="#1e2450"/></linearGradient>' +
      '<linearGradient id="wg' + u + '" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#55619b"/><stop offset=".6" stop-color="#c9d2f5"/><stop offset="1" stop-color="#eef2ff"/></linearGradient>' +
      '<linearGradient id="gl' + u + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3fdff"/><stop offset=".35" stop-color="#5fd0ff"/><stop offset="1" stop-color="#0a2a66"/></linearGradient>' +
      '<linearGradient id="fl' + u + '" x1="1" x2="0"><stop offset="0" class="fl-a"/><stop offset=".35" class="fl-b"/><stop offset="1" class="fl-c" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="ab' + u + '" x1="1" x2="0"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#ff8be0"/><stop offset="1" stop-color="#b794f6" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="eg' + u + '"><stop offset="0" class="fl-b" stop-opacity=".95"/><stop offset="1" class="fl-c" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="sg' + u + '" cx="50%" cy="50%" r="50%"><stop offset=".68" stop-color="#4fd1ff" stop-opacity="0"/><stop offset=".93" stop-color="#4fd1ff" stop-opacity=".16"/><stop offset="1" stop-color="#bff4ff" stop-opacity=".5"/></radialGradient>' +
      '<pattern id="hx' + u + '" width="10" height="17.32" patternUnits="userSpaceOnUse"><path d="M5 0l5 2.9v5.8L5 11.5 0 8.7V2.9zM5 11.5v5.8" fill="none" stroke="#9ff0ff" stroke-width=".5" stroke-opacity=".55"/></pattern>' +
      '<radialGradient id="rc' + u + '"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#b794f6"/><stop offset="1" stop-color="#3b2a7a"/></radialGradient>' +
      '<linearGradient id="gd' + u + '" x1="0" x2="1"><stop offset="0" stop-color="#b07a1a"/><stop offset=".5" stop-color="#fff3c4"/><stop offset="1" stop-color="#f6c453"/></linearGradient>' +
      '<radialGradient id="if' + u + '"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient>';
    var BODY = 'M106 0C96-6 78-14 52-17L-60-19-96-12-102-6V6L-96 12-60 19 52 17C78 14 96 6 106 0Z';
    var h = '';
    // ion halo (tier 4) behind everything
    if (T >= 4) h += '<ellipse class="halo" cx="-4" cy="2" rx="112" ry="15" stroke="url(#gd' + u + ')"/>';
    // engine glow + flames (behind the hull)
    h += '<circle class="eglow" cx="-115" cy="0" r="18" fill="url(#eg' + u + ')"/>';
    var flame = function (x, y, s) {
      var X = function (v) { return (x + v * s).toFixed(1); }, Y = function (v) { return (y + v * s).toFixed(1); };
      return '<g class="flames"><g class="burn"><g class="flick">' +
        '<path class="ab" d="M' + X(0) + ' ' + Y(-10) + 'C' + X(-18) + ' ' + Y(-9) + ' ' + X(-44) + ' ' + Y(-4) + ' ' + X(-64) + ' ' + Y(0) + ' ' + X(-44) + ' ' + Y(4) + ' ' + X(-18) + ' ' + Y(9) + ' ' + X(0) + ' ' + Y(10) + 'Z" fill="url(#ab' + u + ')"/>' +
        '<path d="M' + X(0) + ' ' + Y(-7) + 'C' + X(-14) + ' ' + Y(-6) + ' ' + X(-34) + ' ' + Y(-3) + ' ' + X(-50) + ' ' + Y(0) + ' ' + X(-34) + ' ' + Y(3) + ' ' + X(-14) + ' ' + Y(6) + ' ' + X(0) + ' ' + Y(7) + 'Z" fill="url(#fl' + u + ')"/>' +
        '<path d="M' + X(0) + ' ' + Y(-3.5) + 'C' + X(-10) + ' ' + Y(-3) + ' ' + X(-20) + ' ' + Y(-1.5) + ' ' + X(-28) + ' ' + Y(0) + ' ' + X(-20) + ' ' + Y(1.5) + ' ' + X(-10) + ' ' + Y(3) + ' ' + X(0) + ' ' + Y(3.5) + 'Z" class="core-flame"/>' +
        '</g></g></g>';
    };
    h += flame(-113, 0, 1);
    if (T >= 3) { h += flame(-83, -33, 0.55) + flame(-80, 33, 0.55); }
    // speed lines (boost / afterburner)
    h += '<g class="speed"><path d="M128-30H70M124 30H64M130-8H96M126 10H90"/></g>';
    // ventral wing + fin (behind hull)
    h += '<g class="body">';
    h += '<path d="M14 13L-46 46H-70L-60 15Z" fill="url(#hd' + u + ')" class="wing ventral"/>';
    if (T >= 2) h += '<path d="M-66 18L-84 38H-94L-86 17Z" fill="url(#hd' + u + ')" class="fin"/>';
    if (T >= 3) h += '<ellipse cx="-56" cy="33" rx="24" ry="5.5" fill="url(#hd' + u + ')" class="nacelle"/>';
    // fuselage
    h += '<path d="' + BODY + '" fill="url(#hl' + u + ')" class="fuselage"/>';
    h += '<path d="M106 0C96 6 78 14 52 17L-60 19-96 12-102 6V0Z" class="belly"/>';
    h += '<path d="M100-1C88-7 70-13 50-15L-58-17" class="spine"/>';
    if (T >= 1) h += '<g class="plating"><path d="M44-15H-50L-54-9H48Z"/><path d="M60-15V15M30-16V16M0-17V17M-30-17V17M-58-17V17"/></g>';
    // hull battle scorches (shown as hull integrity drops)
    h += '<g class="hullscar"><path class="h1" d="M38 5c3-4 9-3 10 1s-4 6-8 5-4-3-2-6z"/><path class="h2" d="M-8-14c3-3 9-2 9 2s-5 5-8 4-3-3-1-6z"/><path class="h3" d="M-62 8c3-3 8-2 9 1s-4 6-8 5-3-3-1-6z"/></g>';
    // decals: one chevron per world cleared
    (lo.decals || []).forEach(function (d, k) {
      var x = -50 + k * 9;
      h += '<path class="decal" d="M' + x + ' -13l5 4-5 4h-3.4l5-4-5-4z" fill="' + d.accent + '"/>';
    });
    // dorsal wing, fin, nacelle (in front of hull)
    h += '<path d="M18-13L-48-50H-74L-62-15Z" fill="url(#wg' + u + ')" class="wing dorsal"/><path d="M18-13L-48-50" class="edge"/>';
    if (T >= 2) h += '<path d="M-64-18L-86-46H-98L-88-17Z" fill="url(#wg' + u + ')" class="fin"/>';
    if (T >= 3) h += '<ellipse cx="-58" cy="-33" rx="24" ry="5.5" fill="url(#hl' + u + ')" class="nacelle"/><ellipse cx="-82" cy="-33" rx="1.6" ry="4.5" fill="url(#eg' + u + ')"/>';
    if (T >= 4) h += '<path d="M100-1C88-7 70-13 50-15L-58-17" class="trimline" stroke="url(#gd' + u + ')"/>' +
      '<rect x="-81" y="-54" width="16" height="5" rx="2.5" fill="url(#gd' + u + ')"/><rect x="-77" y="44" width="16" height="5" rx="2.5" fill="url(#gd' + u + ')"/>';
    // modules
    SHIP.MODULES.forEach(function (m) {
      var sev = dmg[m.id] || 0, si = stagger.indexOf(m.id);
      h += '<g class="mod mod-' + m.id + (sev ? ' sev-' + sev : '') + (si >= 0 ? ' dmg-in' : '') + '" data-mod="' + m.id + '">' + PARTS[m.id](u) + dmgFx(m.at, si >= 0 ? 0.35 + si * 0.28 : null, opts.fxScale) + '</g>';
    });
    // running lights
    h += '<circle cx="-75" cy="-50" r="1.9" class="lt nav-red"/><circle cx="-71" cy="46" r="1.9" class="lt nav-green"/><circle cx="-103" cy="-12" r="1.3" class="lt strobe"/>';
    h += '<path d="' + BODY + '" class="hull-flash"/>';
    h += '</g>';
    // shield bubble, impact + weld effects (front)
    if (!compact) {
      h += '<g class="shield"><ellipse cx="-3" cy="0" rx="118" ry="58" fill="url(#sg' + u + ')"/><ellipse cx="-3" cy="0" rx="118" ry="58" fill="url(#hx' + u + ')" class="hex"/><ellipse cx="-3" cy="0" rx="118" ry="58" class="shield-edge"/></g>';
      h += '<circle class="impact-fx" cx="0" cy="0" r="16" fill="url(#if' + u + ')"/>';
      h += '<g class="weld-fx" transform="translate(0 0)"><circle r="2.6" class="weld-core"/><path class="weld-arcs" d="M0 0l7-5M0 0l8 2M0 0l3 8M0 0l-6 6M0 0l-8-1M0 0l-4-7"/></g>';
    }
    return '<svg class="' + cls + '" viewBox="' + SHIP.VIEWBOX + '" ' + (opts.attrs || '') + ' style="' + style + '" aria-hidden="true" focusable="false">' +
      '<defs>' + defs + '</defs><g class="rig">' + h + '</g></svg>';
  };

  // ---------------------------------------------------------------- controller (mission panel, hangar)
  function restart(el, cls, ms) {
    el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls);
    clearTimeout(el['_t' + cls]);
    if (ms) el['_t' + cls] = setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function setSev(g, sev) {
    for (var s = 1; s <= 3; s++) g.classList.toggle('sev-' + s, sev === s);
  }

  SHIP.mount = function (container, opts) {
    container.innerHTML = SHIP.svg(opts);
    var root = container.querySelector('svg.ship');
    var ctl = {
      el: root,
      modEl: function (id) { return root.querySelector('.mod-' + id); },
      setShield: function (frac, lostOf) {
        frac = Math.max(0, Math.min(1, frac));
        root.style.setProperty('--shield', frac.toFixed(3));
        root.classList.toggle('shield-low', frac > 0 && frac <= 0.34);
        root.classList.toggle('shield-out', frac === 0);
        var lost = lostOf || 0;
        for (var k = 1; k <= 3; k++) root.classList.toggle('hull-' + k, lost >= k);
      },
      setBurn: function (streak) {
        var b = Math.min(10, streak || 0) / 10;
        root.style.setProperty('--burn', b.toFixed(2));
        root.classList.toggle('afterburner', streak >= 3);
      },
      setDamage: function (map) {
        SHIP.MODULES.forEach(function (m) { setSev(ctl.modEl(m.id), map[m.id] || 0); });
      },
      boost: function () { restart(root, 'boost', 900); restart(root, 'shimmer', 1100); },
      hit: function (id, sev) {
        var g = ctl.modEl(id) || ctl.modEl(SHIP.FALLBACK), m = BY_ID[g.dataset.mod];
        setSev(g, sev);
        var fxc = root.querySelector('.impact-fx');
        if (fxc) { fxc.setAttribute('cx', m.at[0]); fxc.setAttribute('cy', m.at[1]); restart(fxc, 'on', 700); }
        restart(g, 'hit', 700);
        restart(root, 'impact', 650);
        return g;
      },
      weld: function (id) {
        var g = ctl.modEl(id) || ctl.modEl(SHIP.FALLBACK), m = BY_ID[g.dataset.mod], w = root.querySelector('.weld-fx');
        if (w) { w.setAttribute('transform', 'translate(' + m.at[0] + ' ' + m.at[1] + ')'); restart(w, 'on', 1500); }
        restart(g, 'welding', 1500);
        return g;
      },
      repaired: function (id) { var g = ctl.modEl(id); if (g) { setSev(g, 0); restart(g, 'fixed', 1600); } restart(root, 'shimmer', 1100); },
      // Visual state only: the caller (game.js) owns the sequence timing through its cancellable run token,
      // so nothing here can outlive the run.
      powerDown: function () { root.classList.add('disabled'); },
      powerUp: function () { root.classList.remove('disabled'); }
    };
    return ctl;
  };

  // ---------------------------------------------------------------- hangar scene (Repair Bay)
  // mods: SHIP.damagedModules(store). Returns SVG markup with the docked ship and a labelled callout per module.
  SHIP.hangar = function (lo, mods) {
    var W = 1000, H = 400, SW = 640, SH = SW * VB.h / VB.w, SX = (W - SW) / 2, SY = 84;
    var map = function (a) { return [SX + (a[0] - VB.x) * SW / VB.w, SY + (a[1] - VB.y) * SH / VB.h]; };
    var dmg = {}; mods.forEach(function (m) { dmg[m.id] = m.sev; });
    var s = '<svg class="hangar-scene" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false"><defs>' +
      '<linearGradient id="hgW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121b4c"/><stop offset="1" stop-color="#070b24"/></linearGradient>' +
      '<linearGradient id="hgF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2358"/><stop offset="1" stop-color="#0a0f2e"/></linearGradient>' +
      '<linearGradient id="hgL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff4ff" stop-opacity=".22"/><stop offset="1" stop-color="#bff4ff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="hgS" x1="0" x2="1"><stop offset="0" stop-color="#7cf7c3" stop-opacity="0"/><stop offset=".5" stop-color="#7cf7c3" stop-opacity=".35"/><stop offset="1" stop-color="#7cf7c3" stop-opacity="0"/></linearGradient>' +
      '<pattern id="hgHz" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="16" fill="#f6c453"/><rect x="8" width="8" height="16" fill="#1a1406"/></pattern>' +
      '</defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#hgW)"/>';
    for (var x = 40; x < W; x += 80) s += '<path d="M' + x + ' 0V300" class="hg-rib"/>';
    s += '<path d="M0 36H' + W + 'M0 52H' + W + '" class="hg-beam"/>';
    [200, 500, 800].forEach(function (lx) { s += '<path d="M' + (lx - 14) + ' 52L' + (lx - 150) + ' 330H' + (lx + 150) + 'L' + (lx + 14) + ' 52Z" fill="url(#hgL)" class="hg-cone"/><rect x="' + (lx - 18) + '" y="46" width="36" height="8" rx="2" class="hg-lamp"/>'; });
    s += '<path d="M0 300H' + W + 'L' + W + ' ' + H + 'H0Z" fill="url(#hgF)"/>';
    for (var gx = -400; gx <= W + 400; gx += 70) s += '<path d="M' + (W / 2 + (gx - W / 2) * 0.35) + ' 300L' + gx + ' ' + H + '" class="hg-grid"/>';
    s += '<path d="M0 330H' + W + 'M0 362H' + W + '" class="hg-grid"/>';
    s += '<rect x="0" y="296" width="' + W + '" height="6" fill="url(#hgHz)" opacity=".75"/>';
    // docking clamps up to the belly
    s += '<path d="M380 300V' + (SY + SH * 0.72) + 'h24M620 300V' + (SY + SH * 0.7) + 'h-24" class="hg-clamp"/>';
    // the ship
    s += SHIP.svg({ loadout: lo, damage: dmg, shield: 0, fxScale: 1, cls: 'docked' + (mods.length ? '' : ' pristine'), attrs: 'x="' + SX + '" y="' + SY + '" width="' + SW + '" height="' + SH + '"' });
    // diagnostic scan sweep
    s += '<rect class="hg-scan" x="' + SX + '" y="' + (SY + 8) + '" width="60" height="' + (SH - 16) + '" fill="url(#hgS)"/>';
    // callouts
    if (mods.length) {
      var placed = mods.map(function (m) { var p = map(BY_ID[m.id].at); return { m: m, x: p[0], y: p[1] }; });
      var top = placed.filter(function (p) { return BY_ID[p.m.id].at[1] < 0; }).sort(function (a, b) { return a.x - b.x; });
      var bot = placed.filter(function (p) { return BY_ID[p.m.id].at[1] >= 0; }).sort(function (a, b) { return a.x - b.x; });
      var row = function (list, ly, up) {
        var n = list.length, slot = (W - 40) / Math.max(n, 1), bw = Math.min(176, slot - 10);
        list.forEach(function (p, k) {
          var cx = 20 + slot * (k + 0.5), bx = cx - bw / 2, by = up ? ly : ly - 40;
          var edgeY = up ? by + 40 : by;
          var fit = function (txt, px) { var est = txt.length * px; return est > bw - 12 ? ' textLength="' + (bw - 12).toFixed(0) + '" lengthAdjust="spacingAndGlyphs"' : ''; };
          s += '<g class="callout sev-' + p.m.sev + '" data-mod="' + p.m.id + '">' +
            '<path d="M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + 'L' + cx.toFixed(1) + ' ' + edgeY + '" class="co-line"/>' +
            '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" class="co-dot"/>' +
            '<rect x="' + bx.toFixed(1) + '" y="' + by + '" width="' + bw.toFixed(1) + '" height="40" rx="8" class="co-box"/>' +
            '<text x="' + cx.toFixed(1) + '" y="' + (by + 17) + '" class="co-label"' + fit(p.m.label, 7) + '>' + ONA.util.esc(p.m.label) + '</text>' +
            '<text x="' + cx.toFixed(1) + '" y="' + (by + 32) + '" class="co-sub">' + p.m.count + ' part' + (p.m.count === 1 ? '' : 's') + ' · bay ' + p.m.worstBox + '</text></g>';
        });
      };
      row(top, 4, true);
      row(bot, H - 4, false);
    } else {
      s += '<g class="hg-nominal"><rect x="350" y="12" width="300" height="40" rx="20"/><text x="500" y="38">ALL MODULES NOMINAL</text></g>';
    }
    return s + '</svg>';
  };
})(window.ONA);
