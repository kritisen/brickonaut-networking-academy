/* Boot. */
(function (ONA) {
  'use strict';
  function boot() {
    ONA.store.init();
    ONA.starfield.init(document.getElementById('starfield'));
    ONA.fx.init(document.getElementById('fx'));
    ONA.game.init();
    var foot = document.querySelector('.title-foot');
    if (foot) {
      var worlds = ONA.LEVELS.filter(function (l) { return !l.bonus; }).length;
      foot.textContent = worlds + ' worlds · ' + ONA.QUESTIONS.length + ' networking questions (Databricks facts docs-sourced) · Leitner Repair Bay · Captain\'s Log telemetry';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.ONA);
