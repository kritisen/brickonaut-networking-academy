/* Databricks mark: the official symbol from the Databricks brand kit (assets/databricks-mark.svg), unaltered.
 * The path below is the same path as in that file (tests/validate_questions.mjs checks they match), so it can be
 * drawn inside other SVGs (ship hull, galaxy map) without a runtime fetch. Always Lava #FF3621, never recoloured,
 * rotated, stretched or outlined. Decorative wherever it's used: aria-hidden, with the meaning carried by text.
 */
(function (root) {
  'use strict';
  var ONA = (root.ONA = root.ONA || {});
  var PATH = 'M98.9 46.5996L52.3 72.8996L2.4 44.7996L0 46.0996V66.4996L52.3 95.8996L98.9 69.6996V80.4996L52.3 106.8L2.4 78.6996L0 79.9996V83.4996L52.3 112.9L104.5 83.4996V63.0996L102.1 61.7996L52.3 89.7996L5.6 63.5996V52.7996L52.3 78.9996L104.5 49.5996V29.4996L101.9 27.9996L52.3 55.8996L8 31.0996L52.3 6.19961L88.7 26.6996L91.9 24.8996V22.3996L52.3 0.0996094L0 29.4996V32.6996L52.3 62.0996L98.9 35.7996V46.5996Z';
  var W = 104.5, H = 113, LAVA = '#FF3621';
  function n(v) { return Math.round(v * 100) / 100; }
  ONA.brand = {
    MARK_PATH: PATH, MARK_W: W, MARK_H: H, LAVA: LAVA,
    // Nested <svg> for use inside another SVG: centred on (cx, cy), `h` units tall, aspect ratio kept.
    markAt: function (cx, cy, h, cls) {
      var w = h * W / H;
      return '<svg class="dbx-mark' + (cls ? ' ' + cls : '') + '" x="' + n(cx - w / 2) + '" y="' + n(cy - h / 2) + '" width="' + n(w) + '" height="' + n(h) +
        '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false"><path d="' + PATH + '" fill="' + LAVA + '"/></svg>';
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
