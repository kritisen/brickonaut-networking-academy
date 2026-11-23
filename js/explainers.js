/* Concept explainers: a library of parameterised, animated inline-SVG concept figures, plus the
 * "Concept" block shown in the answer feedback panel (right answers: collapsed; wrong answers: open).
 *
 * Classic script, no DOM access at load time (the question validator renders every figure in a Node vm).
 *   ONA.explainers.render(id, params)          -> SVG markup string (aria-hidden; throws on unknown id)
 *   ONA.explainers.validate(id, params)        -> array of error strings ([] = valid)
 *   ONA.explainers.spec(q, partIndex)          -> { fig, params, concept } resolved for a question / part
 *   ONA.explainers.feedback(q, p, ok, partIdx) -> HTML for the feedback panel ('' when unmapped)
 *   ONA.explainers.FIGURES                     -> { id: { title, params, sample } }
 *
 * Animation is CSS (dash flow, pulse, staged reveal) plus SMIL probes. Probes are not emitted at all
 * under reduced motion, and css/explainers.css zeroes reveal delays, so every figure is a readable
 * static picture with motion off. Mapping questions -> figures lives in data/concepts.js.
 */
(function (root) {
  'use strict';
  var ONA = (root.ONA = root.ONA || {});

  var C = { cyan: '#4fd1ff', mint: '#7cf7c3', gold: '#f6c453', rose: '#ff4d6d', violet: '#b794f6', orange: '#ff8a5b', ice: '#c7d2fe', blue: '#7d8bff', dim: '#7380b3' };
  var UID = 0;

  // ------------------------------------------------------------------ primitives
  function E(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function RM() { try { return !!(ONA.util && ONA.util.reducedMotion && ONA.util.reducedMotion()); } catch (e) { return false; } }
  function icon(kind) { return ONA.art && ONA.art.icon ? ONA.art.icon(kind) : ''; }
  function kc(kind) { return ONA.art && ONA.art.kindColor ? ONA.art.kindColor(kind) : C.cyan; }
  function col(st, base) { return st === 'hl' ? C.gold : st === 'bad' ? C.rose : st === 'ok' ? C.mint : base || C.cyan; }
  function cls(st, on) { return on ? st : ''; }

  function svg(id, w, h, inner) {
    var u = 'cf' + (++UID);
    var mk = function (n, c) {
      return '<marker id="' + u + n + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="' + c + '"/></marker>';
    };
    return '<svg class="cfig cf-' + id + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
      '<defs>' + mk('a', '#8b9ae0') + mk('g', C.gold) + mk('r', C.rose) + mk('m', C.mint) +
      '<radialGradient id="' + u + 'neb"><stop offset="0" stop-color="#b794f6" stop-opacity=".32"/><stop offset=".6" stop-color="#4fd1ff" stop-opacity=".08"/><stop offset="1" stop-color="#4fd1ff" stop-opacity="0"/></radialGradient></defs>' +
      inner.split('§').join(u) + '</svg>';
  }
  function mref(st) { return 'url(#§' + ({ hl: 'g', bad: 'r', ok: 'm' }[st] || 'a') + ')'; }

  function tx(x, y, s, c, anchor) {
    return '<text x="' + r1(x) + '" y="' + r1(y) + '" class="' + (c || 'ct') + '"' + (anchor && anchor !== 'start' ? ' text-anchor="' + anchor + '"' : '') + '>' + E(s) + '</text>';
  }
  function xmark(x, y, r) { r = r || 9; return '<g class="cx" transform="translate(' + r1(x) + ' ' + r1(y) + ')"><circle r="' + r + '"/><path d="M' + (-r * 0.42) + ' ' + (-r * 0.42) + 'L' + (r * 0.42) + ' ' + (r * 0.42) + 'M' + (r * 0.42) + ' ' + (-r * 0.42) + 'L' + (-r * 0.42) + ' ' + (r * 0.42) + '"/></g>'; }
  function tick(x, y, r) { r = r || 9; return '<g class="ck" transform="translate(' + r1(x) + ' ' + r1(y) + ')"><circle r="' + r + '"/><path d="M' + (-r * 0.45) + ' 0l' + (r * 0.32) + ' ' + (r * 0.34) + ' ' + (r * 0.6) + ' ' + (-r * 0.68) + '"/></g>'; }
  function warn(x, y) { return '<g class="cw-warn" transform="translate(' + r1(x) + ' ' + r1(y) + ')"><circle r="9"/><path d="M0-4.5v5M0 3.6v.4"/></g>'; }
  function mark(kind, x, y, r) { return kind === 'ok' ? tick(x, y, r) : kind === 'bad' ? xmark(x, y, r) : kind === 'warn' ? warn(x, y) : ''; }

  function node(x, y, kind, label, sub, st, o) {
    o = o || {};
    var r = o.r || 21, c = col(st, o.color || kc(kind));
    return '<g class="cn ' + (st || '') + '" style="--c:' + c + '" transform="translate(' + r1(x) + ' ' + r1(y) + ')">' +
      '<circle class="cn-ring" r="' + (r + 7) + '"/><circle class="cn-disc" r="' + r + '"/>' +
      '<g class="cn-ico" transform="translate(-12 -12)">' + icon(kind) + '</g>' +
      (label ? tx(0, r + 17, label, 'cn-l', 'middle') : '') + (sub ? tx(0, r + 31, sub, 'cn-s', 'middle') : '') +
      (st === 'bad' ? xmark(r * 0.78, -r * 0.78, 7.5) : '') + '</g>';
  }
  function pill(x, y, s, st, c) {
    var w = Math.max(22, String(s).length * 6.6 + 16);
    return '<g class="cp ' + (st || '') + ' ' + (c || '') + '" transform="translate(' + r1(x) + ' ' + r1(y) + ')"><rect x="' + r1(-w / 2) + '" y="-10" width="' + r1(w) + '" height="20" rx="10"/>' + tx(0, 4, s, 'cp-t', 'middle') + '</g>';
  }
  function mid(pts) { var i = Math.floor((pts.length - 1) / 2), a = pts[i], b = pts[i + 1] || a; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function pathD(pts) { return 'M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join(' L'); }
  // wire(points, { st: ''|'hl'|'bad'|'ok'|'dim', flow, rev, label, at, arrow:false, both, dash })
  function wire(pts, o) {
    o = o || {};
    var d = pathD(pts), st = o.st || '';
    var out = '<g class="cw ' + st + (o.dash ? ' dash' : '') + '"><path d="' + d + '" class="cw-line"' +
      (o.arrow === false ? '' : ' marker-end="' + mref(st) + '"') + (o.both ? ' marker-start="' + mref(st) + '"' : '') + '/>';
    if (o.flow && st !== 'bad' && st !== 'dim') out += '<path d="' + d + '" class="cw-flow' + (o.rev ? ' rev' : '') + '"/>';
    if (o.label) { var m = o.at || mid(pts); out += pill(m[0], m[1], o.label, st === 'dim' ? '' : st); }
    if (st === 'bad' && o.x !== false) { var mm = o.xat || mid(pts); out += xmark(mm[0], mm[1] + (o.label && !o.xat ? 19 : 0)); }
    return out + '</g>';
  }
  // link between two node centres, trimmed so arrows stop at the node rings
  function link(a, b, o) {
    o = o || {};
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, ra = o.ra || 31, rb = o.rb || 33;
    return wire([[a[0] + ux * ra, a[1] + uy * ra], [b[0] - ux * rb, b[1] - uy * rb]], o);
  }
  function region(x, y, w, h, label, o) {
    o = o || {};
    var c = col(o.st, o.color || C.cyan);
    return '<g class="cr ' + (o.st || '') + '" style="--c:' + c + '"><rect class="cr-box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (o.rx || 14) + '"/>' +
      (label ? tx(x + 12, o.bottom ? y + h - 9 : y + 17, label, 'cr-l') : '') + '</g>';
  }
  function box(x, y, w, h, st, o) {
    o = o || {};
    var c = col(st, o.color || C.cyan);
    return '<rect class="cb ' + (st || '') + '" style="--c:' + c + '" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" rx="' + (o.rx || 9) + '"/>';
  }
  function probe(pts, dur, c) {
    if (RM()) return '';
    var d = typeof pts === 'string' ? pts : pathD(pts);
    return '<g class="cf-probe" style="--c:' + (c || C.cyan) + '"><circle r="7" class="halo"/><circle r="3.6"/><animateMotion dur="' + dur + 's" repeatCount="indefinite" path="' + d + '"/></g>';
  }
  function rev(i, inner, step) { return '<g class="cf-rev" style="animation-delay:' + (i * (step || 0.35)).toFixed(2) + 's">' + inner + '</g>'; }
  function nebula(x, y, rx, ry, label) {
    return '<ellipse class="neb" cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="url(#§neb)"/>' + (label ? tx(x, y - ry + 16, label, 'neb-l', 'middle') : '');
  }

  // ------------------------------------------------------------------ IPv4 helpers
  function ipInt(s) { var p = String(s).split('.').map(Number); return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0; }
  function intIp(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  function isIp(s) { return typeof s === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every(function (o) { return +o <= 255; }); }
  function isCidr(s) { if (typeof s !== 'string') return false; var m = s.split('/'); return m.length === 2 && isIp(m[0]) && /^\d{1,2}$/.test(m[1]) && +m[1] <= 32; }
  function maskOf(p) { return p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0; }
  function inCidr(ip, cidr) { var m = cidr.split('/'), p = +m[1], mk = maskOf(p); return ((ipInt(ip) & mk) >>> 0) === ((ipInt(m[0]) & mk) >>> 0); }
  function n2(v) { return v.toLocaleString('en-US'); }
  var RESERVED = {
    aws: { n: 5, name: 'AWS', list: ['.0 network', '.1 router', '.2 DNS', '.3 future', 'last broadcast'] },
    azure: { n: 5, name: 'Azure', list: ['.0 network', '.1 gateway', '.2 + .3 Azure DNS', 'last broadcast'] },
    gcp: { n: 4, name: 'GCP', list: ['.0 network', '.1 gateway', 'second-to-last', 'last broadcast'] }
  };

  // ------------------------------------------------------------------ registry + param schema
  // Param schema: { t: 'enum', v: [...] } | { t: 'int', min, max } | { t: 'bool' } | { t: 'str', max } | { t: 'ip' }
  //               | { t: 'list', of: <schema>, min, max } | { t: 'routes' }
  var FIG = {};
  function def(id, title, params, sample, render, check) { FIG[id] = { id: id, title: title, params: params || {}, sample: sample || {}, render: render, check: check }; }

  function checkVal(s, v, path) {
    switch (s.t) {
      case 'enum': return s.v.indexOf(v) >= 0 ? [] : [path + ' must be one of ' + s.v.join('|') + ' (got ' + JSON.stringify(v) + ')'];
      case 'int': return Number.isInteger(v) && v >= s.min && v <= s.max ? [] : [path + ' must be an integer ' + s.min + '..' + s.max + ' (got ' + JSON.stringify(v) + ')'];
      case 'bool': return typeof v === 'boolean' ? [] : [path + ' must be true/false'];
      case 'str': return typeof v === 'string' && v.trim() && v.length <= (s.max || 60) ? [] : [path + ' must be a non-empty string of <= ' + (s.max || 60) + ' chars'];
      case 'ip': return isIp(v) ? [] : [path + ' must be a dotted IPv4 address (got ' + JSON.stringify(v) + ')'];
      case 'list': {
        if (!Array.isArray(v)) return [path + ' must be a list'];
        var e = [];
        if (v.length < (s.min || 0) || v.length > (s.max || 99)) e.push(path + ' needs ' + (s.min || 0) + '..' + (s.max || 99) + ' entries');
        v.forEach(function (x, i) { e = e.concat(checkVal(s.of, x, path + '[' + i + ']')); });
        return e;
      }
      case 'routes': {
        if (!Array.isArray(v) || v.length < 1 || v.length > 6) return [path + ' must be a list of 1..6 [cidr, target] routes'];
        var er = [];
        v.forEach(function (r, i) {
          if (!Array.isArray(r) || !isCidr(r[0]) || typeof r[1] !== 'string' || !r[1]) er.push(path + '[' + i + '] must be [cidr, target]');
        });
        return er;
      }
    }
    return [path + ': unknown schema'];
  }
  function validate(id, params) {
    var f = FIG[id];
    if (!f) return ['unknown figure "' + id + '"'];
    params = params || {};
    if (typeof params !== 'object' || Array.isArray(params)) return ['params must be an object'];
    var e = [];
    Object.keys(params).forEach(function (k) {
      if (!f.params[k]) e.push('figure "' + id + '" has no param "' + k + '" (allowed: ' + (Object.keys(f.params).join(', ') || 'none') + ')');
      else e = e.concat(checkVal(f.params[k], params[k], k));
    });
    if (!e.length && f.check) e = e.concat(f.check(params) || []);
    return e;
  }
  function render(id, params) {
    var f = FIG[id];
    if (!f) throw new Error('unknown concept figure ' + id);
    return f.render(params || {});
  }

  // ================================================================== FIGURES
  // ---------------------------------------------------------------- OSI vs TCP/IP
  def('layers', 'OSI 7 layers vs TCP/IP 4 layers', { hl: { t: 'int', min: 1, max: 7 }, focus: { t: 'enum', v: ['osi', 'tcpip', 'both'] } }, { focus: 'tcpip' }, function (p) {
    var L = [[7, 'Application', 'data'], [6, 'Presentation', 'data'], [5, 'Session', 'data'], [4, 'Transport', 'segment'], [3, 'Network', 'packet'], [2, 'Data Link', 'frame'], [1, 'Physical', 'bits']];
    var LC = { 7: '#ff8a5b', 6: '#f6c453', 5: '#d4e157', 4: '#7cf7c3', 3: '#4fd1ff', 2: '#7d8bff', 1: '#b794f6' };
    var T4 = [['Application', [7, 6, 5], 'HTTP · DNS · TLS · SSH'], ['Transport', [4], 'TCP · UDP · ports'], ['Internet', [3], 'IP · ICMP · routers'], ['Link', [2, 1], 'Ethernet · MAC · Wi-Fi']];
    var x0 = 16, w0 = 268, x1 = 336, w1 = 248, y0 = 44, rh = 32, g = 4;
    var yOf = function (n) { return y0 + (7 - n) * (rh + g); };
    var fo = p.focus, out = '';
    out += tx(x0, 26, 'OSI model', 'cth' + (fo === 'osi' || fo === 'both' ? ' on' : '')) + tx(x0 + w0, 26, '7 layers', 'cth-n' + (fo === 'osi' || fo === 'both' ? ' on' : ''), 'end');
    out += tx(x1, 26, 'TCP/IP model', 'cth' + (fo === 'tcpip' || fo === 'both' ? ' on' : '')) + tx(x1 + w1, 26, '4 layers', 'cth-n' + (fo === 'tcpip' || fo === 'both' ? ' on' : ''), 'end');
    L.forEach(function (l, i) {
      var y = yOf(l[0]), on = p.hl === l[0], dim = (p.hl && !on) || fo === 'tcpip';
      out += rev(i, '<g class="lay' + (on ? ' hl' : '') + (dim ? ' dim' : '') + '" style="--c:' + LC[l[0]] + '"><rect x="' + x0 + '" y="' + y + '" width="' + w0 + '" height="' + rh + '" rx="7" class="lay-r"/>' +
        tx(x0 + 12, y + 21, 'L' + l[0], 'lay-n') + tx(x0 + 46, y + 21, l[1], 'lay-l') + tx(x0 + w0 - 12, y + 21, l[2], 'lay-p', 'end') + '</g>', 0.07);
    });
    T4.forEach(function (t, i) {
      var top = yOf(t[1][0]), bot = yOf(t[1][t[1].length - 1]) + rh, on = (p.hl && t[1].indexOf(p.hl) >= 0) || fo === 'tcpip', dim = (p.hl && !on) || fo === 'osi';
      var c = LC[t[1][Math.floor(t[1].length / 2)]];
      var body = t[1].length > 1
        ? tx(x1 + 14, top + (bot - top) / 2 - 3, t[0], 'lay-l') + tx(x1 + 14, top + (bot - top) / 2 + 15, t[2], 'lay-p')
        : tx(x1 + 14, top + 21, t[0], 'lay-l') + tx(x1 + w1 - 12, top + 21, t[2], 'lay-p', 'end');
      var span = t[1].length > 1 ? 'OSI ' + t[1][t[1].length - 1] + '–' + t[1][0] : 'OSI ' + t[1][0];
      out += rev(7 + i, '<g class="lay t4' + (on ? ' hl' : '') + (dim ? ' dim' : '') + '" style="--c:' + c + '">' +
        '<path class="lay-br" d="M' + (x0 + w0 + 6) + ' ' + (top + 3) + 'h10v' + (bot - top - 6) + 'h-10M' + (x0 + w0 + 16) + ' ' + ((top + bot) / 2) + 'H' + (x1 - 4) + '"/>' +
        '<rect x="' + x1 + '" y="' + top + '" width="' + w1 + '" height="' + (bot - top) + '" rx="9" class="lay-r"/>' + body +
        (t[1].length > 1 ? tx(x1 + w1 - 12, top + 17, span, 'lay-s', 'end') : '') + '</g>', 0.12);
    });
    out += probe([[x0 + 4, y0 + 6], [x0 + 4, yOf(1) + rh - 6]], 3.2, C.gold);
    return svg('layers', 600, 302, out);
  });

  // ---------------------------------------------------------------- TCP handshake
  def('handshake', 'TCP three-way handshake', { hl: { t: 'enum', v: ['syn', 'synack', 'ack', 'data'] } }, {}, function (p) {
    var cx = 160, sx = 440, out = '';
    out += node(cx, 34, 'user', '', '', '', { r: 15 }) + node(sx, 34, 'server', '', '', '', { r: 15 });
    out += tx(cx - 26, 39, 'Client', 'ct', 'end') + tx(sx + 26, 39, 'Server', 'ct');
    out += '<path class="life" d="M' + cx + ' 56V270M' + sx + ' 56V270"/>';
    var M = [['syn', 'SYN', 'seq = x', cx, sx, 74], ['synack', 'SYN-ACK', 'seq = y · ack = x + 1', sx, cx, 126], ['ack', 'ACK', 'ack = y + 1', cx, sx, 178]];
    M.forEach(function (m, i) {
      var st = p.hl === m[0] ? 'hl' : '';
      out += rev(i, wire([[m[3] + (m[3] < m[4] ? 4 : -4), m[5]], [m[4] + (m[3] < m[4] ? -6 : 6), m[5] + 26]], { st: st }) +
        pill(300, m[5] + 13, m[1], st) + tx(300, m[5] + 38, m[2], 'cts', 'middle'), 0.55);
    });
    out += rev(3, wire([[cx + 4, 256], [sx - 6, 256]], { st: p.hl === 'data' ? 'hl' : 'ok', flow: true, both: true }) + tx(300, 246, 'connection established · data flows', 'cts ok', 'middle'), 0.55);
    // TCP states on each lifeline
    [[cx - 10, 80, 'SYN-SENT', 'end'], [cx - 10, 186, 'ESTABLISHED', 'end'], [sx + 10, 66, 'LISTEN'], [sx + 10, 132, 'SYN-RCVD'], [sx + 10, 210, 'ESTABLISHED']].forEach(function (s) {
      out += tx(s[0], s[1], s[2], 'ctm dim', s[3]);
    });
    out += probe([[cx, 74], [sx, 100], [sx, 126], [cx, 152], [cx, 178], [sx, 204]], 4.2, C.gold);
    return svg('handshake', 600, 280, out);
  });

  // ---------------------------------------------------------------- TCP vs UDP
  def('tcp-udp', 'TCP vs UDP delivery', { hl: { t: 'enum', v: ['tcp', 'udp'] } }, { hl: 'udp' }, function (p) {
    var out = '';
    function lane(y, key, name, tag, pk, ex) {
      var on = p.hl === key, dim = p.hl && !on;
      var g = '<g class="lane' + (on ? ' hl' : '') + (dim ? ' dim' : '') + '">' + box(10, y - 46, 580, 108, on ? 'hl' : '', { rx: 14 }) +
        tx(26, y - 24, name, 'ctb') + tx(26, y - 8, tag, 'cts') +
        node(52, y + 26, 'server', '', '', '', { r: 15 }) + node(546, y + 26, 'server', '', '', '', { r: 15 }) +
        wire([[74, y + 26], [522, y + 26]], { st: 'dim', arrow: false });
      pk.forEach(function (k, i) {
        var x = 112 + i * 86;
        g += rev(i, '<g class="pkt ' + (k[1] || '') + '" transform="translate(' + x + ' ' + (y + 26) + ')"><rect x="-26" y="-13" width="52" height="26" rx="7"/>' + tx(0, 5, k[0], 'pkt-t', 'middle') + '</g>' +
          (k[1] === 'lost' ? xmark(x + 26, y + 12, 7) : k[1] === 're' ? tx(x, y + 56, 'retransmit', 'ctm gold', 'middle') : k[1] === 'acked' ? tx(x, y + 56, 'ACK', 'ctm ok', 'middle') : ''), 0.25);
      });
      g += tx(578, y - 24, ex, 'ctm', 'end');
      return g + probe([[74, y + 26], [522, y + 26]], key === 'udp' ? 1.6 : 2.6, key === 'udp' ? C.violet : C.mint) + '</g>';
    }
    out += lane(60, 'tcp', 'TCP', 'handshake · ordered · ACKs · retransmits', [['SYN'], ['1', 'acked'], ['2', 'acked'], ['3', 'lost'], ['3', 're']], 'HTTPS · SSH · databases');
    out += lane(184, 'udp', 'UDP', 'no handshake · no ACKs · no retransmits', [['1'], ['2'], ['3', 'lost'], ['4'], ['5']], 'DNS · QUIC/HTTP3 · media');
    return svg('tcp-udp', 600, 254, out);
  });

  // ---------------------------------------------------------------- ports
  var PORT_SETS = {
    common: [['21', '21', 'FTP', 'TCP'], ['22', '22', 'SSH', 'TCP'], ['23', '23', 'Telnet', 'TCP'], ['53', '53', 'DNS', 'UDP + TCP'],
      ['80', '80', 'HTTP', 'TCP'], ['111', '111', 'portmapper', 'RPC'], ['443', '443', 'HTTPS', 'TCP'], ['445', '445', 'SMB', 'TCP'],
      ['636', '636', 'LDAPS', 'TCP'], ['1433', '1433', 'SQL Server', 'TCP'], ['1521', '1521', 'Oracle', 'TCP'], ['2049', '2049', 'NFS', 'TCP/UDP'],
      ['3306', '3306', 'MySQL', 'TCP'], ['5432', '5432', 'PostgreSQL', 'TCP'], ['9092', '9092', 'Kafka', 'TCP'], ['9093', '9093', 'Kafka TLS', 'TCP']],
    'dbx-aws': [['self', 'SG', 'All TCP + UDP', 'to the same SG'], ['443', '443', 'Infra · data · repos', 'TCP egress'], ['3306', '3306', 'Legacy Hive metastore', 'TCP egress'],
      ['5432', '5432', 'Lakebase', 'TCP egress'], ['6666', '6666', 'SCC relay', 'PrivateLink only'], ['2443', '2443', 'FIPS endpoints', 'compliance profile'],
      ['8443', '8443', 'Control-plane API', 'TCP egress'], ['8444', '8444', 'UC logging + lineage', 'TCP egress'], ['8445', '8445', 'Control-plane API', 'TCP egress'],
      ['8446', '8446–51', 'Reserved', 'future use'], ['53', '53', 'DNS', 'custom DNS only']],
    'azure-nsg': [['adb', 'AzureDatabricks', '443 · 3306 · 8443–8451', 'outbound'], ['storage', 'Storage', '443', 'outbound'], ['eventhub', 'EventHub', '9093', 'outbound'],
      ['sql', 'Sql', '3306', 'outbound'], ['vnet', 'VirtualNetwork', 'any', 'outbound'], ['in-22', 'AzureDatabricks', '22 · 5557 inbound', 'only if SCC is off']]
  };
  var PORT_TITLE = { common: 'Well-known ports', 'dbx-aws': 'AWS workspace security group · egress rules', 'azure-nsg': 'Azure managed workspace NSG · service tags' };
  def('ports', 'Port badges', { set: { t: 'enum', v: Object.keys(PORT_SETS) }, hl: { t: 'list', of: { t: 'str', max: 12 }, min: 1, max: 8 }, bad: { t: 'list', of: { t: 'str', max: 12 }, min: 1, max: 4 } },
    { set: 'common', hl: ['22'] }, function (p) {
      var set = PORT_SETS[p.set || 'common'], cols = set.length === 6 || p.set === 'dbx-aws' ? 3 : 4, gap = 10, bw = (600 - 24 - gap * (cols - 1)) / cols, bh = 54;
      var hl = p.hl || [], bad = p.bad || [], any = hl.length || bad.length, out = tx(12, 22, PORT_TITLE[p.set || 'common'], 'cth on');
      var tag = p.set === 'azure-nsg';
      set.forEach(function (b, i) {
        var x = 12 + (i % cols) * (bw + gap), y = 36 + Math.floor(i / cols) * (bh + gap);
        var st = hl.indexOf(b[0]) >= 0 ? 'hl' : bad.indexOf(b[0]) >= 0 ? 'bad' : '';
        out += rev(i, '<g class="badge ' + st + (any && !st ? ' dim' : '') + '">' + box(x, y, bw, bh, st, { rx: 11 }) +
          (tag
            ? tx(x + 12, y + 22, b[1], 'bd-n sm') + tx(x + 12, y + 41, b[2], 'bd-s') + tx(x + bw - 10, y + 22, b[3], 'bd-p', 'end')
            : tx(x + 12, y + 33, b[1], 'bd-n') + tx(x + 12 + b[1].length * 12 + 8, y + 24, b[2], 'bd-l') + tx(x + 12 + b[1].length * 12 + 8, y + 41, b[3], 'bd-s')) +
          (st === 'bad' ? xmark(x + bw - 14, y + 14, 7) : st === 'hl' ? tick(x + bw - 14, y + 14, 7) : '') + '</g>', 0.04);
      });
      var rows = Math.ceil(set.length / cols);
      return svg('ports', 600, 36 + rows * (bh + gap) + 2, out);
    }, function (p) {
      var ids = PORT_SETS[p.set || 'common'].map(function (b) { return b[0]; });
      return (p.hl || []).concat(p.bad || []).filter(function (h) { return ids.indexOf(h) < 0; }).map(function (h) { return 'port badge "' + h + '" is not in set ' + (p.set || 'common'); });
    });

  // ---------------------------------------------------------------- DNS record types
  var DNS_REC = [['A', 'name → IPv4 address', 'api.example.com → 203.0.113.7'], ['AAAA', 'name → IPv6 address', 'api.example.com → 2001:db8::7'],
    ['CNAME', 'alias → another name', 'www.example.com → api.example.com'], ['MX', 'domain → mail server', 'example.com → 10 mail.example.com'],
    ['TXT', 'domain → free text', 'example.com → "v=spf1 …" (SPF, verification)'], ['NS', 'zone → its name servers', 'example.com → ns1.example.net'],
    ['PTR', 'IP → name (reverse)', '7.113.0.203.in-addr.arpa → api.example.com']];
  def('dns-records', 'DNS record types', { hl: { t: 'enum', v: DNS_REC.map(function (r) { return r[0]; }) } }, { hl: 'A' }, function (p) {
    var out = tx(14, 24, 'Type', 'cth') + tx(92, 24, 'Maps', 'cth') + tx(258, 24, 'Example', 'cth');
    DNS_REC.forEach(function (r, i) {
      var y = 34 + i * 35, on = p.hl === r[0];
      out += rev(i, '<g class="trow' + (on ? ' hl' : '') + (p.hl && !on ? ' dim' : '') + '">' + box(8, y, 584, 30, on ? 'hl' : '', { rx: 8 }) +
        tx(18, y + 20, r[0], 'tr-k') + tx(92, y + 20, r[1], 'tr-l') + tx(258, y + 20, r[2], 'tr-e') + '</g>', 0.08);
    });
    return svg('dns-records', 600, 34 + 7 * 35 + 4, out);
  });

  // ---------------------------------------------------------------- DNS resolution
  def('dns-resolve', 'DNS resolution: stub → resolver → root → TLD → authoritative', { hl: { t: 'enum', v: ['all', 'root', 'tld', 'auth', 'cache', 'port'] } }, { hl: 'all' }, function (p) {
    var cl = [58, 150], rs = [220, 150], rt = [478, 50], td = [478, 150], au = [478, 250], h = p.hl, out = '';
    out += region(400, 12, 190, 300, 'DNS hierarchy', { color: C.violet });
    out += node(cl[0], cl[1], 'user', 'Your device', 'stub resolver', '') +
      node(rs[0], rs[1], 'dns', 'Recursive resolver', h === 'cache' ? 'cache hit until TTL ends' : 'does the legwork · caches', h === 'cache' ? 'hl' : '');
    out += node(rt[0], rt[1], 'dns', 'Root ( . )', 'refers to .com', h === 'root' ? 'hl' : '') +
      node(td[0], td[1], 'dns', '.com TLD', 'refers to example.com', h === 'tld' ? 'hl' : '') +
      node(au[0], au[1], 'dns', 'example.com', 'authoritative · A record', h === 'auth' ? 'hl' : '');
    out += rev(0, link(cl, rs, { label: h === 'port' ? 'UDP 53 (TCP 53 if large)' : '① docs.example.com ?', st: h === 'port' ? 'hl' : '', flow: true, at: [139, 124] }));
    out += rev(1, link(rs, rt, { label: '② try .com', st: h === 'root' ? 'hl' : '', both: true, at: [350, 96] }));
    out += rev(2, link(rs, td, { label: '③ try ns1.example.com', st: h === 'tld' ? 'hl' : '', both: true, at: [350, 150] }));
    out += rev(3, link(rs, au, { label: '④ A 203.0.113.10', st: h === 'auth' ? 'hl' : '', both: true, at: [372, 216] }));
    out += rev(4, tx(139, 100, '⑤ answer + TTL 300s', 'ctm ' + (h === 'cache' ? 'gold' : 'ok'), 'middle'));
    if (h === 'cache') out += pill(rs[0], 70, 'cached → next query skips ② ③ ④', 'hl');
    out += probe([[88, 150], [190, 150], [450, 60], [190, 150], [448, 150], [190, 150], [450, 240], [190, 150], [88, 150]], 6, C.gold);
    return svg('dns-resolve', 600, 316, out);
  });

  // ---------------------------------------------------------------- CNAME chain / split horizon
  var CN = {
    generic: ['workspace.example.com', 'workspace.privatelink.example.com', 'private zone: privatelink.example.com'],
    aws: ['myws.cloud.databricks.com', 'sydney.privatelink.cloud.databricks.com', 'private zone: privatelink.cloud.databricks.com'],
    azure: ['adb-1234.5.azuredatabricks.net', 'adb-1234.5.privatelink.azuredatabricks.net', 'private zone: privatelink.azuredatabricks.net']
  };
  def('cname-chain', 'CNAME chain and split-horizon DNS', { view: { t: 'enum', v: ['private', 'missing'] }, cloud: { t: 'enum', v: ['generic', 'aws', 'azure'] } }, { view: 'private' }, function (p) {
    var n = CN[p.cloud || 'generic'], miss = p.view === 'missing', out = '';
    function col3(x, head, sub, last, lastSt, zone, missing) {
      var w = 282, g = '<g class="ccol">' + tx(x, 24, head, 'cth on') + tx(x, 40, sub, 'cts');
      g += rev(0, box(x, 52, w, 34, '', { rx: 9 }) + tx(x + 12, 74, n[0], 'tr-e'));
      if (missing) {
        g += rev(1, '<g class="dim">' + box(x, 124, w, 34, 'bad', { rx: 9 }) + tx(x + 12, 146, n[1], 'tr-e') + '</g>' + xmark(x + w - 14, 124, 8));
        g += rev(1, wire([[x + 20, 88], [x + 20, 192]], { st: 'bad', x: false }) + pill(x + 160, 106, 'no privatelink CNAME', 'bad'));
      } else {
        g += rev(1, wire([[x + w / 2, 88], [x + w / 2, 122]], {}) + pill(x + w / 2 + 50, 105, 'CNAME', '') + box(x, 124, w, 34, '', { rx: 9 }) + tx(x + 12, 146, n[1], 'tr-e'));
        g += rev(2, wire([[x + w / 2, 160], [x + w / 2, 194]], { st: lastSt === 'bad' ? '' : lastSt }) + pill(x + w / 2 + 60, 177, zone, lastSt === 'ok' ? 'ok' : ''));
      }
      g += rev(3, box(x, 196, w, 40, lastSt, { rx: 10 }) + tx(x + 12, 222, last, 'tr-k') + mark(lastSt === 'hl' ? 'ok' : lastSt, x + w - 18, 216));
      return g + '</g>';
    }
    out += col3(10, 'Inside your network', 'private zone linked to your network', miss ? 'public IP · private path skipped' : '10.0.3.5 · endpoint private IP', miss ? 'bad' : 'ok', 'A · private zone', miss);
    out += col3(308, 'From the internet', 'public DNS', 'public IP (internet-routable)', '', 'A · public DNS', false);
    out += probe([[30, 70], [30, 140], [30, 214]], 2.6, miss ? C.rose : C.mint);
    return svg('cname-chain', 600, 248, out);
  });

  // ---------------------------------------------------------------- hybrid DNS forwarding
  def('hybrid-dns', 'Hybrid DNS: conditional forwarding to an inbound resolver', { broken: { t: 'bool' }, cloud: { t: 'enum', v: ['aws', 'azure', 'both'] } }, { cloud: 'azure' }, function (p) {
    var res = { aws: 'Route 53 Resolver inbound', azure: 'Azure DNS Private Resolver', both: 'R53 / Azure DNS Private Resolver' }[p.cloud || 'both'];
    var b = !!p.broken, out = '';
    out += region(10, 14, 255, 290, 'On-prem', { color: C.ice }) + region(300, 14, 290, 196, p.cloud === 'aws' ? 'Your VPC' : p.cloud === 'azure' ? 'Your VNet' : 'VPC / VNet', {});
    out += node(62, 100, 'user', 'On-prem user', '', '') + node(196, 100, 'dns', 'On-prem DNS', b ? 'forwards → 8.8.8.8' : 'conditional forwarder', b ? 'bad' : 'ok');
    out += link([62, 100], [196, 100], { flow: true });
    out += link([196, 100], [370, 100], { label: 'DX / ER / VPN', st: b ? 'dim' : 'ok', flow: !b, at: [283, 72] });
    out += link([370, 100], [540, 100], { st: b ? 'dim' : '' });
    out += link([196, 100], [370, 256], { st: b ? 'bad' : 'dim', label: b ? 'returns public IP' : 'public names only', at: [262, 224] });
    out += node(370, 100, 'dns', 'Inbound endpoint', res, b ? '' : 'hl') + node(540, 100, 'endpoint', 'Private zone', '→ private IP', '');
    out += node(370, 256, 'cloud', 'Public DNS 8.8.8.8', 'knows only public IPs', b ? 'bad' : '', { color: C.dim });
    out += probe(b ? [[90, 100], [168, 100], [345, 236]] : [[90, 100], [168, 100], [340, 100], [512, 100]], 2.8, b ? C.rose : C.mint);
    return svg('hybrid-dns', 600, 310, out);
  });

  // ---------------------------------------------------------------- Azure private endpoint + private DNS zone
  def('azure-pe-dns', 'Azure Private Endpoint + private DNS zone', { hl: { t: 'enum', v: ['pe', 'zone', 'vip'] } }, { hl: 'pe' }, function (p) {
    var h = p.hl, out = region(10, 14, 390, 290, 'Your VNet', {});
    out += wire([[100, 150], [100, 204]], { both: true, label: '① query · ③ A 10.1.3.5', st: h === 'vip' ? 'hl' : 'ok', at: [118, 178] });
    out += link([100, 240], [300, 240], { label: '② linked zone', st: h === 'zone' ? 'hl' : '' });
    out += link([100, 90], [300, 90], { label: 'TLS 443', flow: true, st: h === 'pe' ? 'hl' : '' }) + link([300, 90], [516, 90], { label: 'Private Link', flow: true, st: 'ok', at: [430, 64] });
    out += node(100, 90, 'server', 'VM / cluster', 'resolves the name', '') + node(300, 90, 'endpoint', 'Private endpoint', 'NIC 10.1.3.5', h === 'pe' ? 'hl' : '');
    out += node(100, 240, 'dns', '168.63.129.16', 'Azure DNS (platform VIP)', h === 'vip' ? 'hl' : '') + node(300, 240, 'dns', 'Private DNS zone', 'privatelink.blob.core.windows.net', h === 'zone' ? 'hl' : '');
    out += node(516, 90, 'db', 'Storage account', 'one specific resource', '');
    out += probe([[128, 90], [484, 90]], 2.4, C.mint);
    return svg('azure-pe-dns', 600, 312, out);
  });

  // ---------------------------------------------------------------- CIDR bit split
  def('cidr', 'CIDR: network bits vs host bits', {
    prefix: { t: 'int', min: 0, max: 32 }, ip: { t: 'ip' }, cloud: { t: 'enum', v: ['none', 'aws', 'azure', 'gcp'] },
    perNode: { t: 'int', min: 0, max: 2 }, need: { t: 'int', min: 1, max: 100000 }
  }, { prefix: 24, ip: '10.0.1.0', cloud: 'aws' }, function (p) {
    var pre = p.prefix == null ? 24 : p.prefix, cloud = p.cloud || 'none', R = RESERVED[cloud], res = R ? R.n : 0, per = p.perNode || 0;
    var base = ipInt(p.ip || '10.0.0.0') & maskOf(pre), size = Math.pow(2, 32 - pre), usable = size - res, out = '';
    var bits = ('00000000000000000000000000000000' + (base >>> 0).toString(2)).slice(-32);
    out += tx(12, 30, intIp(base) + '/' + pre, 'cbig') + tx(588, 30, intIp(base) + ' – ' + intIp((base + size - 1) >>> 0), 'ctm', 'end');
    var cw = 16.2, x0 = 18;
    var xb = function (i) { return x0 + i * cw + Math.floor(i / 8) * 7; };
    for (var o = 0; o < 4; o++) out += tx(xb(o * 8) + cw * 4, 52, String((base >>> (24 - 8 * o)) & 255), 'ctm dim', 'middle');
    var bitsOut = '';
    for (var i = 0; i < 32; i++) {
      var net = i < pre;
      bitsOut += '<g class="bit ' + (net ? 'net' : 'host') + '" style="animation-delay:' + (i * 0.025).toFixed(3) + 's"><rect x="' + r1(xb(i)) + '" y="60" width="' + (cw - 2) + '" height="28" rx="4"/>' + tx(xb(i) + (cw - 2) / 2, 79, net ? bits[i] : 'x', 'bit-t', 'middle') + '</g>';
    }
    out += '<g class="bits">' + bitsOut + '</g>';
    var bx = pre === 0 ? x0 - 4 : xb(pre - 1) + cw + 1;
    if (pre > 0) out += '<path class="brk net" d="M' + x0 + ' 96v6H' + r1(bx - 3) + 'v-6"/>' + tx((x0 + bx) / 2, 118, 'network · ' + pre + ' bits', 'ctm cyan', 'middle');
    if (pre < 32) out += '<path class="brk host" d="M' + r1(bx + 3) + ' 96v6H' + r1(xb(31) + cw - 2) + 'v-6"/>' + tx((bx + xb(31) + cw) / 2, 118, 'host · ' + (32 - pre) + ' bits', 'ctm mint', 'middle');
    out += '<line class="split" x1="' + r1(bx) + '" y1="54" x2="' + r1(bx) + '" y2="94"/>';
    var y = 150, lines = [];
    lines.push(['2^(32 − ' + pre + ') = 2^' + (32 - pre) + ' = ' + n2(size) + ' addresses', 'eq']);
    if (R) lines.push(['− ' + res + ' reserved (' + R.name + '): ' + R.list.join(' · '), 'eq-r']);
    if (R) lines.push(['= ' + n2(usable) + ' usable IPs', 'eq-u']);
    if (R && per === 2) lines.push(['÷ 2 IPs per Databricks node (AWS) → floor(' + n2(usable) + ' / 2) = ' + n2(Math.floor(usable / 2)) + ' nodes', 'eq-n']);
    if (R && per === 1) lines.push(['1 IP per node in each subnet (Azure) → max ' + n2(usable) + ' nodes', 'eq-n']);
    if (p.need) {
      var want = p.need * (per || 1), cap = function (q) { return Math.pow(2, 32 - q) - res; }, okp = cap(pre) >= want, prev = pre < 32 ? cap(pre + 1) : null;
      lines.push(['need ' + n2(want) + (per === 2 ? ' IPs (' + n2(p.need) + ' nodes × 2)' : ' usable') + ': /' + pre + ' gives ' + n2(cap(pre)) + (okp ? ' ✓' : ' ✗') + (prev != null ? '  ·  /' + (pre + 1) + ' gives ' + n2(prev) + (prev >= want ? ' ✓' : ' ✗') : ''), okp ? 'eq-ok' : 'eq-bad']);
    }
    lines.forEach(function (l, k) { out += rev(k + 1, tx(14, y + k * 27, l[0], l[1]), 0.4); });
    return svg('cidr', 600, y + lines.length * 27 - 6, out);
  });

  // ---------------------------------------------------------------- carve a block into subnets
  def('carve', 'Carving a block into subnets', { parent: { t: 'int', min: 8, max: 30 }, child: { t: 'int', min: 9, max: 32 }, ip: { t: 'ip' }, labels: { t: 'list', of: { t: 'str', max: 22 }, min: 1, max: 8 } },
    { parent: 24, child: 26, ip: '10.0.1.0' }, function (p) {
      var P = p.parent, Cc = p.child, base = ipInt(p.ip || '10.0.0.0') & maskOf(P), n = Math.pow(2, Cc - P), sz = Math.pow(2, 32 - Cc), show = Math.min(n, 16), out = '';
      out += tx(12, 28, intIp(base) + '/' + P, 'cbig') + tx(588, 28, n2(Math.pow(2, 32 - P)) + ' addresses', 'ctm', 'end');
      out += box(12, 40, 576, 34, '', { rx: 9 }) + tx(300, 62, 'one /' + P + ' block', 'tr-l', 'middle');
      var w = (576 - (show - 1) * 4) / show;
      for (var i = 0; i < show; i++) {
        var x = 12 + i * (w + 4), last = n > 16 && i === show - 1;
        var lab = p.labels && p.labels[i] ? p.labels[i] : last ? '… ' + n2(n) + ' total' : show <= 8 ? intIp((base + i * sz) >>> 0) + '/' + Cc : String(i + 1);
        out += '<g class="sub" style="animation-delay:' + (0.3 + i * 0.07).toFixed(2) + 's">' + box(x, 112, w, 44, 'ok', { rx: 8 }) + tx(x + w / 2, 139, lab, show <= 8 ? 'ctm' : 'ctm sm', 'middle') + '</g>';
      }
      out += wire([[300, 78], [300, 108]], { st: 'ok' });
      out += rev(2, tx(14, 186, '/' + P + ' → /' + Cc + ' moves the boundary ' + (Cc - P) + ' bit' + (Cc - P === 1 ? '' : 's') + ' right: 2^' + (Cc - P) + ' = ' + n2(n) + ' subnets', 'eq'), 0.5);
      out += rev(3, tx(14, 212, 'each /' + Cc + ' = 2^(32 − ' + Cc + ') = ' + n2(sz) + ' addresses · +1 bit: 2× the subnets, ½ the size', 'eq-r'), 0.5);
      return svg('carve', 600, 224, out);
    }, function (p) { return p.child <= p.parent ? ['carve: child prefix must be longer than parent'] : []; });

  // ---------------------------------------------------------------- RFC 1918
  def('rfc1918', 'Private address ranges (RFC 1918) vs CGNAT', { hl: { t: 'enum', v: ['10', '172', '192', 'cgnat'] } }, { hl: 'cgnat' }, function (p) {
    var R = [['10', '10.0.0.0/8', 16777216, 'RFC 1918 · private', 8], ['172', '172.16.0.0/12', 1048576, 'RFC 1918 · private', 12], ['192', '192.168.0.0/16', 65536, 'RFC 1918 · private', 16], ['cgnat', '100.64.0.0/10', 4194304, 'RFC 6598 · carrier-grade NAT (not RFC 1918)', 10]];
    var out = '';
    R.forEach(function (r, i) {
      var y = 18 + i * 58, on = p.hl === r[0], cg = r[0] === 'cgnat', w = 80 + (32 - r[4]) * 13;
      out += rev(i, '<g class="trow' + (on ? ' hl' : '') + (p.hl && !on ? ' dim' : '') + '">' + tx(12, y + 18, r[1], 'tr-k') + tx(150, y + 18, r[3], cg ? 'cts rose' : 'cts') +
        box(12, y + 26, w, 18, on ? 'hl' : cg ? 'bad' : 'ok', { rx: 6 }) + tx(w + 22, y + 40, n2(r[2]) + ' addresses', 'ctm') + '</g>', 0.15);
    });
    return svg('rfc1918', 600, 250, out);
  });

  // ---------------------------------------------------------------- route table + longest prefix match
  def('route-table', 'Route table lookup: longest prefix match', { dest: { t: 'ip' }, routes: { t: 'routes' } },
    { dest: '10.1.4.20', routes: [['10.0.0.0/8', 'Transit GW'], ['10.1.0.0/16', 'Peering'], ['0.0.0.0/0', 'NAT gateway']] }, function (p) {
      var routes = p.routes || FIG['route-table'].sample.routes, dest = p.dest || '10.1.4.20';
      var best = -1, bestLen = -1;
      routes.forEach(function (r, i) { var len = +r[0].split('/')[1]; if (inCidr(dest, r[0]) && len > bestLen) { best = i; bestLen = len; } });
      var out = pill(70, 26, 'dst ' + dest, 'hl') + tx(140, 31, 'which route matches most bits?', 'cts');
      out += tx(16, 66, 'Destination', 'cth') + tx(176, 66, 'Target', 'cth') + tx(318, 66, 'Match?', 'cth');
      routes.forEach(function (r, i) {
        var y = 76 + i * 42, m = inCidr(dest, r[0]), win = i === best, len = r[0].split('/')[1];
        out += rev(i, '<g class="trow' + (win ? ' hl' : '') + (!m ? ' dim' : '') + '">' + box(8, y, 430, 34, win ? 'hl' : '', { rx: 8 }) +
          tx(18, y + 22, r[0], 'tr-k') + tx(176, y + 22, r[1], 'tr-l') +
          tx(318, y + 22, m ? (win ? '/' + len + ' · longest ✓' : '/' + len + ' · matches') : 'no match', m ? (win ? 'ctm gold' : 'ctm') : 'ctm dim') + '</g>', 0.3);
      });
      var by = 76 + best * 42 + 17;
      if (best >= 0) {
        out += rev(routes.length, wire([[440, by], [492, by]], { st: 'hl', flow: true }) + node(530, by, 'router', routes[best][1], 'next hop', 'hl'), 0.3);
        out += probe([[70, 40], [70, 52], [200, by], [496, by]], 2.6, C.gold);
      }
      return svg('route-table', 600, Math.max(76 + routes.length * 42 + 10, by + 70), out);
    }, function (p) { return p.dest && p.routes && !p.routes.some(function (r) { return isCidr(r[0]) && inCidr(p.dest, r[0]); }) ? ['route-table: no route matches dest'] : []; });

  // ---------------------------------------------------------------- peering / hub-spoke / overlap
  def('peering', 'Peering is non-transitive; hubs route between spokes', { mode: { t: 'enum', v: ['peering', 'hub', 'overlap'] }, cloud: { t: 'enum', v: ['aws', 'azure', 'any'] } }, { mode: 'peering' }, function (p) {
    var out = '', m = p.mode || 'peering';
    if (m === 'peering') {
      out += node(90, 150, 'vpc', 'VPC A', '10.1.0.0/16', '') + node(300, 150, 'vpc', 'VPC B', '10.2.0.0/16', '') + node(510, 150, 'vpc', 'VPC C', '10.3.0.0/16', '');
      out += link([90, 150], [300, 150], { label: 'peer', st: 'ok', both: true, flow: true }) + link([300, 150], [510, 150], { label: 'peer', st: 'ok', both: true, flow: true });
      out += '<g class="cw bad"><path class="cw-line" d="M104 118 Q300 0 496 118" marker-end="' + mref('bad') + '"/></g>' + pill(300, 60, 'A → C through B: no transit', 'bad') + xmark(300, 84);
      out += tx(300, 236, 'each peering links exactly two networks', 'cts', 'middle');
      return svg('peering', 600, 248, out);
    }
    if (m === 'overlap') {
      out += node(140, 120, 'vpc', 'VPC A', '10.0.0.0/16', 'bad') + node(460, 120, 'vpc', 'VPC B', '10.0.0.0/16', 'bad');
      out += link([140, 120], [460, 120], { st: 'bad', label: 'peering / TGW / VPN refused' });
      out += pill(300, 196, 'dst 10.0.1.5 → A or B? ambiguous', 'hl') + tx(300, 228, 'every connected network needs a unique, non-overlapping CIDR', 'cts', 'middle');
      return svg('peering', 600, 240, out);
    }
    var hub = { aws: ['Transit Gateway', 'routes between attachments'], azure: ['Hub VNet + NVA', 'or Virtual WAN hub · UDRs'], any: ['Hub', 'TGW · Virtual WAN · hub VNet + NVA'] }[p.cloud || 'any'];
    out += node(300, 140, 'router', hub[0], hub[1], 'hl', { r: 26 });
    [[90, 56, 'vpc', 'Spoke 1'], [90, 224, 'vpc', 'Spoke 2'], [510, 224, 'vpc', 'Spoke 3'], [510, 56, 'onprem', 'On-prem']].forEach(function (s, i) {
      out += node(s[0], s[1], s[2], s[3], '', '') + link([s[0], s[1]], [300, 140], { both: true, flow: true, rb: 38, label: s[3] === 'On-prem' ? 'DX / ER / VPN' : '', st: 'ok' });
    });
    out += pill(300, 210, 'inspect + route here', 'hl');
    out += probe([[118, 70], [270, 130], [300, 140], [330, 152], [482, 212]], 2.8, C.gold);
    return svg('peering', 600, 276, out);
  });

  // ---------------------------------------------------------------- NAT / PAT
  def('nat', 'NAT gateway: source NAT + port translation', { hl: { t: 'enum', v: ['snat', 'placement', 'stable', 'return'] } }, { hl: 'snat' }, function (p) {
    var h = p.hl, out = '';
    out += region(10, 14, 420, 230, 'VPC', {});
    out += region(22, 40, 170, 192, 'Private subnet', { color: C.cyan, rx: 10 }) + region(210, 40, 208, 192, 'Public subnet', { color: C.violet, rx: 10, st: h === 'placement' ? 'hl' : '' });
    out += pill(107, 70, 'RT 0/0 → NAT', h === 'placement' ? 'hl' : '') + pill(314, 70, 'RT 0/0 → IGW', h === 'placement' ? 'hl' : '');
    out += node(107, 142, 'server', 'Private VM', '10.0.1.12', '') + node(314, 142, 'nat', 'NAT gateway', 'EIP 203.0.113.10', h === 'placement' || h === 'stable' ? 'hl' : '');
    out += node(462, 142, 'gateway', 'IGW', '', '', { r: 16 }) + nebula(545, 142, 60, 70, 'internet');
    out += node(548, 118, 'cloud', 'Partner API', h === 'stable' ? 'allowlists 203.0.113.10' : 'sees 203.0.113.10', h === 'stable' ? 'hl' : '');
    out += wire([[138, 132], [280, 132]], { flow: true, st: h === 'snat' ? 'hl' : '' }) + wire([[346, 132], [442, 132]], { flow: true }) + wire([[480, 128], [516, 118]], { flow: true });
    out += wire([[280, 156], [138, 156]], { st: h === 'return' ? 'hl' : 'ok', dash: true, label: 'reply', at: [209, 156] });
    out += wire([[540, 222], [360, 222]], { st: 'bad', label: 'new inbound', at: [470, 222], xat: [384, 222] });
    var t = h === 'snat' || h === 'return' ? 'hl' : '';
    out += rev(1, box(10, 256, 580, 56, t, { rx: 10 }) + tx(24, 276, 'NAT table (SNAT + PAT)', 'cth' + (t ? ' on' : '')) +
      tx(24, 299, 'src 10.0.1.12:51514  →  203.0.113.10:40001', 'tr-k') + tx(580, 299, 'only inside-initiated flows get an entry', 'cts', 'end'));
    out += probe([[138, 132], [280, 132], [346, 132], [442, 132], [516, 118]], 2.8, C.cyan);
    return svg('nat', 600, 320, out);
  });

  // ---------------------------------------------------------------- stateful vs stateless
  def('stateful', 'Stateful vs stateless filtering', { hl: { t: 'enum', v: ['stateful', 'stateless'] }, broken: { t: 'bool' } }, { hl: 'stateless', broken: true }, function (p) {
    var out = '';
    function panel(x, key, title, who, retLabel, retSt, table) {
      var on = p.hl === key, g = '<g class="panel' + (on ? ' hl' : '') + (p.hl && !on ? ' dim' : '') + '">' + box(x, 12, 284, 266, on ? 'hl' : '', { rx: 14 });
      g += tx(x + 14, 36, title, 'ctb') + tx(x + 14, 54, who, 'cts');
      g += node(x + 44, 140, 'server', 'Instance', '', '', { r: 18 }) + node(x + 242, 140, 'cloud', 'Internet', '', '', { r: 18 });
      g += '<rect class="fw-wall" x="' + (x + 128) + '" y="82" width="26" height="118" rx="5"/>' + '<g class="cn-ico fw" transform="translate(' + (x + 129) + ' 129)">' + icon('firewall') + '</g>';
      g += wire([[x + 66, 128], [x + 218, 128]], { flow: true, st: 'ok', label: 'out → :443', at: [x + 141, 104] });
      g += wire([[x + 218, 152], [x + 66, 152]], { st: retSt, flow: retSt === 'ok', label: retLabel, at: [x + 141, 200], xat: [x + 186, 152] });
      g += tx(x + 14, 232, table[0], 'ctm' + (retSt === 'bad' ? ' rose' : '')) + tx(x + 14, 250, table[1], 'cts');
      return g + '</g>';
    }
    out += panel(8, 'stateful', 'Stateful', 'Security group · NSG · Azure Firewall', 'reply auto-allowed', 'ok', ['tracks the connection', 'write the rule for the side that starts it']);
    var bad = !!p.broken;
    out += panel(308, 'stateless', 'Stateless', 'AWS Network ACL (subnet edge)', bad ? 'reply to :51514 dropped' : 'in 1024–65535 rule', bad ? 'bad' : 'ok', [bad ? 'no inbound ephemeral rule' : 'inbound 1024–65535 allowed', 'every direction needs its own rule']);
    out += probe([[74, 128], [226, 128], [226, 152], [74, 152]], 2.6, C.mint);
    return svg('stateful', 600, 290, out);
  });

  // ---------------------------------------------------------------- TLS handshake
  def('tls', 'TLS handshake (simplified)', { mtls: { t: 'bool' }, hl: { t: 'enum', v: ['hello', 'cert', 'validate', 'keys'] } }, {}, function (p) {
    var cx = 130, sx = 470, out = '', y = 64;
    out += node(cx, 30, 'user', '', '', '', { r: 15 }) + node(sx, 30, 'server', '', '', '', { r: 15 }) + tx(cx - 24, 35, 'Client', 'ct', 'end') + tx(sx + 24, 35, 'Server', 'ct');
    var M = [['hello', 'r', 'ClientHello', 'ciphers + SNI hostname'], ['hello', 'l', 'ServerHello', 'chosen cipher'], ['cert', 'l', 'Certificate', 'chain: leaf + intermediates (up to a root CA)']];
    if (p.mtls) M.push(['cert', 'l', 'CertificateRequest', 'server asks for a client cert'], ['cert', 'r', 'Client certificate', 'server validates it too']);
    var n = M.length + 2, end = y + n * 44;
    out += '<path class="life" d="M' + cx + ' 50V' + end + 'M' + sx + ' 50V' + end + '"/>';
    M.forEach(function (m, i) {
      var yy = y + i * 44, st = p.hl === m[0] ? 'hl' : '', a = m[1] === 'r' ? [cx + 4, sx - 6] : [sx - 4, cx + 6];
      out += rev(i, wire([[a[0], yy], [a[1], yy + 14]], { st: st }) + pill(300, yy + 7, m[2], st) + tx(300, yy + 32, m[3], 'cts', 'middle'), 0.45);
    });
    var vy = y + M.length * 44;
    out += rev(M.length, box(cx - 110 + 20, vy - 8, 210, 34, p.hl === 'validate' ? 'hl' : 'ok', { rx: 9 }) + tx(cx - 78, vy + 8, 'validate: trusted CA?', 'ctm') + tx(cx - 78, vy + 21, 'hostname in SAN?', 'ctm') + tick(cx + 106, vy + 9, 8), 0.45);
    var ky = vy + 52;
    out += rev(M.length + 1, wire([[cx + 4, ky], [sx - 6, ky]], { st: p.hl === 'keys' ? 'hl' : 'ok', flow: true, both: true }) + tx(300, ky - 8, 'keys agreed → encrypted application data', 'cts ok', 'middle'), 0.45);
    out += probe([[cx, y], [sx, y + 14], [cx, y + 58], [cx, ky], [sx, ky]], 4, C.gold);
    return svg('tls', 600, ky + 16, out);
  });

  // ---------------------------------------------------------------- TLS inspection
  def('tls-inspect', 'TLS-inspecting proxy and the corporate CA', { fixed: { t: 'bool' } }, {}, function (p) {
    var f = !!p.fixed, out = '';
    out += node(78, 110, 'server', 'Cluster', f ? 'trusts Corp CA ✓' : 'trust store: public CAs only', f ? 'ok' : 'bad');
    out += node(300, 110, 'firewall', 'TLS-inspecting proxy', 'Zscaler · Palo Alto', 'hl') + node(522, 110, 'cloud', 'pypi.org :443', 'real cert, public CA', '');
    out += link([78, 110], [300, 110], { label: 'cert signed by Corp CA', st: f ? 'ok' : 'bad', flow: f, both: true, at: [189, 78], xat: [189, 110] });
    out += link([300, 110], [522, 110], { label: 'new TLS session', st: 'ok', flow: true, both: true, at: [411, 78] });
    out += rev(1, f
      ? box(10, 182, 580, 56, 'ok', { rx: 10 }) + tx(24, 204, 'Init script: install the Corp CA into the trust store', 'ctm ok') + tx(24, 224, 'set HTTP(S)_PROXY / NO_PROXY · open 443 to PyPI / Maven', 'cts')
      : box(10, 182, 580, 56, 'bad', { rx: 10 }) + tx(24, 204, 'SSL: CERTIFICATE_VERIFY_FAILED', 'ctm rose') + tx(24, 224, 'the cluster can\'t chain the re-signed certificate to a CA it trusts', 'cts'));
    out += probe([[108, 110], [270, 110], [330, 110], [492, 110]], 2.6, f ? C.mint : C.rose);
    return svg('tls-inspect', 600, 248, out);
  });

  // ---------------------------------------------------------------- L4 vs L7 load balancers
  def('lb', 'L4 vs L7 load balancers', { hl: { t: 'enum', v: ['l4', 'l7'] } }, { hl: 'l7' }, function (p) {
    var h = p.hl, out = '';
    out += node(60, 146, 'user', 'Client', '', '');
    out += node(270, 70, 'lb', 'L7 · ALB / App Gateway', 'reads host · path · headers', h === 'l7' ? 'hl' : h ? 'dimn' : '');
    out += node(270, 222, 'lb', 'L4 · NLB / Azure LB', 'sees only IP + port', h === 'l4' ? 'hl' : h ? 'dimn' : '');
    out += node(510, 34, 'server', '/api pool', '', '', { r: 17 }) + node(510, 112, 'server', '/web pool', '', '', { r: 17 }) + node(510, 222, 'server', 'TCP pool', '', '', { r: 17 });
    out += link([60, 146], [270, 70], { flow: true }) + link([60, 146], [270, 222], { flow: true });
    out += link([270, 70], [510, 34], { label: '/api/*', st: h === 'l7' ? 'hl' : '', rb: 26 }) + link([270, 70], [510, 112], { label: '/web/*', st: h === 'l7' ? 'hl' : '', rb: 26 });
    out += link([270, 222], [510, 222], { label: ':443 flow', st: h === 'l4' ? 'hl' : '', rb: 26 });
    out += pill(270, 146, h === 'l4' ? '10.0.0.5:443 → pick a target' : 'GET /api/orders · Host: shop', 'hl');
    out += probe([[88, 140], [242, 78], [298, 64], [484, 38]], 2.4, C.gold);
    return svg('lb', 600, 284, out);
  });

  // ---------------------------------------------------------------- forward / transparent / reverse proxy
  def('proxy', 'Forward, transparent and reverse proxies', { hl: { t: 'enum', v: ['forward', 'transparent', 'reverse'] } }, { hl: 'forward' }, function (p) {
    var out = '';
    var L = [['forward', 'Forward · explicit', 'client sets HTTPS_PROXY / NO_PROXY', ['user', 'Client', 'configured'], ['firewall', 'Forward proxy', 'egress for clients'], ['cloud', 'Internet', '']],
      ['transparent', 'Forward · transparent', 'no client config: intercepted in the path', ['user', 'Client', 'unaware'], ['firewall', 'Proxy in path', 'intercepts'], ['cloud', 'Internet', '']],
      ['reverse', 'Reverse', 'sits in front of servers, takes inbound', ['cloud', 'Internet clients', ''], ['lb', 'Reverse proxy', 'acts for servers'], ['server', 'Servers', '']]];
    L.forEach(function (l, i) {
      var y = 52 + i * 96, on = p.hl === l[0];
      out += '<g class="lane' + (on ? ' hl' : '') + (p.hl && !on ? ' dim' : '') + '">' + box(8, y - 42, 584, 88, on ? 'hl' : '', { rx: 12 }) + tx(20, y - 22, l[1], 'ct') + tx(20, y - 7, l[2], 'cts');
      out += node(270, y + 10, l[3][0], '', '', '', { r: 15 }) + node(410, y + 10, l[4][0], '', '', on ? 'hl' : '', { r: 15 }) + node(546, y + 10, l[5][0], '', '', '', { r: 15 });
      out += tx(270, y + 40, l[3][1], 'cts', 'middle') + tx(410, y + 40, l[4][1], 'cts' + (on ? ' gold' : ''), 'middle') + tx(546, y + 40, l[5][1], 'cts', 'middle');
      out += wire([[290, y + 10], [388, y + 10]], { flow: true, st: on ? 'hl' : '' }) + wire([[432, y + 10], [524, y + 10]], { flow: true });
      out += '</g>';
    });
    return svg('proxy', 600, 304, out);
  });

  // ---------------------------------------------------------------- hybrid connectivity
  def('hybrid', 'Hybrid links: VPN vs dedicated circuits', { hl: { t: 'enum', v: ['vpn', 'dedicated', 'bgp', 'er-peering'] } }, { hl: 'vpn' }, function (p) {
    var h = p.hl, er = h === 'er-peering', out = '';
    out += node(64, 150, 'onprem', 'On-prem DC', 'your routers', '');
    out += nebula(300, 70, 120, 52, 'public internet');
    out += '<g class="cw ' + (h === 'vpn' ? 'hl' : er ? 'dim' : '') + '"><path class="cw-line" d="M92 136 Q300 -10 508 ' + (er ? 92 : 136) + '" marker-end="' + mref(h === 'vpn' ? 'hl' : '') + '"/><path class="cw-flow" d="M92 136 Q300 -10 508 ' + (er ? 92 : 136) + '"/></g>';
    out += pill(300, 86, 'Site-to-site VPN · IPsec', h === 'vpn' ? 'hl' : '') + tx(300, 110, 'cheaper · variable (~1.25 Gbps per AWS tunnel)', 'cts', 'middle');
    var ded = h === 'dedicated' || er ? 'hl' : '';
    out += wire([[94, 170], [300, 232], er ? [506, 232] : [506, 170]], { st: ded, flow: true }) + pill(300, 232, 'Direct Connect · ExpressRoute · Interconnect', ded) + tx(300, 258, 'dedicated private circuit · predictable', 'cts', 'middle');
    if (er) {
      out += node(536, 92, 'vpc', 'Your VNets', 'private peering', 'ok') + node(536, 232, 'cloud', 'Azure PaaS', 'Microsoft peering', 'hl');
      out += wire([[440, 232], [486, 120]], { st: 'ok', label: 'private', at: [470, 168] });
    } else out += node(536, 150, 'vpc', 'Cloud VPC / VNet', '', '');
    out += pill(64, 214, 'BGP', h === 'bgp' ? 'hl' : 'ok') + pill(536, er ? 166 : 214, 'BGP', h === 'bgp' ? 'hl' : 'ok');
    out += probe('M92 136 Q300 -10 508 136', 3, C.violet) + probe([[94, 170], [300, 232], [506, er ? 232 : 170]], 2.4, C.gold);
    return svg('hybrid', 600, 290, out);
  });

  // ---------------------------------------------------------------- endpoint types
  def('endpoints', 'Private, service, gateway and interface endpoints', { hl: { t: 'enum', v: ['pe', 'se', 'gw', 'if', 'pl'] } }, { hl: 'pe' }, function (p) {
    var K = [['pe', 'endpoint', 'Private endpoint', 'Azure Private Link', ['NIC with a PRIVATE IP in your VNet', 'maps to ONE resource', 'needs private DNS']],
      ['se', 'gateway', 'Service endpoint', 'Azure', ['service keeps its PUBLIC IP', 'route optimised over the backbone', 'resource firewall allows your subnet']],
      ['gw', 'router', 'Gateway endpoint', 'AWS', ['route-table entry (prefix list)', 'S3 and DynamoDB only', 'free']],
      ['if', 'endpoint', 'Interface endpoint', 'AWS PrivateLink', ['ENI with a private IP in your subnet', 'many services, incl. Databricks', 'billed per hour + per GB']]];
    var out = '';
    K.forEach(function (k, i) {
      var x = 8 + (i % 2) * 296, y = 8 + Math.floor(i / 2) * 128, on = p.hl === k[0] || (p.hl === 'pl' && (k[0] === 'pe' || k[0] === 'if'));
      out += rev(i, '<g class="card' + (on ? ' hl' : '') + (p.hl && !on ? ' dim' : '') + '">' + box(x, y, 288, 118, on ? 'hl' : '', { rx: 12 }) +
        node(x + 30, y + 32, k[1], '', '', on ? 'hl' : '', { r: 15 }) + tx(x + 56, y + 30, k[2], 'ct') + tx(x + 56, y + 46, k[3], 'cts') +
        k[4].map(function (l, j) { return tx(x + 16, y + 74 + j * 16, '· ' + l, 'ctm sm'); }).join('') + '</g>', 0.12);
    });
    return svg('endpoints', 600, 266, out);
  });

  // ---------------------------------------------------------------- Databricks planes
  def('planes', 'Databricks control plane vs compute plane', { hl: { t: 'enum', v: ['cp', 'classic', 'serverless', 'paths', 'storage'] } }, { hl: 'paths' }, function (p) {
    var h = p.hl, P = h === 'paths', out = '';
    out += region(150, 10, 440, 134, 'Databricks\' cloud account', { color: C.orange }) + region(150, 160, 440, 146, 'Your cloud account', { color: C.cyan, bottom: true });
    // links first so node labels sit on top of them
    out += link([58, 72], [272, 66], { label: '① front end', st: P ? 'hl' : '', flow: true, at: [168, 44] });
    out += wire([[272, 132], [272, 184]], { st: P ? 'hl' : h === 'classic' ? 'ok' : '', both: true, label: '② back end · SCC', at: [272, 152] });
    out += wire([[506, 132], [506, 184]], { st: P ? 'hl' : h === 'serverless' ? 'ok' : '', flow: true, label: '③ serverless → your resources', at: [470, 152] });
    out += link([272, 66], [506, 66], { label: 'cloud backbone', st: h === 'serverless' ? 'ok' : '', at: [389, 40] });
    out += link([272, 218], [506, 218], { label: 'read / write data', flow: true, st: h === 'storage' ? 'ok' : '', at: [389, 196] });
    out += node(58, 72, 'user', 'Users / apps', 'browser · API', '');
    out += node(272, 66, 'dbx', 'Control plane', 'web app · REST APIs · jobs · cluster mgr', h === 'cp' ? 'hl' : '');
    out += node(506, 66, 'dbx', 'Serverless compute', 'Databricks\' account', h === 'serverless' ? 'hl' : '');
    out += node(272, 218, 'vpc', 'Classic compute', 'VMs in YOUR VPC / VNet', h === 'classic' ? 'hl' : '');
    out += node(506, 218, 'db', 'Your storage', 'S3 · ADLS · GCS', h === 'storage' ? 'hl' : '');
    out += probe([[90, 70], [240, 66], [272, 132], [272, 184]], 3, C.gold);
    return svg('planes', 600, 314, out);
  });

  // ---------------------------------------------------------------- secure cluster connectivity
  def('scc', 'Secure cluster connectivity (SCC relay)', { hl: { t: 'enum', v: ['nopub', 'egress', 'tunnel'] }, sccOff: { t: 'bool' } }, { hl: 'nopub' }, function (p) {
    var off = !!p.sccOff, h = p.hl, out = '';
    out += region(10, 14, 330, 274, 'Your VPC / VNet', {}) + region(368, 14, 222, 274, 'Databricks control plane', { color: C.orange });
    out += node(92, 100, 'server', 'Cluster node', off ? 'public IP (legacy)' : 'no public IP', off ? 'bad' : h === 'nopub' ? 'hl' : 'ok');
    out += node(258, 100, 'nat', 'Egress path', 'NAT / firewall or back-end PE', h === 'egress' ? 'hl' : '');
    out += node(478, 100, 'dbx', 'SCC relay', '', h === 'tunnel' ? 'hl' : '') + node(478, 226, 'dbx', 'Control plane', 'cluster manager', '');
    if (!off) {
      out += wire([[122, 92], [228, 92]], { flow: true, st: h === 'tunnel' ? 'hl' : 'ok' }) + wire([[288, 92], [448, 92]], { flow: true, st: h === 'tunnel' ? 'hl' : 'ok', label: 'outbound HTTPS 443 tunnel', at: [368, 66] });
      out += wire([[478, 146], [478, 194]], { both: true, label: 'instructions', at: [478, 170] });
      out += wire([[446, 232], [150, 232], [104, 158]], { st: 'bad', label: 'inbound: none needed', at: [300, 232], xat: [190, 232] });
      if (h === 'egress') out += pill(175, 270, 'must reach: control plane · relay · storage', 'hl');
      else out += pill(175, 270, 'no open inbound ports', h === 'nopub' ? 'hl' : 'ok');
      out += probe([[122, 92], [448, 92], [478, 130], [478, 196]], 3, C.mint);
    } else {
      out += wire([[446, 232], [150, 232], [104, 158]], { st: 'hl', label: 'inbound 22 · 5557 from AzureDatabricks tag', at: [290, 210] });
      out += pill(175, 270, 'legacy: SCC disabled', 'bad') + tx(478, 284, 'with SCC these rules go away', 'cts', 'middle');
    }
    return svg('scc', 600, 296, out);
  });

  // ---------------------------------------------------------------- AWS customer-managed VPC
  def('aws-vpc', 'AWS customer-managed VPC for Databricks', { hl: { t: 'enum', v: ['size', 'az', 'dns', 'sg', 'storage', 'share'] }, badAz: { t: 'bool' } }, { hl: 'az' }, function (p) {
    var h = p.hl, bad = !!p.badAz, out = '';
    out += region(10, 12, 440, 300, 'Customer-managed VPC', {});
    out += pill(330, 30, 'DNS hostnames ✓ · DNS resolution ✓', h === 'dns' ? 'hl' : 'ok');
    function sub(y, az, st) {
      return box(24, y, 190, 86, st, { rx: 10 }) + node(56, y + 38, 'subnet', '', '', st, { r: 15 }) +
        tx(82, y + 28, 'Workspace subnet', 'ct') + tx(82, y + 46, az, 'ctm' + (h === 'az' || st === 'bad' ? (st === 'bad' ? ' rose' : ' gold') : '')) + tx(82, y + 64, '/17–/26 · private', 'ctm' + (h === 'size' ? ' gold' : ''));
    }
    out += sub(54, 'AZ us-east-1a', h === 'az' || h === 'size' ? 'hl' : '') + sub(156, bad ? 'AZ us-east-1a ✗ duplicate' : 'AZ us-east-1b', bad ? 'bad' : h === 'az' || h === 'size' ? 'hl' : '');
    out += pill(230, 262, 'SG: self + 443 · 2443 · 3306 · 5432 · 6666 · 8443–51 · 53', h === 'sg' ? 'hl' : '');
    out += box(236, 54, 200, 86, '', { rx: 10 }) + node(268, 92, 'nat', '', '', '', { r: 15 }) + tx(292, 84, 'Public subnet', 'ct') + tx(292, 102, 'NAT gateway', 'ctm');
    out += box(236, 156, 200, 86, h === 'storage' ? 'hl' : '', { rx: 10 }) + node(268, 196, 'endpoint', '', '', h === 'storage' ? 'hl' : '', { r: 15 }) +
      tx(292, 184, 'S3 gateway endpoint', 'ctm') + tx(292, 202, 'STS + Kinesis', 'ctm') + tx(292, 218, 'interface endpoints', 'ctm');
    out += wire([[214, 97], [236, 97]], { flow: true }) + wire([[214, 199], [236, 199]], { flow: true, st: h === 'storage' ? 'hl' : '' });
    out += node(510, 97, 'gateway', 'IGW', 'control plane · relay', '', { r: 17 }) + node(510, 199, 'db', 'S3 · STS · Kinesis', 'no internet hop', h === 'storage' ? 'hl' : '', { r: 17 });
    out += wire([[436, 97], [488, 97]], { flow: true }) + wire([[436, 199], [488, 199]], { flow: true, st: h === 'storage' ? 'hl' : '' });
    out += tx(20, 300, h === 'share' ? 'VPC (even subnets) can be shared · network config object: one per workspace · unique subnets + SGs recommended' : '≥ 2 subnets, each in a different AZ · one workspace subnet per AZ', 'cts' + (h === 'share' || h === 'az' ? ' gold' : ''));
    out += probe([[120, 97], [236, 97], [488, 97]], 2.4, C.cyan);
    return svg('aws-vpc', 600, 318, out);
  });

  // ---------------------------------------------------------------- Azure VNet injection
  def('azure-vnet', 'Azure VNet injection: host + container subnets', { hl: { t: 'enum', v: ['range', 'subnets', 'delegation', 'outbound', 'nsg', 'share', 'fixed'] } }, { hl: 'subnets' }, function (p) {
    var h = p.hl, out = '';
    out += region(10, 12, 410, 296, 'VNet · /16–/24 · same region + subscription', { st: h === 'range' ? 'hl' : '' });
    function sub(y, name, what) {
      var st = h === 'subnets' || h === 'delegation' || h === 'share' || h === 'fixed' ? 'hl' : '';
      return box(26, y, 236, 108, st, { rx: 10 }) + node(56, y + 34, 'subnet', '', '', st, { r: 15 }) + tx(82, y + 28, name, 'ct') + tx(82, y + 45, what, 'cts') +
        tx(40, y + 72, 'delegated to', 'ctm sm' + (h === 'delegation' ? ' gold' : '')) + tx(40, y + 88, 'Microsoft.Databricks/workspaces', 'ctm sm' + (h === 'delegation' ? ' gold' : '')) +
        pill(222, y + 26, 'NSG', h === 'nsg' ? 'hl' : '');
    }
    out += sub(44, 'Host subnet', 'VM hosts · 1 IP per node') + sub(176, 'Container subnet', 'Spark containers · 1 IP per node');
    out += node(346, 160, 'nat', 'NAT gateway', 'attached to both', h === 'outbound' ? 'hl' : '');
    out += wire([[262, 98], [318, 146]], { flow: true, st: h === 'outbound' ? 'hl' : '' }) + wire([[262, 230], [318, 174]], { flow: true, st: h === 'outbound' ? 'hl' : '' });
    out += nebula(520, 160, 70, 64, '') + node(520, 150, 'cloud', 'Internet', 'stable outbound IP', h === 'outbound' ? 'hl' : '');
    out += wire([[376, 160], [490, 156]], { flow: true, st: h === 'outbound' ? 'hl' : '' });
    var note = { share: 'subnets are dedicated to ONE workspace · no other resources', fixed: 'subnet CIDRs can\'t be edited in place after deployment', outbound: 'new VNets get no default outbound: add NAT GW (or UDR → firewall to filter)', range: 'subnets span the region · no AZ per subnet (unlike AWS)', nsg: 'NSG rules provisioned for you through the delegation' }[h] ||
      'subnets span the region · no AZ per subnet (unlike AWS)';
    out += tx(436, 270, note.length > 30 ? note.slice(0, note.lastIndexOf(' ', 30)) : note, 'cts' + (h ? ' gold' : '')) + (note.length > 30 ? tx(436, 286, note.slice(note.lastIndexOf(' ', 30) + 1).slice(0, 30), 'cts' + (h ? ' gold' : '')) : '');
    out += probe([[230, 98], [318, 146], [376, 160], [490, 156]], 2.6, C.cyan);
    return svg('azure-vnet', 600, 316, out);
  });

  // ---------------------------------------------------------------- GCP customer-managed VPC
  def('gcp-vpc', 'GCP customer-managed (Shared) VPC', { hl: { t: 'enum', v: ['range', 'shared', 'nat'] } }, { hl: 'shared' }, function (p) {
    var h = p.hl, out = '';
    out += region(10, 12, 280, 250, 'Host project', { color: C.violet, st: h === 'shared' ? 'hl' : '' }) + region(310, 12, 280, 250, 'Service project', { color: C.cyan, st: h === 'shared' ? 'hl' : '' });
    out += node(150, 90, 'vpc', 'Shared VPC', 'subnet /29–/9 · workspace region', h === 'range' ? 'hl' : '');
    out += node(150, 202, 'nat', 'Cloud NAT', 'egress without PSC', h === 'nat' ? 'hl' : '');
    out += node(380, 90, 'server', 'Compute VMs', 'no public IPs', '') + node(520, 90, 'db', '2 GCS buckets', 'system data · DBFS root', h === 'shared' ? 'hl' : '');
    out += link([380, 90], [150, 90], { label: 'attached', st: h === 'shared' ? 'hl' : '' }) + link([380, 90], [150, 202], { flow: true, st: h === 'nat' ? 'hl' : '' });
    out += tx(300, 286, 'the VPC can\'t be changed after the workspace is created', 'cts', 'middle');
    return svg('gcp-vpc', 600, 296, out);
  });

  // ---------------------------------------------------------------- Private Link front-end + back-end
  var PL = {
    aws: { tr: 'Transit VPC', ws: 'Workspace VPC', fe: ['Front-end VPCE', 'General Access · TCP 443'], be: ['Back-end VPCEs', 'workspace API + SCC relay'], beP: '443 / 6666', gate: 'PAS · public access blocked', gateBad: 'public access: allowed', users: 'on-prem · DX / VPN', egress: ['S3 · gateway endpoint', 'everything else → NAT + firewall allow-list'] },
    azure: { tr: 'Transit VNet', ws: 'Workspace VNet', fe: ['Front-end PE', 'databricks_ui_api'], be: ['Back-end PE', 'databricks_ui_api'], beP: '443', gate: 'publicNetworkAccess: Disabled', gateBad: 'publicNetworkAccess: Enabled', users: 'on-prem · ExpressRoute / VPN', egress: ['Storage · private endpoint', 'everything else → UDR → Azure Firewall / NVA'] },
    gcp: { tr: 'Transit VPC', ws: 'Workspace VPC', fe: ['Workspace endpoint', 'plproxy-psc-endpoint-all-ports'], be: ['Back-end endpoints', 'workspace + ngrok-psc-endpoint'], beP: 'PSC', gate: 'PAS · public access blocked', gateBad: 'public access: allowed', users: 'on-prem · Interconnect / VPN', egress: ['Cloud NAT / firewall for approved egress'] }
  };
  def('private-link', 'Front-end vs back-end Private Link', {
    cloud: { t: 'enum', v: ['aws', 'azure', 'gcp'] }, hl: { t: 'enum', v: ['fe', 'be', 'both', 'gate', 'webauth', 'full', 'cdn'] },
    bad: { t: 'enum', v: ['gate', 'webauth'] }, egress: { t: 'bool' }
  }, { cloud: 'aws', hl: 'both' }, function (p) {
    var c = p.cloud || 'aws', L = PL[c], h = p.hl, full = h === 'full', fe = h === 'fe' || h === 'both' || full, be = h === 'be' || h === 'both' || full;
    var gate = h === 'gate' || full, out = '';
    out += region(150, 14, 196, 128, L.tr, { st: fe ? 'hl' : '' }) + region(10, 172, 336, 136, L.ws, { st: be ? 'hl' : '' }) + region(372, 14, 218, 294, 'Databricks control plane', { color: C.orange });
    out += node(62, 66, 'user', 'Users', L.users, '');
    out += node(250, 62, 'endpoint', L.fe[0], L.fe[1], fe ? 'hl' : '');
    out += node(62, 232, 'server', 'Cluster nodes', 'no public IP', '') + node(250, 232, 'endpoint', L.be[0], L.be[1], be ? 'hl' : '');
    out += node(494, 66, 'dbx', 'Web app + REST API', 'front-end target', '') + node(494, 232, 'dbx', 'SCC relay + REST API', 'back-end targets', '');
    var gs = p.bad === 'gate' ? 'bad' : gate ? 'hl' : '';
    out += '<g class="gate ' + gs + '">' + box(380, 128, 202, 46, gs || 'ok', { rx: 10 }) + tx(392, 147, 'public door', 'cth' + (gs ? ' on' : '')) + tx(392, 164, p.bad === 'gate' ? L.gateBad : L.gate, 'ctm sm') + mark(gs === 'bad' ? 'bad' : 'ok', 566, 151, 8) + '</g>';
    out += link([62, 66], [250, 62], { label: 'TCP 443', flow: true, st: fe ? 'hl' : '', at: [150, 88] });
    out += link([250, 62], [494, 66], { label: 'Private Link', flow: true, st: fe ? 'ok' : '', at: [372, 88] });
    out += link([62, 232], [250, 232], { label: L.beP, flow: true, st: be ? 'hl' : '', at: [150, 210] });
    out += link([250, 232], [494, 232], { label: 'tunnel + REST', flow: true, st: be ? 'ok' : '', at: [360, 256] });
    if (c === 'azure') {
      var ws = p.bad === 'webauth' ? 'bad' : h === 'webauth' || full ? 'hl' : '';
      out += pill(250, 128, 'browser_authentication PE', ws);
      if (h === 'webauth' || p.bad === 'webauth') out += tx(28, 162, p.bad === 'webauth' ? 'web-auth workspace deleted → SSO breaks region-wide' : 'one per region per DNS zone · private web-auth workspace', 'cts ' + (ws === 'bad' ? 'rose' : 'gold'));
      if (be) out += pill(150, 290, 'NoAzureDatabricksRules', 'hl');
    }
    if (h === 'cdn') {
      out += wire([[56, 98], [56, 150], [150, 156]], { st: 'hl', dash: true }) + pill(258, 156, 'static UI assets ← public CDN: allow on proxy', 'hl');
    }
    var H = 316;
    if (p.egress) {
      out += region(10, 320, 580, 52, 'Egress', { color: C.mint });
      L.egress.forEach(function (e, i) { out += pill(i === 0 ? (L.egress.length === 1 ? 300 : 160) : 410, 352, e, 'ok'); });
      out += wire([[62, 290], [62, 340]], { st: 'ok', flow: true });
      H = 380;
    }
    out += probe([[90, 66], [218, 62], [282, 62], [462, 66]], 2.6, C.gold) + probe([[90, 232], [218, 232], [282, 232], [462, 232]], 2.6, C.mint);
    return svg('private-link', 600, H, out);
  });

  // ---------------------------------------------------------------- ingress controls
  def('ingress', 'Ingress: IP access lists, PAS and context-based ingress', { hl: { t: 'enum', v: ['order', 'private', 'and', 'pas', 'controls'] } }, { hl: 'and' }, function (p) {
    var h = p.hl, out = '';
    out += link([58, 70], [232, 70], { flow: true }) + wire([[256, 88], [330, 148]], { flow: true, arrow: false, st: h === 'and' ? 'hl' : '' });
    out += link([58, 226], [232, 226], { flow: true, label: 'front-end Private Link', at: [145, 200], st: h === 'controls' ? 'hl' : '' }) + wire([[256, 208], [330, 148]], { flow: true, arrow: false, st: h === 'private' || h === 'and' ? 'hl' : '' });
    out += wire([[330, 148], [372, 148]], { st: h === 'and' || h === 'private' ? 'hl' : '' }) + link([404, 148], [546, 148], { flow: true, st: 'ok' });
    out += node(58, 70, 'user', 'Public client', '203.0.113.7', '') + node(58, 226, 'user', 'PrivateLink client', '10.20.4.9', h === 'private' ? 'hl' : '');
    out += node(232, 70, 'firewall', 'IP access list', 'public traffic only', h === 'order' || h === 'controls' ? 'hl' : '');
    out += node(232, 226, 'endpoint', 'PAS', 'access level: Account / Endpoint', h === 'pas' || h === 'private' || h === 'controls' ? 'hl' : '');
    out += node(404, 148, 'firewall', 'Context-based ingress', 'who · from where · what', h === 'and' || h === 'controls' || h === 'private' ? 'hl' : '');
    out += node(546, 148, 'dbx', 'Workspace', '', '');
    out += pill(318, 148, 'AND', h === 'and' ? 'hl' : '');
    if (h === 'order') out += pill(232, 128, '① block list first ② then allow list', 'hl');
    if (h === 'private') out += wire([[80, 202], [214, 98]], { st: 'bad', label: 'IP lists can\'t see it', at: [126, 150], xat: [168, 134] });
    if (h === 'pas') out += pill(232, 290, 'Account: any registered VPCE · Endpoint: listed VPCEs', 'hl');
    if (h === 'controls') out += pill(404, 290, 'clusters: no inbound at all (SCC)', 'ok');
    out += probe([[86, 70], [204, 70], [256, 88], [330, 148], [376, 148], [516, 148]], 2.8, C.gold);
    return svg('ingress', 600, 304, out);
  });

  // ---------------------------------------------------------------- NCC
  def('ncc', 'Network connectivity configuration (NCC)', { hl: { t: 'enum', v: ['ncc', 'limits', 'stableip'] }, cloud: { t: 'enum', v: ['aws', 'azure'] } }, { hl: 'ncc' }, function (p) {
    var h = p.hl, out = '';
    out += region(10, 12, 360, 296, 'Databricks account · one region', { color: C.orange }) + region(392, 12, 198, 296, 'Your cloud', {});
    ['ws-a', 'ws-b', 'ws-c'].forEach(function (w, i) { out += pill(150 + i * 70, 44, w, h === 'ncc' ? 'hl' : '') + wire([[150 + i * 70, 56], [232, 126]], { st: h === 'ncc' ? 'hl' : '', arrow: false }); });
    out += tx(300, 86, 'attached workspaces', 'cts');
    out += node(70, 150, 'dbx', 'Serverless', 'SQL · jobs · notebooks', '');
    out += node(232, 150, 'router', 'NCC', 'account-level · regional', h === 'ncc' || h === 'limits' ? 'hl' : '');
    out += node(420, 150, 'endpoint', 'Private endpoint', 'rule → you approve it', '', { r: 18 });
    out += node(530, 150, 'db', 'Storage / DB', 'firewalled', '');
    out += link([70, 150], [232, 150], { flow: true }) + link([232, 150], [420, 150], { flow: true, st: 'ok', label: 'PE rule', rb: 28 }) + link([420, 150], [530, 150], { flow: true, st: 'ok', ra: 26 });
    if (h === 'limits') {
      out += pill(190, 250, '≤ 50 workspaces per NCC', 'hl') + pill(190, 276, '20 NCCs per region per account', 'hl') + pill(460, 262, '100 PEs / region', 'hl');
    } else {
      out += wire([[90, 182], [90, 252], [480, 252], [526, 182]], { st: h === 'stableip' ? 'ok' : 'dim', label: 'current serverless outbound IPs', at: [300, 252] });
      out += pill(300, 284, 'legacy "stable IP list": decommissioned', h === 'stableip' ? 'bad' : 'dim');
      if (h === 'stableip') out += xmark(470, 284, 8);
    }
    out += probe([[100, 150], [200, 150], [264, 150], [400, 150], [500, 150]], 2.6, C.mint);
    return svg('ncc', 600, 316, out);
  });

  // ---------------------------------------------------------------- serverless egress network policy
  def('egress-policy', 'Serverless egress: network policy Full vs Restricted', {
    mode: { t: 'enum', v: ['restricted', 'full', 'dryrun'] }, hl: { t: 'enum', v: ['implicit', 'fqdn', 'pe', 'udf', 'unlisted', 'attach', 'crossws'] }
  }, { mode: 'restricted', hl: 'pe' }, function (p) {
    var mode = p.mode || 'restricted', h = p.hl, full = mode === 'full', dry = mode === 'dryrun', out = '';
    var rows = [['implicit', 'UC external locations', 'implicit allow', 'ok'], ['implicit', 'Workspace\'s own APIs', 'implicit allow', 'ok'], ['implicit', 'Workspace root storage', 'implicit allow', 'ok'],
      ['implicit', 'System tables · samples', 'implicit · read-only', 'ok'], ['fqdn', 'Allowed FQDNs + storage', 'listed in the policy', 'ok'],
      ['pe', 'NCC private endpoint', 'private route + UC or policy allow', 'warn'], ['unlisted', 'Unlisted site (even HTTPS)', 'blocked', 'bad'], ['udf', 'Direct storage from a UDF (boto3)', 'blocked · go through UC', 'bad']];
    if (h === 'crossws') rows.push(['crossws', 'Another workspace', 'needs A egress + B ingress rule', 'bad']);
    out += node(64, 160, 'dbx', 'Serverless', 'compute', '');
    out += node(200, 160, 'firewall', 'Network policy', full ? 'Full access' : dry ? 'Restricted · dry-run' : 'Restricted access', h === 'attach' ? 'hl' : 'hl');
    out += link([64, 160], [200, 160], { flow: true });
    rows.forEach(function (r, i) {
      var y = 14 + i * 34, st = r[3];
      if (full && r[0] !== 'crossws') st = 'ok';
      if (dry && st === 'bad' && r[0] !== 'crossws') st = 'warn';
      var on = h === r[0], sub = full && r[0] !== 'crossws' ? 'allowed (full access)' : dry && st === 'warn' && r[0] !== 'pe' ? 'logged, not blocked (dry-run)' : r[2];
      out += rev(i, '<g class="trow' + (on ? ' hl' : '') + (h && !on && h !== 'attach' ? ' dim' : '') + '">' +
        wire([[230, 160], [298, y + 15]], { st: st === 'bad' ? 'bad' : on ? 'hl' : 'dim', arrow: false, x: false }) +
        box(300, y, 290, 30, on ? 'hl' : st === 'bad' ? 'bad' : '', { rx: 8 }) + tx(312, y + 13, r[1], 'tr-l') + tx(312, y + 26, sub, 'cts xs' + (st === 'bad' ? ' rose' : st === 'warn' ? ' gold' : ' ok')) +
        mark(st, 576, y + 15, 8) + '</g>', 0.12);
    });
    if (h === 'attach') out += pill(130, 256, 'account-level · Enterprise', 'hl') + pill(130, 282, '1 per workspace · shared by many', 'hl');
    else if (!full) out += pill(130, 268, dry ? 'dry-run logs would-be denials' : 'only the allowlist gets through', dry ? 'hl' : '');
    else out += pill(130, 268, 'any destination', 'ok');
    var H = 14 + rows.length * 34 + 10;
    out += probe([[92, 160], [172, 160], [230, 160], [298, 14 + 5 * 34 + 15]], 2.4, C.gold);
    return svg('egress-policy', 600, Math.max(H, 300), out);
  });

  // ---------------------------------------------------------------- Azure NAT gateway vs UDR to firewall
  def('natgw-vs-fw', 'Azure NAT Gateway vs a UDR to Azure Firewall', { hl: { t: 'enum', v: ['nat', 'udr', 'bypass'] } }, { hl: 'udr' }, function (p) {
    var h = p.hl, out = '';
    function panel(x, key, title, gwKind, gwLabel, gwSub, route, routeSt, a, b, notes) {
      var on = h === key || (key === 'udr' && h === 'bypass'), g = '<g class="panel' + (on ? ' hl' : '') + (h && !on ? ' dim' : '') + '">' + box(x, 8, 288, 304, on ? 'hl' : '', { rx: 14 });
      g += tx(x + 14, 32, title, 'ctb');
      g += box(x + 12, 46, 108, 140, '', { rx: 10 }) + tx(x + 22, 64, 'Subnet', 'cth') + node(x + 66, 112, 'server', 'VMs', '', '', { r: 17 });
      g += pill(x + 144, 206, route, routeSt);
      g += node(x + 164, 112, gwKind, gwLabel, gwSub, on && h !== 'bypass' ? 'hl' : '', { r: 18 });
      g += wire([[x + 88, 112], [x + 142, 112]], { flow: true }) + wire([[x + 184, 104], [x + 230, 64]], { flow: a[1] !== 'bad', st: a[1] === 'bad' ? 'bad' : '', xat: [x + 222, 71] }) + wire([[x + 186, 112], [x + 228, 112]], { flow: b[1] !== 'bad', st: b[1] === 'bad' ? 'bad' : '', xat: [x + 212, 112] });
      g += node(x + 250, 56, 'cloud', a[0], '', a[1], { r: 14 }) + node(x + 250, 112, 'cloud', b[0], '', b[1], { r: 14 });
      notes.forEach(function (n, i) { g += tx(x + 14, 240 + i * 18, n[0], 'cts' + (n[1] ? ' ' + n[1] : '')); });
      return g + '</g>';
    }
    out += panel(8, 'nat', 'NAT gateway', 'nat', 'NAT GW', 'attached to subnet', 'no UDR needed or used', '', ['any site', 'ok'], ['other site', 'ok'],
      [['automatic internet next hop', ''], ['stable outbound IP', 'ok'], ['no filtering of any kind', 'rose']]);
    if (h === 'bypass') {
      out += panel(304, 'udr', 'UDR next hop "Internet"', 'firewall', 'Azure Firewall', 'bypassed', 'UDR 0/0 → Internet', 'bad', ['any site', 'ok'], ['other site', 'ok'],
        [['traffic skips the NVA entirely', 'rose'], ['fix: next hop = virtual appliance', 'gold'], ['(the firewall\'s private IP)', '']]);
      out += '<g class="cw bad"><path class="cw-line" d="M392 96 Q450 20 532 50" marker-end="' + mref('bad') + '"/></g>';
    } else {
      out += panel(304, 'udr', 'UDR → Azure Firewall', 'firewall', 'Azure Firewall', 'or NVA · FQDN rules', 'UDR 0/0 → 10.0.0.4 (appliance)', h === 'udr' ? 'hl' : '', ['allowed.com', 'ok'], ['other.com', 'bad'],
        [['route table sends 0/0 to the firewall', ''], ['FQDN rules: approved sites only', 'ok'], ['NAT GW alone would not filter', '']]);
    }
    out += probe([[96, 112], [150, 112], [190, 104], [236, 60]], 2.2, C.cyan) + probe([[392, 112], [446, 112], [488, 104], [532, 60]], 2.2, C.gold);
    return svg('natgw-vs-fw', 600, 320, out);
  });

  // ---------------------------------------------------------------- storage firewall / NSP
  def('storage-fw', 'Azure storage firewall: classic vs serverless', { hl: { t: 'enum', v: ['why', 'fixes'] } }, { hl: 'why' }, function (p) {
    var fx = p.hl === 'fixes', out = '';
    out += node(78, 70, 'vpc', 'Classic cluster', 'from your VNet / NAT', 'ok') + node(78, 214, 'dbx', 'Serverless SQL', 'serverless plane', fx ? '' : 'bad');
    out += '<rect class="fw-wall" x="404" y="24" width="24" height="250" rx="6"/>' + tx(416, 290, 'storage firewall', 'cts', 'middle');
    out += node(522, 146, 'db', 'Storage account', 'ADLS', '');
    out += wire([[108, 70], [400, 70], [494, 132]], { flow: true, st: 'ok', label: 'allowlisted network ✓', at: [250, 70] });
    if (!fx) {
      out += wire([[108, 214], [400, 214]], { st: 'bad', label: 'not in the allowlist → 403', at: [250, 214], xat: [392, 214] });
      out += tx(200, 292, 'allowlisting serverless subnet IDs no longer works', 'cts rose', 'middle');
    } else {
      out += node(270, 214, 'endpoint', 'NCC private endpoint', 'approve + attach NCC', 'hl', { r: 18 });
      out += link([78, 214], [270, 214], { flow: true, st: 'hl', rb: 28 }) + wire([[290, 206], [494, 160]], { flow: true, st: 'ok', label: '① private', at: [350, 186] });
      out += pill(416, 130, '② NSP: AzureDatabricksServerless tag', 'hl');
      out += pill(250, 270, '③ check the network policy allows it', 'hl');
    }
    out += probe([[108, 70], [400, 70], [494, 132]], 2.4, C.mint);
    return svg('storage-fw', 600, 304, out);
  });

  // ---------------------------------------------------------------- troubleshooting ladder
  def('troubleshoot', 'Troubleshooting: walk the path hop by hop', { steps: { t: 'list', of: { t: 'str', max: 46 }, min: 2, max: 7 }, fail: { t: 'int', min: -1, max: 6 }, fix: { t: 'str', max: 52 } },
    { steps: ['DNS resolves the name', 'Route exists both ways', 'Security group / NSG allows the port', 'Far-end firewall allows the source'], fail: 2, fix: 'Open the port' }, function (p) {
      var S = p.steps || FIG.troubleshoot.sample.steps, f = p.fail == null ? -1 : p.fail, out = '';
      S.forEach(function (s, i) {
        var y = 16 + i * 46, st = f < 0 || i < f ? 'ok' : i === f ? 'bad' : 'dim';
        out += rev(i, '<g class="trow ' + (st === 'dim' ? 'dim' : '') + '">' + box(54, y, 330, 34, st === 'bad' ? 'bad' : '', { rx: 9 }) +
          '<g class="cn ' + (st === 'bad' ? 'bad' : '') + '" style="--c:' + (st === 'bad' ? C.rose : st === 'ok' ? C.mint : C.dim) + '" transform="translate(28 ' + (y + 17) + ')"><circle class="cn-disc" r="14"/>' + tx(0, 5, String(i + 1), 'ctm', 'middle') + '</g>' +
          tx(66, y + 22, s, 'tr-l') + mark(st === 'dim' ? '' : st, 368, y + 17, 8) + '</g>' + (i < S.length - 1 ? wire([[28, y + 32], [28, y + 46]], { arrow: false, st: st === 'ok' ? 'ok' : 'dim' }) : ''), 0.3);
      });
      if (f >= 0 && p.fix) {
        var fy = 16 + f * 46 + 17;
        out += rev(S.length, wire([[386, fy], [404, fy]], { st: 'ok' }) + box(406, fy - 22, 186, 44, 'ok', { rx: 10 }) + tx(418, fy - 4, 'fix', 'cth on') + tx(418, fy + 13, p.fix.length > 28 ? p.fix.slice(0, 27) + '…' : p.fix, 'ctm sm ok'), 0.3);
        if (p.fix.length > 28) out += tx(418, fy + 34, p.fix.slice(27), 'ctm sm ok');
      }
      out += probe([[28, 33], [28, 16 + (f < 0 ? S.length - 1 : f) * 46 + 17]], 2.2, f < 0 ? C.mint : C.rose);
      return svg('troubleshoot', 600, 16 + S.length * 46 + (f === S.length - 1 && p.fix && p.fix.length > 28 ? 26 : 4), out);
    }, function (p) { return p.steps && p.fail != null && p.fail >= p.steps.length ? ['troubleshoot: fail index beyond steps'] : []; });

  // ================================================================== feedback integration
  function spec(q, partIdx) {
    if (!q || !q.fig) return null;
    var s = { fig: q.fig, params: q.figParams || {}, concept: q.concept };
    var o = partIdx != null && partIdx >= 0 && q.figParts && q.figParts[partIdx];
    if (o) { if (o.fig) { s.fig = o.fig; s.params = o.params || {}; } else if (o.params) s.params = o.params; if (o.concept) s.concept = o.concept; }
    return s;
  }
  function feedback(q, p, ok, partIdx) {
    var s = spec(q, partIdx);
    if (!s || !FIG[s.fig] || !s.concept) return '';
    var fig = '';
    try { fig = render(s.fig, s.params); } catch (e) { if (root.console) root.console.warn('concept figure failed', s.fig, e); }
    var learn = ONA.journeys && ONA.journeys.button ? ONA.journeys.button(q, 'feedback') : '';
    return (learn ? '<div class="fb-learn">' + learn + '</div>' : '') +
      '<details class="fb-concept"' + (ok ? '' : ' open') + ' data-fig="' + E(s.fig) + '">' +
      '<summary><span class="fc-k">Concept</span><span class="fc-title">' + E(FIG[s.fig].title) + '</span><span class="fc-chev" aria-hidden="true"></span></summary>' +
      '<div class="fc-body">' + (fig ? '<div class="fc-fig" aria-hidden="true">' + fig + '</div>' : '') + '<p class="fc-text">' + E(s.concept) + '</p></div></details>';
  }

  var FIGURES = {};
  Object.keys(FIG).forEach(function (k) { FIGURES[k] = { title: FIG[k].title, params: FIG[k].params, sample: FIG[k].sample }; });
  ONA.explainers = { render: render, validate: validate, spec: spec, feedback: feedback, FIGURES: FIGURES, _ip: { ipInt: ipInt, intIp: intIp, inCidr: inCidr } };
})(typeof window !== 'undefined' ? window : globalThis);
