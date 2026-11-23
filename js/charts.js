/* Minimal SVG charts for the Captain's Log: radar, line, horizontal bars. */
(function (ONA) {
  'use strict';
  var esc = function (s) { return ONA.util.esc(s); };

  // axes: [{label, value 0..1 | null}]
  function radar(axes, opts) {
    opts = opts || {};
    var S = 360, cx = S / 2, cy = S / 2 + 6, r = 118, n = axes.length;
    var pt = function (i, v) { var a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v]; };
    var out = '<svg class="chart radar" viewBox="-70 0 ' + (S + 140) + ' ' + (S + 6) + '" role="img" aria-label="' + esc(opts.label || 'Radar chart') + '">';
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      out += '<polygon class="grid" points="' + axes.map(function (_, i) { return pt(i, k).join(','); }).join(' ') + '"/>';
    });
    axes.forEach(function (ax, i) {
      var p = pt(i, 1), lp = pt(i, 1.2);
      out += '<line class="spoke" x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '"/>';
      var anchor = Math.abs(lp[0] - cx) < 8 ? 'middle' : lp[0] > cx ? 'start' : 'end';
      out += '<text class="axis-label" x="' + lp[0] + '" y="' + (lp[1] + 4) + '" text-anchor="' + anchor + '">' + esc(ax.label) + '</text>';
      out += '<text class="axis-val" x="' + lp[0] + '" y="' + (lp[1] + 18) + '" text-anchor="' + anchor + '">' + (ax.value == null ? '—' : Math.round(ax.value * 100) + '%') + '</text>';
    });
    var poly = axes.map(function (ax, i) { return pt(i, ax.value == null ? 0 : Math.max(0.03, ax.value)).join(','); }).join(' ');
    out += '<polygon class="area" points="' + poly + '"/>';
    axes.forEach(function (ax, i) {
      if (ax.value == null) return;
      var p = pt(i, Math.max(0.03, ax.value));
      out += '<circle class="dot" cx="' + p[0] + '" cy="' + p[1] + '" r="4"><title>' + esc(ax.label) + ': ' + Math.round(ax.value * 100) + '%</title></circle>';
    });
    return out + '</svg>';
  }

  // points: [{label, value 0..1}]
  function line(points, opts) {
    opts = opts || {};
    var W = 560, H = 220, L = 40, Rm = 14, T = 16, B = 30, iw = W - L - Rm, ih = H - T - B;
    var out = '<svg class="chart line" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Line chart') + '">';
    [0, 0.5, 1].forEach(function (k) {
      var y = T + ih * (1 - k);
      out += '<line class="grid" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + y + '" y2="' + y + '"/><text class="tick" x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(k * 100) + '%</text>';
    });
    if (!points.length) return out + '<text class="empty" x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle">Fly a mission to start your log</text></svg>';
    var xs = function (i) { return points.length === 1 ? L + iw / 2 : L + (iw * i) / (points.length - 1); };
    var ys = function (v) { return T + ih * (1 - v); };
    var d = points.map(function (p, i) { return (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(p.value).toFixed(1); }).join('');
    var area = d + 'L' + xs(points.length - 1).toFixed(1) + ' ' + (T + ih) + 'L' + xs(0).toFixed(1) + ' ' + (T + ih) + 'Z';
    out += '<defs><linearGradient id="lnFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd1ff" stop-opacity=".35"/><stop offset="1" stop-color="#4fd1ff" stop-opacity="0"/></linearGradient></defs>';
    out += '<path class="area" d="' + area + '"/><path class="stroke" d="' + d + '"/>';
    points.forEach(function (p, i) {
      out += '<circle class="dot" cx="' + xs(i) + '" cy="' + ys(p.value) + '" r="' + (i === points.length - 1 ? 5 : 3.2) + '"><title>' + esc(p.label) + ': ' + Math.round(p.value * 100) + '%</title></circle>';
    });
    var step = Math.max(1, Math.ceil(points.length / 8));
    points.forEach(function (p, i) {
      if (i % step && i !== points.length - 1) return;
      out += '<text class="tick" x="' + xs(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(p.short || String(i + 1)) + '</text>';
    });
    return out + '</svg>';
  }

  // rows: [{label, value 0..1, note}]  — rendered as HTML for crisp text + wrapping.
  function bars(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<p class="empty">' + esc(opts.empty || 'No data yet') + '</p>';
    return '<ul class="bars">' + rows.map(function (r) {
      var v = Math.max(0, Math.min(1, r.value));
      var tone = r.tone || (v >= 0.8 ? 'good' : v >= 0.6 ? 'ok' : 'bad');
      return '<li><span class="bar-label">' + esc(r.label) + '</span><span class="bar-track"><span class="bar-fill ' + tone + '" style="--v:' + v + '"></span></span><span class="bar-note">' + esc(r.note) + '</span></li>';
    }).join('') + '</ul>';
  }

  ONA.charts = { radar: radar, line: line, bars: bars };
})(window.ONA);
