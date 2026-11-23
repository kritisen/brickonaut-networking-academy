/* Network diagram renderer, used for clickable "find the broken component" questions and explanation minis. */
(function (ONA) {
  'use strict';
  var esc = function (s) { return ONA.util.esc(s); };
  var R = 27; // node radius

  function bounds(d) {
    var xs = d.nodes.map(function (n) { return n.x; }), ys = d.nodes.map(function (n) { return n.y; });
    var x0 = Math.min.apply(null, xs) - 115, x1 = Math.max.apply(null, xs) + 115;
    var y0 = Math.min.apply(null, ys) - 46, y1 = Math.max.apply(null, ys) + 78;
    return [x0, y0, x1 - x0, y1 - y0];
  }

  // opts: { interactive, numbered, idPrefix }
  function render(d, opts) {
    opts = opts || {};
    var byId = {}; d.nodes.forEach(function (n) { byId[n.id] = n; });
    var vb = bounds(d);
    var out = '<svg class="netdiag ' + (opts.interactive ? 'interactive' : 'static') + '" viewBox="' + vb.join(' ') + '" role="' + (opts.interactive ? 'group' : 'img') + '" aria-label="Network diagram">';
    out += '<defs><marker id="arr' + (opts.idPrefix || '') + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="#7d8bd6"/></marker></defs>';
    // links
    (d.links || []).forEach(function (l) {
      var a = byId[l[0]], b = byId[l[1]];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var x1 = a.x + ux * (R + 4), y1 = a.y + uy * (R + 4), x2 = b.x - ux * (R + 8), y2 = b.y - uy * (R + 8);
      var bad = l[3] === 'bad';
      out += '<g class="link ' + (bad ? 'bad' : '') + '">' +
        '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="wire"/>' +
        (bad ? '' : '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="packets"/>') +
        '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="tip" marker-end="url(#arr' + (opts.idPrefix || '') + ')"/>';
      if (l[2]) {
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, w = l[2].length * 6.6 + 14;
        out += '<g class="link-label" transform="translate(' + mx + ' ' + my + ')"><rect x="' + (-w / 2) + '" y="-10" width="' + w + '" height="20" rx="10"/><text y="4">' + esc(l[2]) + '</text></g>';
      }
      if (bad) out += '<g class="xmark" transform="translate(' + (x1 + x2) / 2 + ' ' + ((y1 + y2) / 2 + (l[2] ? 20 : 0)) + ')"><path d="M-6-6L6 6M6-6L-6 6"/></g>';
      out += '</g>';
    });
    // nodes
    d.nodes.forEach(function (nd, i) {
      var c = ONA.art.kindColor(nd.kind);
      var attrs = opts.interactive
        ? ' role="button" tabindex="0" data-node="' + esc(nd.id) + '" aria-label="' + esc(nd.label + (nd.sub ? ', ' + nd.sub : '')) + '"'
        : '';
      out += '<g class="node" style="--c:' + c + '" transform="translate(' + nd.x + ' ' + nd.y + ')"' + attrs + '>' +
        '<circle class="halo" r="' + (R + 10) + '"/>' +
        '<circle class="disc" r="' + R + '"/>' +
        '<g class="ico" transform="translate(-12 -12)">' + ONA.art.icon(nd.kind) + '</g>' +
        '<text class="label" y="' + (R + 20) + '">' + esc(nd.label) + '</text>' +
        (nd.sub ? '<text class="sub" y="' + (R + 36) + '">' + esc(nd.sub) + '</text>' : '') +
        (opts.numbered && i < 9 ? '<g class="num" transform="translate(' + (-R + 2) + ' ' + (-R + 2) + ')"><circle r="10"/><text y="4">' + (i + 1) + '</text></g>' : '') +
        '</g>';
    });
    return out + '</svg>';
  }

  function osi() {
    var L = [['7', 'Application', 'HTTP · DNS · SMTP'], ['6', 'Presentation', 'TLS (often here)'], ['5', 'Session', ''], ['4', 'Transport', 'TCP · UDP · ports'],
      ['3', 'Network', 'IP · routers'], ['2', 'Data Link', 'MAC · switches'], ['1', 'Physical', 'cables · radio']];
    var cols = ['#ff8a5b', '#f6c453', '#d4e157', '#7cf7c3', '#4fd1ff', '#7d8bff', '#b794f6'];
    var out = '<svg class="netdiag static osi" viewBox="0 0 520 250" role="img" aria-label="OSI model stack">';
    L.forEach(function (l, i) {
      var y = 8 + i * 34;
      out += '<rect x="40" y="' + y + '" width="440" height="28" rx="6" fill="' + cols[i] + '" fill-opacity=".16" stroke="' + cols[i] + '" stroke-opacity=".7"/>' +
        '<text x="58" y="' + (y + 19) + '" class="osi-n" fill="' + cols[i] + '">L' + l[0] + '</text>' +
        '<text x="96" y="' + (y + 19) + '" class="osi-l">' + l[1] + '</text>' +
        '<text x="466" y="' + (y + 19) + '" class="osi-e" text-anchor="end">' + l[2] + '</text>';
    });
    return out + '</svg>';
  }

  function handshake() {
    var out = '<svg class="netdiag static hs" viewBox="0 0 520 210" role="img" aria-label="TCP three-way handshake">' +
      '<defs><marker id="hsA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5 0 10z" fill="#4fd1ff"/></marker></defs>' +
      '<text x="90" y="22" class="label">Client</text><text x="430" y="22" class="label">Server</text>' +
      '<line x1="90" y1="32" x2="90" y2="200" class="life"/><line x1="430" y1="32" x2="430" y2="200" class="life"/>';
    [['SYN', 90, 430, 50], ['SYN-ACK', 430, 90, 100], ['ACK', 90, 430, 150]].forEach(function (s) {
      out += '<line x1="' + s[1] + '" y1="' + s[3] + '" x2="' + s[2] + '" y2="' + (s[3] + 26) + '" class="msg" marker-end="url(#hsA)"/>' +
        '<text x="260" y="' + (s[3] + 8) + '" class="msg-t">' + s[0] + '</text>';
    });
    return out + '<text x="260" y="198" class="sub">connection established → data flows</text></svg>';
  }

  ONA.diagram = {
    render: render,
    mini: function (key) {
      if (key === 'osi') return osi();
      if (key === 'handshake') return handshake();
      var d = ONA.MINI[key];
      return d ? render(d, { idPrefix: 'm' + key }) : '';
    }
  };
})(window.ONA);
