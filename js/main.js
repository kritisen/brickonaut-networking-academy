/* Boot. */
(function (ONA) {
  'use strict';
  function boot() {
    ONA.store.init();
    ONA.starfield.init(document.getElementById('starfield'));
    ONA.fx.init(document.getElementById('fx'));
    ONA.game.init();          // also writes the title's question count from the bank (#title-count)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.ONA);
