/* Generative ambient music, 100% WebAudio (no files, works offline from file://).
 *
 * Moods (crossfaded when the screen changes):
 *   calm     title, galaxy map, Repair Bay, Captain's Log, debrief: slow D-major pads, drone, sparse bells
 *   focus    missions, drills, repair runs: A-minor pads, a soft 8th-note arpeggio, gentle sub pulse
 *   tension  World 6 boss: E-phrygian pads, detuned drone, 16th arp, heartbeat pulse
 *   sting    one-shot C-major swell + bell run when a level is cleared, then back to `calm`
 *
 * Timing: one "lookahead" scheduler (a single setInterval waking every 60 ms, scheduling notes up to
 * 0.4 s ahead on the AudioContext clock). That's the standard "two clocks" pattern: no timer per note,
 * sample-accurate timing, and no seams because the music is generated beat by beat, never looped from a buffer.
 * Every voice disconnects itself when it ends, and mood decks are disposed after their fade-out,
 * so the node count stays flat (checked by tests/smoke_browser.mjs via ONA.music.stats().live).
 */
(function (ONA) {
  'use strict';
  var A = ONA.audio;
  var LOOKAHEAD = 0.4, TICK_MS = 60, XFADE = 2.6;
  var M = (ONA.music = {});

  var MOODS = {
    calm: {
      bpm: 56, beatsPerChord: 8,
      chords: [[50, 57, 61, 64, 66], [47, 54, 57, 62, 64], [43, 50, 54, 57, 61], [45, 52, 59, 61, 64]],   // Dmaj9 · Bm11 · Gmaj9#11 · A6sus2
      drone: { notes: [38, 45], type: 'sine', gain: 0.07, detune: 0, cutoff: 600 },
      pad: { type: 'sawtooth', cutoff: 760, lfoRate: 0.05, lfoDepth: 260, gain: 0.11, attack: 3.2, release: 4 },
      melody: { scale: [62, 64, 66, 69, 71, 74, 76, 78, 81], prob: 0.3, every: 1, gain: 0.07 },
      arp: null, pulse: null
    },
    focus: {
      bpm: 78, beatsPerChord: 8,
      chords: [[45, 52, 55, 59, 60], [41, 48, 52, 57, 60], [48, 55, 59, 64, 67], [43, 50, 52, 57, 62]],   // Am9 · Fmaj7 · Cmaj7 · G6sus
      drone: { notes: [33, 45], type: 'sine', gain: 0.06, detune: 0, cutoff: 500 },
      pad: { type: 'sawtooth', cutoff: 900, lfoRate: 0.08, lfoDepth: 300, gain: 0.09, attack: 2.2, release: 3 },
      arp: { div: 2, pattern: [0, 2, 1, 3, 2, 4, 3, 1], octave: 12, gain: 0.05, cutoff: 2100, decay: 0.32 },
      melody: { scale: [69, 72, 74, 76, 79, 81, 84], prob: 0.12, every: 2, gain: 0.055 },
      pulse: { beats: [0, 2], gain: 0.12, freq: 55, double: 0 }
    },
    tension: {
      bpm: 70, beatsPerChord: 8,
      chords: [[40, 47, 54, 55, 59], [41, 48, 52, 57, 59], [40, 50, 53, 57, 60], [40, 47, 52, 55, 59]],   // Em(add9) · Fmaj7#11 · Dm9/E · Em
      drone: { notes: [28, 40], type: 'sawtooth', gain: 0.06, detune: 7, cutoff: 220 },
      pad: { type: 'sawtooth', cutoff: 620, lfoRate: 0.11, lfoDepth: 380, gain: 0.1, attack: 1.8, release: 3 },
      arp: { div: 4, pattern: [0, 1, 2, 1, 3, 2, 1, 2], octave: 12, gain: 0.035, cutoff: 1500, decay: 0.22 },
      melody: { scale: [64, 65, 67, 69, 71, 72, 74, 76], prob: 0.1, every: 2, gain: 0.05 },
      pulse: { beats: [0, 2], gain: 0.13, freq: 48, double: 0.28 }
    }
  };
  M.MOODS = MOODS;

  // Pure: which mood a screen gets. Unit-tested.
  // An open holo-sim journey always gets the calm bed (no boss tension under the narration).
  M.moodFor = function (screen, run, journeyOpen) {
    if (journeyOpen) return 'calm';
    if (screen === 'mission' && run) {
      var l = run.level;
      return l && l.boss ? 'tension' : 'focus';
    }
    return 'calm';
  };

  var mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
  var reduced = function () { return !!(ONA.util && ONA.util.reducedMotion && ONA.util.reducedMotion()); };

  var fx = null;            // shared reverb/delay chain, built once
  var cur = null;           // active mood deck
  var want = 'calm';        // requested mood (applied when running / when a sting ends)
  var mood = null;          // what's actually playing: a mood name, 'sting', or null
  var running = false, timer = 0, stingTimer = 0;
  var sting = null;          // live victory sting: { out: bus, voices: [oscillators], cleanup: timer }
  var collect = null;        // while a sting is being built, track() also records its voices here
  var stats = { live: 0, peakLive: 0, ticks: 0, maxTickMs: 0, notes: 0, decks: 0, stings: 0, stingBuses: 0 };

  function track(node) {
    stats.live++; stats.notes++; if (stats.live > stats.peakLive) stats.peakLive = stats.live;
    if (collect) collect.push(node);
    node.onended = function () { stats.live--; if (node._cleanup) node._cleanup(); };
  }

  // ---------------------------------------------------------------- shared FX: reverb + dotted delay
  function impulse(c, secs, decay) {
    var len = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        var x = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        lp += (x - lp) * 0.32;          // one-pole lowpass: darker, smoother tail
        d[i] = lp;
      }
    }
    return buf;
  }
  function buildFx() {
    var c = A.ctx;
    var dry = c.createGain(); dry.gain.value = 0.85; dry.connect(A.musicIn);
    var rev = c.createConvolver(); rev.buffer = impulse(c, 3.4, 3);
    var revIn = c.createGain(); revIn.gain.value = 0.55;
    var revOut = c.createGain(); revOut.gain.value = 0.8;
    revIn.connect(rev); rev.connect(revOut); revOut.connect(A.musicIn);
    var dly = c.createDelay(1.5); dly.delayTime.value = 0.43;
    var dlyIn = c.createGain(); dlyIn.gain.value = 0.3;
    var fb = c.createGain(); fb.gain.value = 0.34;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    dlyIn.connect(dly); dly.connect(lp); lp.connect(fb); fb.connect(dly);
    var dlyOut = c.createGain(); dlyOut.gain.value = 0.6; dly.connect(dlyOut); dlyOut.connect(revIn); dlyOut.connect(A.musicIn);
    fx = { dry: dry, revIn: revIn, dlyIn: dlyIn };
  }

  // A small "send bus": voices connect here; it feeds dry + reverb (+ optional delay) and carries the crossfade.
  function bus(level, delaySend) {
    var c = A.ctx, g = c.createGain();
    g.gain.value = level;
    g.connect(fx.dry); g.connect(fx.revIn);
    if (delaySend) { var s = c.createGain(); s.gain.value = delaySend; g.connect(s); s.connect(fx.dlyIn); g._send = s; }
    return g;
  }
  function fade(g, to, secs) {
    var t = A.ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(to, t + secs);
  }

  // ---------------------------------------------------------------- voices
  // Pad chord: two detuned saws per note → one lowpass (swept by the deck LFO) → slow envelope.
  function pad(dest, lfoAmt, notes, t, dur, p) {
    var c = A.ctx;
    var mix = c.createGain(); mix.gain.value = 1 / (notes.length * 2);
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.cutoff; f.Q.value = 0.6;
    var env = c.createGain();
    var peak = p.gain, end = t + dur + p.release;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + Math.min(p.attack, dur));
    env.gain.setValueAtTime(peak, t + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    mix.connect(f); f.connect(env); env.connect(dest);
    if (lfoAmt) lfoAmt.connect(f.frequency);
    var oscs = [];
    notes.forEach(function (n) {
      [-7, 7].forEach(function (det) {
        var o = c.createOscillator(); o.type = p.type; o.frequency.value = mtof(n); o.detune.value = det;
        o.connect(mix); o.start(t); o.stop(end + 0.05); oscs.push(o);
      });
    });
    var left = oscs.length;
    oscs.forEach(function (o) {
      track(o);
      o._cleanup = function () {
        o.disconnect();
        if (--left === 0) {
          mix.disconnect(); f.disconnect(); env.disconnect();
          if (lfoAmt) { try { lfoAmt.disconnect(f.frequency); } catch (e) { /* deck already disposed */ } }
        }
      };
    });
  }

  function bell(dest, midi, t, gain) {
    var c = A.ctx, end = t + 2.6;
    var env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(dest);
    var o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
    o1.type = 'sine'; o1.frequency.value = mtof(midi);
    o2.type = 'sine'; o2.frequency.value = mtof(midi) * 2.01; g2.gain.value = 0.22;
    o1.connect(env); o2.connect(g2); g2.connect(env);
    [o1, o2].forEach(function (o) { o.start(t); o.stop(end + 0.05); });
    var left = 2;
    [o1, o2].forEach(function (o) { track(o); o._cleanup = function () { o.disconnect(); if (--left === 0) { g2.disconnect(); env.disconnect(); } }; });
  }

  function pluck(dest, midi, t, gain, decay) {
    var c = A.ctx, o = c.createOscillator(), env = c.createGain(), end = t + decay;
    o.type = 'triangle'; o.frequency.value = mtof(midi);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(env); env.connect(dest);
    o.start(t); o.stop(end + 0.05);
    track(o); o._cleanup = function () { o.disconnect(); env.disconnect(); };
  }

  function thump(dest, t, freq, gain) {
    var c = A.ctx, o = c.createOscillator(), env = c.createGain(), end = t + 0.4;
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.12);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(env); env.connect(dest);
    o.start(t); o.stop(end + 0.05);
    track(o); o._cleanup = function () { o.disconnect(); env.disconnect(); };
  }

  // ---------------------------------------------------------------- mood deck
  function Deck(name) {
    var c = A.ctx, m = MOODS[name], rm = reduced();
    this.name = name; this.m = m;
    this.beatDur = 60 / m.bpm;
    this.beat = 0;
    this.next = c.currentTime + 0.12;
    this.lastMel = -1;
    this.out = bus(0, 0.6);                       // pads, drone, arp, bells
    this.low = c.createGain(); this.low.gain.value = 0; this.low.connect(fx.dry);   // pulse: dry only (no muddy reverb)
    fade(this.out, 1, XFADE); fade(this.low, 1, XFADE);
    // pad filter LFO (depth halved under reduced motion: fewer sweeping changes)
    this.lfo = c.createOscillator(); this.lfo.frequency.value = m.pad.lfoRate;
    this.lfoAmt = c.createGain(); this.lfoAmt.gain.value = m.pad.lfoDepth * (rm ? 0.5 : 1);
    this.lfo.connect(this.lfoAmt); this.lfo.start();
    if (m.arp) {
      this.arpF = c.createBiquadFilter(); this.arpF.type = 'lowpass'; this.arpF.frequency.value = m.arp.cutoff;
      this.arpF.connect(this.out);
    }
    // drone: continuous, slow attack
    var d = m.drone;
    this.droneG = c.createGain(); this.droneG.gain.value = 0.0001;
    this.droneG.gain.setTargetAtTime(d.gain, c.currentTime, 2.5);
    this.droneF = c.createBiquadFilter(); this.droneF.type = 'lowpass'; this.droneF.frequency.value = d.cutoff;
    this.droneG.connect(this.droneF); this.droneF.connect(this.out);
    var self = this;
    this.drones = [];
    d.notes.forEach(function (n, i) {
      var o = c.createOscillator(); o.type = d.type; o.frequency.value = mtof(n);
      o.detune.value = i % 2 ? d.detune : -d.detune;
      var g = c.createGain(); g.gain.value = 1 / d.notes.length;
      o.connect(g); g.connect(self.droneG); o.start();
      self.drones.push([o, g]);
    });
    stats.decks++;
  }
  Deck.prototype.schedule = function (b, t) {
    var m = this.m, bpc = m.beatsPerChord, chord = m.chords[Math.floor(b / bpc) % m.chords.length], inChord = b % bpc, rm = reduced();
    if (inChord === 0) pad(this.out, this.lfoAmt, chord, t, bpc * this.beatDur, m.pad);
    if (m.arp) {
      for (var s = 0; s < m.arp.div; s++) {
        if (inChord === bpc - 1 && s > 0) continue;            // breathe at the end of each chord
        var idx = (b * m.arp.div + s) % m.arp.pattern.length;
        var note = chord[m.arp.pattern[idx] % chord.length] + m.arp.octave;
        var accent = s === 0 ? 1 : 0.72;
        pluck(this.arpF, note, t + (s * this.beatDur) / m.arp.div, m.arp.gain * accent * (rm ? 0.7 : 1), m.arp.decay);
      }
    }
    if (m.pulse && m.pulse.beats.indexOf(b % 4) >= 0) {
      var pg = m.pulse.gain * (rm ? 0.35 : 1);                 // softer, not removed, under reduced motion
      thump(this.low, t, m.pulse.freq, pg);
      if (m.pulse.double) thump(this.low, t + m.pulse.double * this.beatDur, m.pulse.freq, pg * 0.6);
    }
    var mel = m.melody;
    if (mel && b >= 2 && b % mel.every === 0 && Math.random() < mel.prob) {
      var k;
      do { k = Math.floor(Math.random() * mel.scale.length); } while (k === this.lastMel && mel.scale.length > 1);
      this.lastMel = k;
      bell(this.out, mel.scale[k], t + (Math.random() < 0.5 ? 0 : this.beatDur / 2), mel.gain);
    }
  };
  Deck.prototype.stop = function (secs) {
    var self = this, rest = MOODS[this.name].pad.release + MOODS[this.name].beatsPerChord * this.beatDur + 0.5;
    fade(this.out, 0, secs); fade(this.low, 0, secs);
    setTimeout(function () {
      self.drones.forEach(function (p) { try { p[0].stop(); } catch (e) { /* stopped */ } p[0].disconnect(); p[1].disconnect(); });
      try { self.lfo.stop(); } catch (e) { /* stopped */ }
      self.lfo.disconnect(); self.lfoAmt.disconnect();
      self.droneG.disconnect(); self.droneF.disconnect();
      if (self.arpF) self.arpF.disconnect();
      self.out.disconnect(); if (self.out._send) self.out._send.disconnect(); self.low.disconnect();
      stats.decks--;
    }, (secs + rest) * 1000);
  };

  // ---------------------------------------------------------------- scheduler
  function tick() {
    var t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    var c = A.ctx;
    if (!c || c.state !== 'running' || !cur) return;
    var now = c.currentTime, d = cur;
    if (d.next < now - 0.2) d.next = now + 0.05;            // timers were throttled: skip ahead, never burst
    while (d.next < now + LOOKAHEAD) { d.schedule(d.beat, d.next); d.beat++; d.next += d.beatDur; }
    stats.ticks++;
    if (t0) stats.maxTickMs = Math.max(stats.maxTickMs, performance.now() - t0);
  }

  function switchTo(name) {
    if (cur && cur.name === name) return;
    if (cur) cur.stop(XFADE);
    cur = new Deck(name);
    mood = name;
  }

  function start() {
    if (!fx) buildFx();
    running = true;
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    switchTo(want);
    tick();
  }
  function stop() {
    running = false;
    clearInterval(timer); timer = 0;
    disposeSting(0.5);
    if (cur) { cur.stop(0.8); cur = null; }
    mood = null;
  }

  // Idempotent: cancel the sting's hand-back timer, fade its bus over `secs`, then promptly stop its voices and
  // disconnect it (one tracked cleanup timer). Safe to call when no sting is playing or one is already disposing.
  function disposeSting(secs) {
    clearTimeout(stingTimer); stingTimer = 0;
    var s = sting; if (!s) return;
    sting = null;
    clearTimeout(s.cleanup);
    if (secs > 0) fade(s.out, 0, secs);
    s.cleanup = setTimeout(function () {
      s.voices.forEach(function (o) { try { o.stop(); } catch (e) { /* already stopped */ } });
      s.out.disconnect(); if (s.out._send) s.out._send.disconnect();
      stats.stingBuses--;
    }, Math.max(0, secs || 0) * 1000 + 30);
  }

  // Start/stop to match settings + context state. Returns true if music started on this call.
  M.sync = function () {
    var s = ONA.store.state.settings;
    var should = !!A.ctx && s.music && !s.muted && !A.hidden;
    if (should && !running) { start(); return true; }
    if (!should && running) stop();
    return false;
  };

  // During a victory sting: menus (calm) let it finish; launching a mission cuts it short and crossfades in.
  M.setMood = function (name) {
    if (!MOODS[name]) return;
    want = name;
    if (!running) return;
    if (mood === 'sting') {
      if (name === 'calm') return;
      disposeSting(1.2);
      mood = null;
    }
    switchTo(name);
  };

  // Victory sting: quick fade of the current mood, a C-major swell + bell run, then the requested mood.
  M.sting = function () {
    if (!running) return false;
    var c = A.ctx, t = c.currentTime + 0.08;
    if (cur) { cur.stop(0.9); cur = null; }
    disposeSting(0.3);                                       // a sting already playing gets cut, not leaked
    mood = 'sting'; stats.stings++;
    var out = bus(1, 0.5), s = { out: out, voices: [], cleanup: 0 };
    collect = s.voices;
    pad(out, null, [48, 55, 59, 62, 64, 67], t, 2.2, { type: 'sawtooth', cutoff: 1500, gain: 0.12, attack: 0.5, release: 2.6 });
    [72, 76, 79, 83, 86, 88].forEach(function (n, i) { bell(out, n, t + 0.1 + i * 0.13, 0.08); });
    thump(out, t, 65, 0.1);
    collect = null;
    sting = s; stats.stingBuses++;
    // natural end: dispose once the tail has rung out (cut short earlier by stop() / setMood())
    s.cleanup = setTimeout(function () { if (sting === s) disposeSting(0); }, 9500);
    stingTimer = setTimeout(function () {
      stingTimer = 0;
      if (mood !== 'sting') return;
      mood = null;
      if (running) switchTo(want);
    }, 3600);
    return true;
  };

  M.playing = function () { return running; };
  M.mood = function () { return mood; };
  M.stats = function () { return { mood: mood, want: want, playing: running, live: stats.live, peakLive: stats.peakLive, ticks: stats.ticks, maxTickMs: +stats.maxTickMs.toFixed(2), notes: stats.notes, decks: stats.decks, stings: stats.stings, stingBuses: stats.stingBuses, stingLive: !!sting }; };
})(window.ONA);
