/* Shared helpers. Classic script: attaches to window.ONA.util */
(function (ONA) {
  'use strict';
  var U = (ONA.util = {});

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  };

  U.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  U.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };

  U.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  U.pct = function (n, d) { return d ? Math.round((100 * n) / d) : 0; };
  U.fmtTime = function (ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(s / 60); s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
  U.fmtSec = function (ms) { return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'; };
  U.sameSet = function (a, b) {
    if (a.length !== b.length) return false;
    var s = {}; a.forEach(function (x) { s[x] = 1; });
    return b.every(function (x) { return s[x]; });
  };
  U.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  // Backing-store scale for the full-screen canvases: device pixels, capped at 2x and at ~8 MP (one 4K frame) in total
  // (phones stay sharp at 2x; a 5K screen at 2x drops to ~1.3x instead of allocating 29 MP per frame).
  U.canvasDpr = function (w, h) {
    var d = Math.min(window.devicePixelRatio || 1, 2), budget = 8.3e6;
    if (w * h * d * d > budget) d = Math.max(1, Math.sqrt(budget / (w * h)));
    return d;
  };

  // Touch-first device (phone / tablet without a mouse): swap keyboard hints for tap wording.
  U.touch = function () { return !!(window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches); };

  U.reducedMotion = function () {
    var pref = ONA.store && ONA.store.state ? ONA.store.state.settings.motion : 'auto';
    if (pref === 'reduce') return true;
    if (pref === 'full') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  U.wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  U.download = function (filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  U.topicLabel = function (t) { return (ONA.TOPICS[t] && ONA.TOPICS[t].label) || t; };
  U.level = function (id) { return ONA.LEVELS.filter(function (l) { return l.id === id; })[0]; };
  // A Databricks world: at least half its questions are in Databricks topics (ONA.TOPICS[t].dbx). Drives the
  // Databricks mark on the galaxy map, so a new level gets it (or not) from its question bank alone.
  U.isDbxWorld = function (level) {
    var id = level && typeof level === 'object' ? level.id : level, n = 0, d = 0;
    (ONA.QUESTIONS || []).forEach(function (q) { if (q.level !== id) return; n++; if (ONA.TOPICS[q.topic] && ONA.TOPICS[q.topic].dbx) d++; });
    return n > 0 && d * 2 >= n;
  };
  U.qById = function (id) {
    if (!U._qmap) { U._qmap = {}; ONA.QUESTIONS.forEach(function (q) { U._qmap[q.id] = q; }); }
    return U._qmap[id];
  };
})(window.ONA);
