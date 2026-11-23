/* WebAudio core + SFX synth. Nothing loads from disk; every sound is generated in the browser.
 *
 * Graph (created on the first user gesture, never before, because of autoplay rules):
 *   sfx voices  → sfxBus  ─┐
 *   music (js/music.js) → musicIn → duck → musicBus ─┤→ master → hide → limiter → destination
 *
 *   master   = 0 when muted (mute-all, M key / mute button), else 1
 *   sfxBus   = sfxVol when SFX are on, else 0
 *   musicBus = musicVol × headroom when music is on, else 0
 *   duck     = briefly lowered under SFX and under wrong-answer feedback
 *   hide     = faded to 0 (then the context is suspended) while the tab is hidden
 *   limiter  = DynamicsCompressor set as a limiter, so stacked voices never clip
 */
(function (ONA) {
  'use strict';
  var MUSIC_HEADROOM = 0.6;   // music sits under SFX even at 100%
  var A = (ONA.audio = { ctx: null, master: null, sfxBus: null, musicIn: null, musicBus: null, duckGain: null, hidden: false });
  var settings = function () { return ONA.store.state.settings; };

  // Pure: target gain for each bus. Unit-tested in tests/unit_store.mjs.
  // `o.journey`: a holo-sim journey is open (narration on screen), so the music sits lower under it.
  var JOURNEY_MUSIC = 0.35;
  A.JOURNEY_MUSIC = JOURNEY_MUSIC;
  A.levels = function (s, o) {
    return {
      master: s.muted ? 0 : 1,
      sfx: s.sfx ? s.sfxVol : 0,
      music: s.music ? s.musicVol * MUSIC_HEADROOM * (o && o.journey ? JOURNEY_MUSIC : 1) : 0
    };
  };
  var levelOpts = function () { return { journey: !!(ONA.game && ONA.game.journeyOpen) }; };

  // Create the context + bus graph. Call only from a user gesture (or after one).
  A.ensure = function () {
    if (A.ctx) {
      if (A.ctx.state === 'suspended' && !A.hidden) A.ctx.resume().catch(function () {});
      return A.ctx;
    }
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { A.ctx = new C({ latencyHint: 'playback' }); } catch (e) { try { A.ctx = new C(); } catch (e2) { return null; } }
    var c = A.ctx;
    var limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 4; limiter.ratio.value = 20;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    A.hideGain = c.createGain();
    A.master = c.createGain();
    A.sfxBus = c.createGain();
    A.musicBus = c.createGain();
    A.duckGain = c.createGain();
    A.musicIn = c.createGain(); A.musicIn.gain.value = 2;   // +6 dB makeup: voices are mixed quietly for headroom
    A.musicIn.connect(A.duckGain); A.duckGain.connect(A.musicBus); A.musicBus.connect(A.master);
    A.sfxBus.connect(A.master); A.master.connect(A.hideGain); A.hideGain.connect(limiter); limiter.connect(c.destination);
    A.out = limiter;   // final node before the speakers (tests meter it for clipping)
    var lv = A.levels(settings(), levelOpts());
    A.master.gain.value = lv.master; A.sfxBus.gain.value = lv.sfx; A.musicBus.gain.value = lv.music;
    A.hideGain.gain.value = A.hidden ? 0 : 1;
    if (c.state === 'suspended') c.resume().catch(function () {});
    return c;
  };

  // Smoothly apply the current settings to the buses (called after any audio setting changes).
  A.apply = function () {
    if (!A.ctx) return;
    var lv = A.levels(settings(), levelOpts()), t = A.ctx.currentTime;
    [[A.master, lv.master], [A.sfxBus, lv.sfx], [A.musicBus, lv.music]].forEach(function (p) {
      p[0].gain.cancelScheduledValues(t); p[0].gain.setTargetAtTime(p[1], t, 0.08);
    });
  };

  // Lower the music to `depth` (0..1) for `hold` seconds, then recover. Overlapping ducks take the deepest
  // depth AND the latest end: a short SFX duck during the 2.4 s wrong-answer duck can't cut it short.
  var duckUntil = 0, duckDepth = 1;
  A.duck = function (depth, hold) {
    if (!A.ctx) return;
    var t = A.ctx.currentTime, g = A.duckGain.gain, active = t < duckUntil;
    if (active) depth = Math.min(depth, duckDepth);
    var until = Math.max(active ? duckUntil : 0, t + hold);
    duckDepth = depth; duckUntil = until;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(depth, t, 0.04);
    g.setTargetAtTime(1, until, 0.45);
  };
  A._duckState = function () { return { until: duckUntil, depth: duckDepth }; };   // tests

  // Tab hidden: fade out, then suspend the context (stops all audio work). Visible again: resume and fade in.
  var hideTimer = 0;
  A.setHidden = function (hidden) {
    A.hidden = !!hidden;
    clearTimeout(hideTimer);
    if (!A.ctx) return;
    var t = A.ctx.currentTime, g = A.hideGain.gain;
    g.cancelScheduledValues(t);
    if (A.hidden) {
      g.setTargetAtTime(0, t, 0.08);
      hideTimer = setTimeout(function () { if (A.hidden && A.ctx.state === 'running') A.ctx.suspend().catch(function () {}); }, 450);
    } else {
      A.ctx.resume().catch(function () {}).then(function () {
        var t2 = A.ctx.currentTime; g.cancelScheduledValues(t2); g.setTargetAtTime(1, t2, 0.25);
      });
    }
    if (ONA.music) ONA.music.sync();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () { A.setHidden(document.hidden); });
  }

  // ---------------------------------------------------------------- SFX
  function sfxCtx() {
    var s = settings();
    if (s.muted || !s.sfx) return null;     // no nodes at all when SFX are off
    return A.ensure();
  }

  function tone(freq, t0, dur, type, vol, slideTo) {
    var c = sfxCtx(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.sfxBus);
    o.onended = function () { o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(t0, dur, vol, f0, f1) {
    var c = sfxCtx(); if (!c) return;
    var len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var t = c.currentTime + t0;
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(A.sfxBus);
    src.onended = function () { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start(t);
  }

  // Each SFX ducks the music a little; micro-sounds (ticks, clicks) don't, to avoid pumping.
  function withDuck(depth, hold, fn) {
    return function () { if (sfxCtx()) { A.duck(depth, hold); fn.apply(null, arguments); } };
  }

  ONA.sfx = {
    unlock: function () { return A.ensure(); },
    click: function () { tone(880, 0, 0.06, 'square', 0.06); },
    select: function () { tone(660, 0, 0.05, 'triangle', 0.12); },
    tick: function () { tone(1400 + Math.random() * 200, 0, 0.018, 'square', 0.025); },
    correct: withDuck(0.6, 0.45, function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.06, 0.22, 'triangle', 0.22); }); }),
    wrong: withDuck(0.5, 0.5, function () { tone(160, 0, 0.35, 'sawtooth', 0.18, 70); noise(0, 0.25, 0.25, 900, 120); }),
    shieldUp: withDuck(0.65, 0.4, function () { tone(440, 0, 0.3, 'sine', 0.2, 1320); }),
    warp: withDuck(0.6, 1.0, function () { noise(0, 1.1, 0.35, 200, 4000); tone(110, 0, 1.0, 'sawtooth', 0.08, 880); }),
    fanfare: withDuck(0.35, 1.2, function () { [392, 523, 659, 784, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.11, 0.3, 'triangle', 0.2); }); }),
    fail: withDuck(0.4, 1.0, function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, i * 0.16, 0.35, 'sawtooth', 0.12); }); }),
    star: withDuck(0.6, 0.35, function (i) { tone(880 * Math.pow(1.26, i), 0, 0.25, 'sine', 0.25); tone(1760 * Math.pow(1.26, i), 0.03, 0.2, 'sine', 0.1); }),
    alarm: withDuck(0.7, 0.3, function () { tone(740, 0, 0.12, 'square', 0.08); tone(554, 0.14, 0.12, 'square', 0.08); })
  };
})(window.ONA);
