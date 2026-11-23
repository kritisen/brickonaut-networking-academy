/* Progress persistence (localStorage), Leitner repair bay, session log, derived stats. */
(function (ONA) {
  'use strict';
  var KEY = 'ona.progress.v1';
  var VERSION = 1;
  // Leitner box review intervals (hours). Box 1 = due immediately. Correct in box 5 = repaired (box 0).
  var BOX_HOURS = [0, 0, 4, 24, 72, 168];
  var MAX_SESSIONS = 200;
  // Audio: `muted` is the master mute-all (M key, mute button). `music` / `sfx` toggle each layer (N key toggles music).
  var DEFAULT_SETTINGS = { freeRoam: false, muted: false, music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, motion: 'auto' };
  var MOTIONS = ['auto', 'reduce', 'full'];

  // Settings migration (same save version). Old saves only had { freeRoam, muted, motion }:
  // keep their mute-all choice and switch the new music/SFX layers on at default volume.
  // Every field is type-checked so a hand-edited or corrupt import can't break audio or motion.
  function migrateSettings(st) {
    st = st && typeof st === 'object' && !Array.isArray(st) ? st : {};
    var bool = function (k) { return typeof st[k] === 'boolean' ? st[k] : DEFAULT_SETTINGS[k]; };
    var vol = function (k) { var v = st[k]; return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS[k]; };
    return {
      freeRoam: bool('freeRoam'), muted: bool('muted'), music: bool('music'), sfx: bool('sfx'),
      musicVol: vol('musicVol'), sfxVol: vol('sfxVol'),
      motion: MOTIONS.indexOf(st.motion) >= 0 ? st.motion : DEFAULT_SETTINGS.motion
    };
  }

  function fresh() {
    return {
      version: VERSION,
      created: Date.now(),
      settings: migrateSettings({}),
      xp: 0,
      bestStreak: 0,
      shipAt: 1,
      levels: {},
      questions: {},
      journeys: {},
      sessions: [],
      ship: { tier: 0, repairs: 0 }
    };
  }

  // Ship record (same save version). `tier` = the highest cosmetic tier already celebrated; `repairs` = modules
  // fully repaired (a Repair Bay card cleared from bay 5). Old saves have no `ship`: they start at the tier their
  // stars already earn (so no fake "upgrade" fanfare on first load). Corrupt values are coerced the same way.
  function starsOf(s) {
    var n = 0;
    (ONA.LEVELS || []).forEach(function (l) { var r = s.levels && s.levels[l.id]; if (!l.bonus && r && typeof r.bestStars === 'number') n += r.bestStars; });
    return n;
  }
  function migrateShip(ship, s) {
    var earned = ONA.ship ? ONA.ship.tierFor(starsOf(s)).index : 0;
    var max = ONA.ship ? ONA.ship.TIERS.length - 1 : 4;
    ship = ship && typeof ship === 'object' && !Array.isArray(ship) ? ship : {};
    var tier = Number.isInteger(ship.tier) && ship.tier >= 0 && ship.tier <= max ? ship.tier : earned;
    var repairs = Number.isInteger(ship.repairs) && ship.repairs >= 0 ? ship.repairs : 0;
    return { tier: tier, repairs: repairs };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('ONA: progress unreadable, starting fresh', e);
      return fresh();
    }
  }

  function normalize(s) {
    if (!s || typeof s !== 'object' || s.version !== VERSION) throw new Error('Not an Orbital Network Academy v1 save');
    var f = fresh(), rawShip = s.ship;          // read before defaults fill it in (see migrateShip)
    Object.keys(f).forEach(function (k) { if (s[k] === undefined) s[k] = f[k]; });
    s.settings = migrateSettings(s.settings);
    if (!Array.isArray(s.sessions)) s.sessions = [];
    migrate(s);
    s.ship = migrateShip(rawShip, s);
    return s;
  }

  // Additive migration (same save version): older saves stored only whole correct/wrong counts.
  // `earned` = sum of fractional scores (multipart partial credit); `possible` = graded attempts.
  function migrate(s) {
    Object.keys(s.questions || {}).forEach(function (id) {
      var r = s.questions[id];
      if (!r || typeof r !== 'object') { delete s.questions[id]; return; }
      ['seen', 'correct', 'wrong', 'totalMs', 'last', 'box', 'due'].forEach(function (k) { if (typeof r[k] !== 'number' || !isFinite(r[k])) r[k] = 0; });
      if (typeof r.earned !== 'number' || !isFinite(r.earned)) r.earned = r.correct;
      if (typeof r.possible !== 'number' || !isFinite(r.possible)) r.possible = r.seen;
    });
    migrateJourneys(s);
    return s;
  }

  // Holo-sim journeys (additive, same save version): { id: { done, firstTs, lastTs, firstTry, hints } }.
  // Saves from before journeys get an empty map; corrupt entries are dropped or coerced.
  var JOURNEY_XP = 40;
  function migrateJourneys(s) {
    var j = s.journeys;
    if (!j || typeof j !== 'object' || Array.isArray(j)) j = s.journeys = {};
    Object.keys(j).forEach(function (id) {
      var r = j[id];
      if (!r || typeof r !== 'object' || Array.isArray(r)) { delete j[id]; return; }
      ['done', 'firstTs', 'lastTs', 'hints'].forEach(function (k) { r[k] = typeof r[k] === 'number' && isFinite(r[k]) && r[k] >= 0 ? Math.floor(r[k]) : 0; });
      r.firstTry = r.firstTry === true;
    });
    return s;
  }

  var store = (ONA.store = { state: null, BOX_HOURS: BOX_HOURS, DEFAULT_SETTINGS: DEFAULT_SETTINGS, JOURNEY_XP: JOURNEY_XP, _migrate: migrate, _migrateSettings: migrateSettings, _migrateShip: migrateShip, _fresh: fresh });
  store.now = function () { return Date.now(); };   // overridable in tests

  store.init = function () { store.state = load(); };
  store.save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(store.state)); }
    catch (e) { console.warn('ONA: could not save progress', e); }
  };

  // Read or write one setting. Writes go through migrateSettings, so bad values are coerced
  // (volumes clamped to 0..1, unknown motion → 'auto') before they're saved.
  store.setting = function (k, v, opts) {
    if (v === undefined) return store.state.settings[k];
    var next = {}; Object.keys(store.state.settings).forEach(function (x) { next[x] = store.state.settings[x]; });
    next[k] = v;
    store.state.settings = migrateSettings(next);
    if (!(opts && opts.noSave)) store.save();
    return store.state.settings[k];
  };

  store.levelRec = function (id) {
    var l = store.state.levels[id];
    if (!l) l = store.state.levels[id] = { bestStars: 0, bestScore: 0, bestAccuracy: 0, plays: 0 };
    return l;
  };

  store.qRec = function (id) {
    var q = store.state.questions[id];
    if (!q) q = store.state.questions[id] = { seen: 0, correct: 0, wrong: 0, earned: 0, possible: 0, totalMs: 0, last: 0, box: 0, due: 0 };
    return q;
  };

  // Record one graded attempt. score in [0,1] (multipart partial credit), correct = score === 1.
  // Leitner: a miss always (re)enters box 1, due now. A hit promotes a card already in the bay
  // ONLY when it is due, so off-schedule practice ("Drill all damaged", missions, drills) never skips boxes.
  store.recordAnswer = function (q, score, ms) {
    var r = store.qRec(q.id), now = store.now(), wasBox = r.box;
    score = Math.max(0, Math.min(1, +score || 0));
    r.seen++;
    r.possible++;
    r.earned += score;
    r.totalMs += ms || 0;
    r.last = now;
    var correct = score >= 1;
    if (correct) r.correct++; else r.wrong++;
    if (!correct) { r.box = 1; r.due = now; }
    else if (r.box > 0 && r.due <= now) {
      r.box = r.box >= 5 ? 0 : r.box + 1;
      r.due = r.box ? now + BOX_HOURS[r.box] * 3600e3 : 0;
    }
    if (wasBox > 0 && r.box === 0) store.state.ship.repairs++;      // module part fully repaired
    return r;
  };

  // ------------------------------------------------ ship progression
  store.shipTier = function () { return ONA.ship.tierFor(store.totals().stars); };
  // If stars have earned a higher tier than the one already celebrated, record it and return { from, to }.
  store.claimShipUpgrade = function () {
    var now = store.shipTier().index, had = store.state.ship.tier;
    if (now <= had) return null;
    store.state.ship.tier = now; store.save();
    return { from: had, to: now };
  };
  // Accuracy helpers used everywhere (Captain's Log KPIs, topics, sectors, weakest list).
  store.acc = function (earned, possible) { return possible ? earned / possible : null; };

  store.unlocked = function (level) {
    if (level.bonus) return true;
    if (level.id === 1 || store.state.settings.freeRoam) return true;
    var prev = ONA.LEVELS.filter(function (l) { return !l.bonus && l.id < level.id; }).sort(function (a, b) { return b.id - a.id; })[0];
    return !prev || store.levelRec(prev.id).bestStars >= 2;
  };

  store.addSession = function (s) {
    store.state.sessions.push(s);
    if (store.state.sessions.length > MAX_SESSIONS) store.state.sessions.splice(0, store.state.sessions.length - MAX_SESSIONS);
    store.save();
  };

  // ------------------------------------------------ repair bay
  store.bay = function () {
    var now = store.now(), boxes = [0, 0, 0, 0, 0, 0], due = [];
    Object.keys(store.state.questions).forEach(function (id) {
      var r = store.state.questions[id];
      if (!r.box || !ONA.util.qById(id)) return;
      boxes[r.box]++;
      if (r.due <= now) due.push(id);
    });
    var total = boxes.reduce(function (a, b) { return a + b; }, 0);
    return { boxes: boxes, due: due, total: total };
  };
  store.bayAll = function () {
    return Object.keys(store.state.questions).filter(function (id) { return store.state.questions[id].box > 0 && ONA.util.qById(id); });
  };

  // ------------------------------------------------ derived stats
  store.topicStats = function () {
    var t = {};
    Object.keys(ONA.TOPICS).forEach(function (k) { t[k] = { topic: k, correct: 0, earned: 0, possible: 0, seen: 0, ms: 0 }; });
    Object.keys(store.state.questions).forEach(function (id) {
      var q = ONA.util.qById(id); if (!q || !t[q.topic]) return;
      var r = store.state.questions[id], s = t[q.topic];
      s.correct += r.correct; s.earned += r.earned; s.possible += r.possible; s.seen += r.seen; s.ms += r.totalMs;
    });
    return Object.keys(t).map(function (k) { var s = t[k]; s.acc = store.acc(s.earned, s.possible); return s; });
  };

  // Per-level ("sector") accuracy for the radar.
  store.levelStats = function () {
    var out = {};
    Object.keys(store.state.questions).forEach(function (id) {
      var q = ONA.util.qById(id); if (!q) return;
      var r = store.state.questions[id], s = out[q.level] = out[q.level] || { earned: 0, possible: 0 };
      s.earned += r.earned; s.possible += r.possible;
    });
    Object.keys(out).forEach(function (k) { out[k].acc = store.acc(out[k].earned, out[k].possible); });
    return out;
  };

  store.typeStats = function () {
    var t = {};
    Object.keys(store.state.questions).forEach(function (id) {
      var q = ONA.util.qById(id); if (!q) return;
      var r = store.state.questions[id];
      var s = t[q.type] = t[q.type] || { type: q.type, seen: 0, ms: 0, correct: 0, earned: 0, possible: 0 };
      s.seen += r.seen; s.ms += r.totalMs; s.correct += r.correct; s.earned += r.earned; s.possible += r.possible;
    });
    return t;
  };

  store.totals = function () {
    var seen = 0, correct = 0, earned = 0, possible = 0, ms = 0;
    Object.keys(store.state.questions).forEach(function (id) {
      var r = store.state.questions[id]; seen += r.seen; correct += r.correct; earned += r.earned; possible += r.possible; ms += r.totalMs;
    });
    var stars = 0;
    ONA.LEVELS.forEach(function (l) { if (!l.bonus) stars += store.levelRec(l.id).bestStars; });
    return { seen: seen, correct: correct, earned: earned, possible: possible, acc: store.acc(earned, possible), ms: ms, stars: stars, xp: store.state.xp, bestStreak: store.state.bestStreak, sessions: store.state.sessions.length };
  };

  // Rank ladder for the HUD.
  var RANKS = [[0, 'Cadet'], [1500, 'Ensign'], [4000, 'Lieutenant'], [8000, 'Lt. Commander'], [14000, 'Commander'], [22000, 'Captain'], [32000, 'Fleet Admiral']];
  store.rank = function (xp) {
    var i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
    var lo = RANKS[i][0], hi = RANKS[i + 1] ? RANKS[i + 1][0] : lo;
    return { name: RANKS[i][1], index: i, progress: hi > lo ? (xp - lo) / (hi - lo) : 1, next: RANKS[i + 1] ? RANKS[i + 1][1] : null, toNext: hi - xp };
  };

  // ------------------------------------------------ holo-sim journeys
  store.journeyRec = function (id) {
    var j = store.state.journeys || (store.state.journeys = {});
    return j[id] || (j[id] = { done: 0, firstTs: 0, lastTs: 0, firstTry: false, hints: 0 });
  };
  // Finishing = answering the end-of-journey check correctly. XP badge only on the first completion.
  store.completeJourney = function (id, firstTry) {
    var r = store.journeyRec(id), now = store.now(), first = r.done === 0;
    r.done++; r.lastTs = now;
    if (first) r.firstTs = now;
    // "First try" means the first-ever completion was clean; a clean replay after a failed first run doesn't count.
    if (first && firstTry) r.firstTry = true;
    var xp = first ? JOURNEY_XP : 0;
    store.state.xp += xp;
    store.save();
    return { first: first, xp: xp, rec: r };
  };
  // Watched a journey from a question before answering it (counted as a hint; the game has no hint penalty).
  store.journeyHint = function (id) { store.journeyRec(id).hints++; store.save(); };
  store.journeyTotals = function () {
    var j = store.state.journeys || {}, ids = Object.keys(j).filter(function (id) { return j[id].done > 0; });
    return { completed: ids.length, runs: ids.reduce(function (a, id) { return a + j[id].done; }, 0) };
  };

  // ------------------------------------------------ export / import / reset
  store.exportJSON = function () { return JSON.stringify(store.state, null, 2); };
  store.importJSON = function (text) {
    var s = normalize(JSON.parse(text));
    store.state = s; store.save(); return s;
  };
  store.reset = function () {
    var keep = store.state.settings;
    store.state = fresh(); store.state.settings = keep; store.save();
  };
})(window.ONA);
