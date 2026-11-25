#!/usr/bin/env node
// Deterministic unit tests for js/store.js (Leitner transitions, multipart partial credit, progress + settings
// migration, audio settings persistence) plus the pure parts of js/audio.js and js/music.js.
// Usage: node tests/unit_store.mjs   (no deps; runs the real browser scripts in a vm sandbox)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3600e3;

function boot(savedJSON, mem = new Map()) {
  if (savedJSON !== undefined) mem.set('ona.progress.v1', savedJSON);
  const sandbox = {
    console,
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};                    // js/game.js wires window listeners at load (never fired here)
  vm.createContext(sandbox);
  for (const f of ['data/questions.js', 'data/journeys.js', 'js/util.js', 'js/store.js', 'js/brand.js', 'js/ship.js', 'js/audio.js', 'js/music.js', 'js/journeys.js', 'js/game.js']) {
    vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
  }
  const ONA = sandbox.ONA;
  let clock = Date.UTC(2026, 10, 22, 12, 0, 0);
  ONA.store.now = () => clock;
  ONA.store.init();
  return { ONA, store: ONA.store, mem, tick: (ms) => { clock += ms; }, now: () => clock };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('miss puts a fresh card in bay 1, due now', () => {
  const { ONA, store, now } = boot();
  const q = ONA.util.qById('l2-aws-26');
  const r = store.recordAnswer(q, 0, 1000);
  assert.equal(r.box, 1); assert.equal(r.due, now());
  assert.deepEqual([...store.bay().due], ['l2-aws-26']);   // copy: array comes from the vm realm
});

test('correct on a never-missed card does not enter the bay', () => {
  const { ONA, store } = boot();
  const r = store.recordAnswer(ONA.util.qById('l2-aws-26'), 1, 1000);
  assert.equal(r.box, 0); assert.equal(store.bay().total, 0);
});

test('due hit promotes 1→2→3→4→5→repaired with the documented intervals', () => {
  const { ONA, store, tick, now } = boot();
  const q = ONA.util.qById('l1-dns-a');
  store.recordAnswer(q, 0, 500);                                  // box 1, due now
  const expect = [[2, 4], [3, 24], [4, 72], [5, 168]];
  for (const [box, hours] of expect) {
    const r = store.recordAnswer(q, 1, 500);
    assert.equal(r.box, box, 'box after promotion');
    assert.equal(r.due, now() + hours * HOUR, 'due after promotion to box ' + box);
    tick(hours * HOUR);                                           // wait until due
  }
  const r = store.recordAnswer(q, 1, 500);
  assert.equal(r.box, 0, 'clearing bay 5 repairs the card'); assert.equal(r.due, 0);
});

test('hit before the card is due does NOT promote (Drill all damaged / missions)', () => {
  const { ONA, store, tick } = boot();
  const q = ONA.util.qById('l1-dns-a');
  store.recordAnswer(q, 0, 500);
  const r1 = store.recordAnswer(q, 1, 500);                       // due → box 2, due in 4h
  assert.equal(r1.box, 2);
  const due = r1.due;
  tick(1 * HOUR);
  const r2 = store.recordAnswer(q, 1, 500);                       // early practice hit
  assert.equal(r2.box, 2, 'still in box 2'); assert.equal(r2.due, due, 'due unchanged');
  assert.equal(store.bay().due.length, 0, 'not due yet');
});

test('miss from a high bay drops back to bay 1, due now', () => {
  const { ONA, store, tick, now } = boot();
  const q = ONA.util.qById('l1-dns-a');
  store.recordAnswer(q, 0, 1); store.recordAnswer(q, 1, 1); tick(4 * HOUR); store.recordAnswer(q, 1, 1);
  assert.equal(store.qRec(q.id).box, 3);
  tick(HOUR);
  const r = store.recordAnswer(q, 0, 1);
  assert.equal(r.box, 1); assert.equal(r.due, now());
});

test('multipart 2/3 earns partial credit in topic, level, type and totals', () => {
  const { ONA, store } = boot();
  const q = ONA.util.qById('l6-azure-500');                      // dbx-scenario, level 6, 3 parts
  assert.equal(q.type, 'multipart'); assert.equal(q.parts.length, 3);
  const r = store.recordAnswer(q, 2 / 3, 9000);
  assert.equal(r.correct, 0); assert.equal(r.wrong, 1); assert.equal(r.box, 1, 'not fully correct → Repair Bay');
  const topic = store.topicStats().find((t) => t.topic === 'dbx-scenario');
  assert.ok(Math.abs(topic.acc - 2 / 3) < 1e-9, 'topic accuracy is 66.7%, not 0%');
  assert.ok(Math.abs(store.levelStats()[6].acc - 2 / 3) < 1e-9, 'sector/radar accuracy');
  const t = store.totals();
  assert.ok(Math.abs(t.acc - 2 / 3) < 1e-9); assert.equal(t.possible, 1);
  assert.ok(Math.abs(store.typeStats().multipart.earned - 2 / 3) < 1e-9);
});

test('mixed attempts aggregate earned/possible across a topic', () => {
  const { ONA, store } = boot();
  store.recordAnswer(ONA.util.qById('l6-azure-500'), 1 / 3, 1);
  store.recordAnswer(ONA.util.qById('l6-aws-500'), 1, 1);
  const topic = store.topicStats().find((t) => t.topic === 'dbx-scenario');
  assert.equal(topic.possible, 2);
  assert.ok(Math.abs(topic.acc - (1 / 3 + 1) / 2) < 1e-9);
});

test('score is clamped to [0, 1]', () => {
  const { ONA, store } = boot();
  const r = store.recordAnswer(ONA.util.qById('l1-dns-a'), 7, 1);
  assert.equal(r.earned, 1);
  const r2 = store.recordAnswer(ONA.util.qById('l1-dns-ttl'), -3, 1);
  assert.equal(r2.earned, 0);
});

test('migration: old saves without earned/possible get them from correct/seen', () => {
  const old = {
    version: 1, created: 1, settings: { freeRoam: false, muted: true, motion: 'auto' }, xp: 500, bestStreak: 3, shipAt: 2, levels: {},
    questions: {
      'l1-dns-a': { seen: 4, correct: 3, wrong: 1, totalMs: 4000, last: 1, box: 0, due: 0 },
      'l6-azure-500': { seen: 2, correct: 0, wrong: 2, totalMs: 9000, last: 1, box: 1, due: 1 },
      'bogus': null
    },
    sessions: []
  };
  const { store } = boot(JSON.stringify(old));
  const a = store.state.questions['l1-dns-a'];
  assert.equal(a.earned, 3); assert.equal(a.possible, 4);
  assert.equal(store.state.questions['l6-azure-500'].earned, 0);
  assert.equal(store.state.questions.bogus, undefined, 'corrupt record dropped');
  assert.equal(store.state.settings.muted, true, 'settings preserved');
  const t = store.totals();
  assert.equal(t.possible, 6); assert.ok(Math.abs(t.acc - 3 / 6) < 1e-9);
});

test('import round-trip keeps partial credit; bad import throws and keeps state', () => {
  const { ONA, store } = boot();
  store.recordAnswer(ONA.util.qById('l6-azure-500'), 2 / 3, 1);
  const json = store.exportJSON();
  store.reset();
  assert.equal(store.totals().possible, 0);
  store.importJSON(json);
  assert.ok(Math.abs(store.totals().acc - 2 / 3) < 1e-9);
  assert.throws(() => store.importJSON('{"version": 99}'));
  assert.ok(Math.abs(store.totals().acc - 2 / 3) < 1e-9, 'failed import left state intact');
});

test('bonus level stars do not count toward the 18-star total', () => {
  const { ONA, store } = boot();
  ONA.registerLevel({ id: 7, key: 'bonus-test', name: 'Bonus test', bonus: true }, []);
  store.levelRec(7).bestStars = 3; store.levelRec(1).bestStars = 2;
  assert.equal(store.totals().stars, 2);
});

// ---------------------------------------------------------------- settings migration + audio settings
const OLD_SETTINGS_SAVE = (settings) => JSON.stringify({ version: 1, created: 1, settings, xp: 0, bestStreak: 0, shipAt: 1, levels: {}, questions: {}, sessions: [] });
const plain = (o) => JSON.parse(JSON.stringify(o));   // copy out of the vm realm for deepEqual

test('settings migration: old save with muted:true keeps mute-all, turns music + SFX on at default volume', () => {
  const { store } = boot(OLD_SETTINGS_SAVE({ freeRoam: true, muted: true, motion: 'reduce' }));
  assert.deepEqual(plain(store.state.settings), { freeRoam: true, freeRoamSet: false, muted: true, music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, motion: 'reduce', journeySpeed: 1 });
});

test('settings migration: old save with muted:false plays music and SFX', () => {
  const { ONA, store } = boot(OLD_SETTINGS_SAVE({ freeRoam: false, muted: false, motion: 'auto' }));
  const s = store.state.settings;
  assert.equal(s.muted, false); assert.equal(s.music, true); assert.equal(s.sfx, true);
  const lv = ONA.audio.levels(s);
  assert.equal(lv.master, 1); assert.ok(lv.music > 0); assert.ok(lv.sfx > 0);
});

test('settings migration: corrupt or missing values are coerced, unknown keys dropped', () => {
  const { store } = boot(OLD_SETTINGS_SAVE({ muted: 'yes', music: 1, sfx: false, musicVol: 'loud', sfxVol: 7, motion: 'warp', evil: '<script>' }));
  assert.deepEqual(plain(store.state.settings), { freeRoam: true, freeRoamSet: false, muted: false, music: true, sfx: false, musicVol: 0.5, sfxVol: 1, motion: 'auto', journeySpeed: 1 });
  const { store: s2 } = boot(OLD_SETTINGS_SAVE(null));
  assert.deepEqual(plain(s2.state.settings), plain(s2.DEFAULT_SETTINGS));
  const { store: s3 } = boot(OLD_SETTINGS_SAVE([1, 2]));
  assert.equal(s3.state.settings.music, true, 'array settings → defaults');
});

test('audio settings: setting() clamps volumes and persists music/SFX choices across reloads', () => {
  const mem = new Map();
  const { store } = boot(undefined, mem);
  assert.equal(store.setting('musicVol', 1.7), 1, 'clamped to 1');
  assert.equal(store.setting('sfxVol', -2), 0, 'clamped to 0');
  store.setting('musicVol', 0.35); store.setting('music', false); store.setting('sfx', true); store.setting('muted', true);
  store.setting('sfxVol', 0.9, { noSave: true });                 // slider drag: not saved until release
  const { store: again } = boot(undefined, mem);                  // reload from the same localStorage
  const s = again.state.settings;
  assert.equal(s.musicVol, 0.35); assert.equal(s.music, false); assert.equal(s.sfx, true); assert.equal(s.muted, true);
  assert.equal(s.sfxVol, 0, 'unsaved drag value not persisted');
});

test('audio settings survive export/import and progress reset', () => {
  const { store } = boot();
  store.setting('music', false); store.setting('musicVol', 0.2); store.setting('sfxVol', 0.6);
  const json = store.exportJSON();
  store.reset();
  assert.equal(store.state.settings.music, false, 'reset keeps settings'); assert.equal(store.state.settings.musicVol, 0.2);
  store.setting('music', true);
  store.importJSON(json);
  assert.equal(store.state.settings.music, false); assert.equal(store.state.settings.sfxVol, 0.6);
});

test('audio.needsTap: the "Tap for sound" chip only when music is wanted, the context is stuck and the page is visible', () => {
  const { ONA } = boot();
  const on = { music: true, muted: false };
  assert.equal(ONA.audio.needsTap(on, 'suspended', false), true);
  assert.equal(ONA.audio.needsTap(on, 'interrupted', false), true);          // iOS phone call / lock screen
  assert.equal(ONA.audio.needsTap(on, 'running', false), false);
  assert.equal(ONA.audio.needsTap(on, 'closed', false), false);
  assert.equal(ONA.audio.needsTap(on, 'suspended', true), false);            // hidden tab suspends on purpose
  assert.equal(ONA.audio.needsTap({ music: true, muted: true }, 'suspended', false), false);
  assert.equal(ONA.audio.needsTap({ music: false, muted: false }, 'suspended', false), false);
  assert.equal(ONA.audio.needsTap(on, null, false), false);                  // no context yet: nothing to unlock
  // old-iOS fallback in use: a running context isn't enough if the session loop isn't playing
  assert.equal(ONA.audio.needsTap(on, 'running', false, false), true);
  assert.equal(ONA.audio.needsTap(on, 'running', false, true), false);
  assert.equal(ONA.audio.needsTap(on, 'running', true, false), false);
});

test('audio.soundWanted: the session loop / unlock only matter when something can play', () => {
  const { ONA } = boot();
  const w = (o) => ONA.audio.soundWanted({ muted: false, music: true, sfx: true, ...o });
  assert.equal(w({}), true);
  assert.equal(w({ music: false }), true);                                   // SFX alone still need a session
  assert.equal(w({ sfx: false }), true);
  assert.equal(w({ music: false, sfx: false }), false);
  assert.equal(w({ muted: true }), false);
  assert.equal(ONA.audio.soundWanted(null), false);
});

test('audio.sessionMode: audioSession where it exists, a silent loop on older iOS, nothing elsewhere', () => {
  const { ONA } = boot();
  const m = (nav) => ONA.audio.sessionMode(nav);
  assert.equal(m({ audioSession: { type: 'auto' }, userAgent: 'iPhone OS 17_0' }), 'audio-session');
  assert.equal(m({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X)' }), 'silent-loop');
  assert.equal(m({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 'silent-loop');   // iPadOS desktop UA
  assert.equal(m({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), 'none');
  assert.equal(m({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', maxTouchPoints: 5 }), 'none');   // touch-screen Mac / emulation
  assert.equal(m({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile' }), 'none');
  assert.equal(m(null), 'none');
});

test('audio.levels: mute-all zeroes master; music/SFX switches zero their bus; volumes scale', () => {
  const { ONA } = boot();
  const base = { muted: false, music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8 };
  const lv = ONA.audio.levels(base);
  assert.equal(lv.master, 1); assert.equal(lv.sfx, 0.8); assert.ok(lv.music > 0 && lv.music <= 0.5, 'music has headroom under SFX');
  assert.equal(ONA.audio.levels({ ...base, muted: true }).master, 0);
  assert.equal(ONA.audio.levels({ ...base, music: false }).music, 0);
  assert.equal(ONA.audio.levels({ ...base, sfx: false }).sfx, 0);
  assert.equal(ONA.audio.levels({ ...base, musicVol: 1 }).music, 2 * lv.music);
  assert.equal(ONA.audio.levels({ ...base, musicVol: 0 }).music, 0);
  const j = ONA.audio.levels(base, { journey: true });
  assert.equal(+j.music.toFixed(6), +(lv.music * ONA.audio.JOURNEY_MUSIC).toFixed(6), 'music lowered under an open journey');
  assert.equal(j.sfx, lv.sfx); assert.equal(j.master, lv.master);
  assert.ok(ONA.audio.JOURNEY_MUSIC > 0 && ONA.audio.JOURNEY_MUSIC < 1);
});

test('audio.duck: overlapping ducks keep the deepest depth and the LATER recovery', () => {
  const { ONA } = boot();
  const calls = [];
  const gain = { value: 1,
    cancelScheduledValues: (t) => calls.push(['cancel', t]),
    setValueAtTime: (v, t) => calls.push(['set', v, t]),
    setTargetAtTime: (v, t) => calls.push(['target', v, +t.toFixed(3)]) };
  const A = ONA.audio;
  A.ctx = { currentTime: 10 }; A.duckGain = { gain };
  const lastRecovery = () => calls.filter((c) => c[0] === 'target' && c[1] === 1).pop()[2];
  const lastDepth = () => calls.filter((c) => c[0] === 'target' && c[1] !== 1).pop()[1];
  A.duck(0.3, 2.4);                                 // wrong-answer duck: recover at 12.4
  assert.equal(lastRecovery(), 12.4);
  A.ctx.currentTime = 10.5; A.duck(0.6, 0.45);      // short SFX duck inside it must NOT recover at 10.95
  assert.equal(lastRecovery(), 12.4, 'later recovery kept');
  assert.equal(lastDepth(), 0.3, 'deepest depth kept');
  assert.equal(+A._duckState().until.toFixed(3), 12.4);
  A.ctx.currentTime = 12; A.duck(0.5, 1.5);         // a duck that ends later extends the window
  assert.equal(lastRecovery(), 13.5); assert.equal(lastDepth(), 0.3);
  A.ctx.currentTime = 20; A.duck(0.6, 0.45);        // after the window: a fresh, independent duck
  assert.equal(lastRecovery(), 20.45); assert.equal(lastDepth(), 0.6);
});

test('music.moodFor: calm on menus, focus in missions, tension for the boss, focus for bonus worlds and repair runs', () => {
  const { ONA } = boot();
  const mf = ONA.music.moodFor, L = (id) => ONA.util.level(id);
  for (const screen of ['title', 'map', 'bay', 'log', 'debrief']) assert.equal(mf(screen, null), 'calm', screen);
  assert.equal(mf('mission', { level: L(1) }), 'focus');
  assert.equal(mf('mission', { level: L(5) }), 'focus');
  assert.equal(mf('mission', { level: L(6) }), 'tension', 'World 6 boss');
  assert.equal(mf('mission', { level: { id: 7, bonus: true } }), 'focus', 'non-boss bonus world');
  assert.equal(mf('mission', { level: null }), 'focus', 'Repair Bay run');
  assert.equal(mf('debrief', { level: L(6) }), 'calm', 'debrief after the boss');
  assert.equal(mf('mission', { level: L(6) }, true), 'calm', 'an open journey calms even the boss');
  assert.equal(mf('mission', { level: L(1) }, false), 'focus');
  for (const m of Object.keys(ONA.music.MOODS)) {
    const mood = ONA.music.MOODS[m];
    assert.ok(mood.bpm > 40 && mood.bpm < 100, m + ' tempo stays ambient');
    mood.chords.flat().concat(mood.melody.scale).forEach((n) => assert.ok(n >= 24 && n <= 96, m + ' note in range'));
  }
});

// ---------------------------------------------------------------- ship: modules, tiers, migration
test('ship modules: every question topic maps to exactly one module; ids, labels, anchors valid', () => {
  const { ONA } = boot();
  const S = ONA.ship, ids = S.MODULES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'unique module ids');
  for (const m of S.MODULES) {
    assert.ok(m.label && /\S/.test(m.label), m.id + ' label');
    assert.ok(Array.isArray(m.at) && m.at.length === 2 && m.at.every(Number.isFinite), m.id + ' anchor');
  }
  const seen = {};
  for (const m of S.MODULES) for (const t of m.topics) { assert.ok(!seen[t], 'topic ' + t + ' mapped twice'); seen[t] = m.id; }
  for (const t of Object.keys(ONA.TOPICS)) assert.ok(seen[t], 'topic "' + t + '" has no ship module');
  for (const q of ONA.QUESTIONS) assert.ok(S.module(S.moduleForQuestion(q)), q.id + ' maps to a real module');
  assert.equal(S.moduleForTopic('nat'), 'nat');
  assert.equal(S.module(S.moduleForTopic('dns')).label, 'DNS Antenna');
  assert.equal(S.module(S.moduleForTopic('dbx-pl-azure')).label, 'PrivateLink Conduit');
  assert.equal(S.moduleForTopic('topic-from-a-future-level'), S.FALLBACK, 'unknown topics fall back to the hull');
});

test('ship modules: missed questions become damaged modules; severity follows the worst Leitner bay', () => {
  const { ONA, store, tick } = boot();
  const Q = (id) => ONA.util.qById(id);
  assert.equal(Q('l3-split-horizon').topic, 'hybrid-dns');
  store.recordAnswer(Q('l1-dns-a'), 0, 1);           // dns        → DNS Antenna
  store.recordAnswer(Q('l3-split-horizon'), 0, 1);   // hybrid-dns → DNS Antenna
  store.recordAnswer(Q('l2-snat'), 0, 1);            // nat        → NAT Thruster
  let mods = ONA.ship.damagedModules(store);
  const ant = mods.find((m) => m.id === 'antenna'), nat = mods.find((m) => m.id === 'nat');
  assert.equal(mods.length, 2);
  assert.equal(ant.count, 2); assert.equal(ant.sev, 3, 'bay 1 → smoking');
  assert.deepEqual([...ant.topics].sort(), ['DNS fundamentals', 'Hybrid & private DNS']);
  assert.equal(nat.count, 1); assert.equal(nat.label, 'NAT Thruster');
  // repair one antenna part to bay 2: the module stays at the WORST bay of its parts (still bay 1 → sev 3)
  store.recordAnswer(Q('l1-dns-a'), 1, 1);
  assert.equal(ONA.ship.damagedModules(store).find((m) => m.id === 'antenna').sev, 3);
  store.recordAnswer(Q('l3-split-horizon'), 1, 1);  // both parts now bay 2 → cracked
  assert.equal(ONA.ship.damagedModules(store).find((m) => m.id === 'antenna').sev, 2);
  assert.deepEqual([1, 2, 3, 4, 5].map(ONA.ship.sevForBox), [3, 2, 2, 1, 1]);
  // fully repair the NAT part (bay 1 → … → cleared): module disappears and the repairs counter ticks
  const r = store.qRec('l2-snat'); r.box = 5; r.due = 0;
  store.recordAnswer(Q('l2-snat'), 1, 1);
  mods = ONA.ship.damagedModules(store);
  assert.equal(mods.find((m) => m.id === 'nat'), undefined, 'repaired module is gone');
  assert.equal(store.state.ship.repairs, 1);
  tick(1);
  // debrief mapping: per-run missed list → modules in first-hit order, counted
  const hit = ONA.ship.modulesForQuestions([Q('l2-snat'), Q('l1-dns-a'), Q('l3-split-horizon')]);
  assert.deepEqual(plain(hit.map((m) => [m.id, m.count])), [['nat', 1], ['antenna', 2]]);
});

test('ship tiers: thresholds, next upgrade and stars-to-go', () => {
  const { ONA } = boot();
  const t = (s) => ONA.ship.tierFor(s);
  assert.deepEqual([0, 2, 3, 6, 7, 10, 11, 14, 15, 18].map((s) => t(s).index), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(t(0).name, 'Scout'); assert.equal(t(0).next.name, 'Cutter'); assert.equal(t(0).toNext, 3);
  assert.equal(t(8).name, 'Frigate'); assert.equal(t(8).toNext, 3);
  assert.equal(t(18).next, null); assert.equal(t(18).toNext, 0);
  assert.equal(t(-5).index, 0); assert.equal(t('junk').index, 0);
});

test('ship loadout: tier from main-world stars; one decal per world cleared; bonus worlds add neither', () => {
  const { ONA, store } = boot();
  store.levelRec(1).bestStars = 2; store.levelRec(4).bestStars = 1; store.levelRec(2).bestStars = 0;
  let lo = ONA.ship.loadout(store);
  assert.equal(lo.tier.index, 1, '3 stars → Cutter');
  assert.deepEqual(plain(lo.decals.map((d) => d.id)), [1, 4]);
  ONA.registerLevel({ id: 7, key: 'bonus-test', name: 'Bonus test', bonus: true }, []);
  store.levelRec(7).bestStars = 3;                                  // bonus: no decal, no stars
  lo = ONA.ship.loadout(store);
  assert.deepEqual(plain(lo.decals.map((d) => d.id)), [1, 4]); assert.equal(lo.tier.stars, 3);
});

test('ship migration: old save without a ship record starts at its earned tier (no fake upgrade)', () => {
  const old = { version: 1, created: 1, settings: { muted: false }, xp: 0, bestStreak: 0, shipAt: 1, questions: {}, sessions: [],
    levels: { 1: { bestStars: 3, bestScore: 0, bestAccuracy: 1, plays: 1 }, 2: { bestStars: 3, bestScore: 0, bestAccuracy: 1, plays: 1 }, 3: { bestStars: 2, bestScore: 0, bestAccuracy: 1, plays: 1 } } };
  const { store } = boot(JSON.stringify(old));
  assert.deepEqual(plain(store.state.ship), { tier: 2, repairs: 0 }, '8 stars → Frigate already');
  assert.equal(store.claimShipUpgrade(), null, 'nothing to celebrate on first load');
  store.levelRec(3).bestStars = 3; store.levelRec(4).bestStars = 2;  // 11 stars → Cruiser
  assert.deepEqual(plain(store.claimShipUpgrade()), { from: 2, to: 3 });
  assert.equal(store.claimShipUpgrade(), null, 'claimed once');
});

test('ship migration: corrupt ship records are coerced; export/import keeps it; reset starts over', () => {
  for (const bad of [{ tier: 'x', repairs: -4 }, { tier: 99, repairs: 2.5 }, [1, 2], null, 'ship']) {
    const { store } = boot(JSON.stringify({ version: 1, created: 1, settings: {}, xp: 0, bestStreak: 0, shipAt: 1, levels: {}, questions: {}, sessions: [], ship: bad }));
    assert.deepEqual(plain(store.state.ship), { tier: 0, repairs: 0 }, JSON.stringify(bad));
  }
  const { store } = boot();
  store.state.ship = { tier: 3, repairs: 7 };
  const json = store.exportJSON();
  store.reset();
  assert.deepEqual(plain(store.state.ship), { tier: 0, repairs: 0 }, 'reset = fresh ship');
  store.importJSON(json);
  assert.deepEqual(plain(store.state.ship), { tier: 3, repairs: 7 });
});

// ---------------------------------------------------------------- holo-sim journeys
test('journeys: first completion awards the XP badge once; replays are counted without XP', () => {
  const { store, tick, now } = boot();
  const xp0 = store.state.xp;
  const a = store.completeJourney('dns', true);
  assert.equal(a.first, true); assert.equal(a.xp, store.JOURNEY_XP); assert.equal(store.state.xp, xp0 + store.JOURNEY_XP);
  const r = store.state.journeys.dns;
  assert.equal(r.done, 1); assert.equal(r.firstTry, true); assert.equal(r.firstTs, now()); assert.equal(r.lastTs, now());
  tick(HOUR);
  const b = store.completeJourney('dns', false);
  assert.equal(b.first, false); assert.equal(b.xp, 0); assert.equal(store.state.xp, xp0 + store.JOURNEY_XP, 'no XP farming on replays');
  assert.equal(r.done, 2); assert.equal(r.firstTry, true, 'a first-try success is kept'); assert.equal(r.lastTs, now()); assert.notEqual(r.firstTs, r.lastTs);
  store.completeJourney('nat', false);
  assert.equal(store.state.journeys.nat.firstTry, false);
  assert.deepEqual({ ...store.journeyTotals() }, { completed: 2, runs: 3 });
});

test('journeys: firstTry is only earned on the first-ever completion (a failed first run, then a clean replay, stays false)', () => {
  const mem = new Map();
  const { store, tick } = boot(undefined, mem);
  store.completeJourney('tls', false);
  assert.equal(store.state.journeys.tls.firstTry, false);
  tick(HOUR);
  const b = store.completeJourney('tls', true);
  assert.equal(b.first, false);
  assert.equal(store.state.journeys.tls.done, 2);
  assert.equal(store.state.journeys.tls.firstTry, false, 'a clean replay does not retro-award firstTry');
  assert.equal(boot(undefined, mem).store.state.journeys.tls.firstTry, false, 'still false after reload');
});

test('journeys: hint views are counted and everything persists across a reload', () => {
  const mem = new Map();
  const { store } = boot(undefined, mem);
  store.journeyHint('tcp'); store.journeyHint('tcp');
  store.completeJourney('tcp', true);
  const again = boot(undefined, mem).store;
  const r = again.state.journeys.tcp;
  assert.equal(r.hints, 2); assert.equal(r.done, 1); assert.equal(r.firstTry, true);
  assert.equal(again.journeyRec('never').done, 0, 'unknown journey starts empty');
});

test('journeys migration: saves from before journeys get an empty map and keep everything else', () => {
  const old = { version: 1, created: 1, settings: { freeRoam: true, muted: false, motion: 'auto' }, xp: 900, bestStreak: 4, shipAt: 3, levels: {}, questions: {}, sessions: [] };
  const { store } = boot(JSON.stringify(old));
  assert.deepEqual({ ...store.state.journeys }, {});
  assert.equal(store.state.xp, 900); assert.equal(store.state.settings.freeRoam, true);
  assert.equal(store.completeJourney('cidr', true).xp, store.JOURNEY_XP);
  assert.equal(store.state.xp, 900 + store.JOURNEY_XP);
});

test('journeys migration: corrupt journey data is coerced or dropped, never crashes', () => {
  const bad = JSON.stringify({ version: 1, created: 1, settings: {}, xp: 0, bestStreak: 0, shipAt: 1, levels: {}, questions: {}, sessions: [],
    journeys: { dns: { done: '3', firstTs: -5, lastTs: NaN, firstTry: 'yes', hints: 2.7 }, tls: null, nat: [1, 2], lb: { done: 2, firstTry: true } } });
  const { store } = boot(bad);
  const j = store.state.journeys;
  assert.deepEqual({ ...j.dns }, { done: 0, firstTs: 0, lastTs: 0, firstTry: false, hints: 2 });
  assert.equal(j.tls, undefined); assert.equal(j.nat, undefined);
  assert.equal(j.lb.done, 2); assert.equal(j.lb.firstTry, true); assert.equal(j.lb.hints, 0);
  const arr = JSON.stringify({ version: 1, created: 1, settings: {}, xp: 0, bestStreak: 0, shipAt: 1, levels: {}, questions: {}, sessions: [], journeys: [1, 2] });
  assert.deepEqual({ ...boot(arr).store.state.journeys }, {}, 'array replaced by an empty map');
});

test('journeys survive export/import; reset clears them', () => {
  const { store } = boot();
  store.completeJourney('privatelink', true);
  const dump = store.exportJSON();
  store.reset();
  assert.deepEqual({ ...store.state.journeys }, {});
  store.importJSON(dump);
  assert.equal(store.state.journeys.privatelink.done, 1);
  assert.equal(store.state.journeys.privatelink.firstTry, true);
});

// ---------------------------------------------------------------- free roam default, journey autoplay + speed, level cards
test('free roam: on by default for a new player; every main world is unlocked', () => {
  const { ONA, store } = boot();
  assert.equal(store.state.settings.freeRoam, true);
  assert.equal(store.state.settings.freeRoamSet, false);
  for (const l of ONA.LEVELS) assert.equal(store.unlocked(l), true, 'world ' + l.id + ' unlocked');
});

test('free roam: an explicit choice (on or off) is kept across reloads and export/import', () => {
  const mem = new Map();
  const { ONA, store } = boot(undefined, mem);
  store.setting('freeRoam', false);
  assert.equal(store.state.settings.freeRoamSet, true);
  assert.equal(store.unlocked(ONA.util.level(2)), false, 'gating back on');
  const again = boot(undefined, mem).store;
  assert.equal(again.state.settings.freeRoam, false, 'explicit off survives a reload');
  const dump = again.exportJSON();
  again.setting('freeRoam', true);
  again.importJSON(dump);
  assert.equal(again.state.settings.freeRoam, false, 'explicit off survives export/import');
  again.setting('freeRoam', true);
  assert.equal(boot(undefined, mem).store.state.settings.freeRoam, true, 'explicit on survives a reload');
});

test('free roam migration: older saves (always stored freeRoam:false, no choice flag) move to the new default, on', () => {
  for (const fr of [false, true]) {
    const { store } = boot(OLD_SETTINGS_SAVE({ freeRoam: fr, muted: false, music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, motion: 'auto' }));
    assert.equal(store.state.settings.freeRoam, true, 'old freeRoam:' + fr + ' → on');
  }
  const { store } = boot(OLD_SETTINGS_SAVE({ freeRoam: false, freeRoamSet: true }));
  assert.equal(store.state.settings.freeRoam, false, 'flagged off stays off');
  const { store: s2 } = boot(OLD_SETTINGS_SAVE({ freeRoam: 'no', freeRoamSet: true }));
  assert.equal(s2.state.settings.freeRoam, true, 'corrupt value → default');
  assert.equal(s2.state.settings.freeRoamSet, false);
});

test('journeys: autoplay is on by default when a journey opens, off under reduced motion', () => {
  const { ONA, store } = boot();
  assert.equal(ONA.journeys.autoplayDefault(), true, 'motion auto (no OS preference) → autoplay on');
  store.setting('motion', 'reduce');
  assert.equal(ONA.journeys.autoplayDefault(), false, 'reduced motion → starts paused');
  store.setting('motion', 'full');
  assert.equal(ONA.journeys.autoplayDefault(), true);
});

test('journeys: autoplay speed defaults to 1×, only 1 / 1.5 / 2 are kept, and it persists across reloads', () => {
  const mem = new Map();
  const { ONA, store } = boot(undefined, mem);
  assert.equal(store.state.settings.journeySpeed, 1);
  assert.equal(ONA.journeys.speed(), 1);
  assert.deepEqual([...ONA.journeys.SPEEDS], [1, 1.5, 2]);
  assert.equal(store.setting('journeySpeed', 3), 1, 'unknown speed → 1×');
  store.setting('journeySpeed', 1.5);
  assert.equal(boot(undefined, mem).store.state.settings.journeySpeed, 1.5, 'persisted');
  const { ONA: O2, store: s2 } = boot(undefined, mem);
  O2.journeys.cycleSpeed(); assert.equal(s2.state.settings.journeySpeed, 2);
  O2.journeys.cycleSpeed(); assert.equal(s2.state.settings.journeySpeed, 1, 'cycles back to 1×');
  assert.equal(boot(OLD_SETTINGS_SAVE({ journeySpeed: '2' })).store.state.settings.journeySpeed, 1, 'corrupt → 1×');
});

test('journeys: the 1× dwell is about half the old pace, scales with step length, and divides by the speed', () => {
  const { ONA } = boot();
  const J = ONA.journeys, oldDwell = (s) => Math.max(4200, s.say.length * 42);
  const steps = ONA.JOURNEYS.flatMap((j) => j.steps);
  const sum = (f) => steps.reduce((a, s) => a + f(s), 0);
  const ratio = sum((s) => J.dwellMs(s, 1)) / sum(oldDwell);
  assert.ok(ratio > 0.4 && ratio < 0.6, 'mean dwell ratio new/old ≈ 0.5, got ' + ratio.toFixed(2));
  assert.ok(J.dwellMs({ say: 'x'.repeat(240) }, 1) > J.dwellMs({ say: 'x'.repeat(100) }, 1), 'longer narration stays up longer');
  assert.equal(J.dwellMs({ say: 'short' }, 1), 2000, '2 s floor');
  assert.equal(J.dwellMs({ say: 'short' }, 2), 1000);
  const j = J.get('dns'), k = j.steps.findIndex((st) => st.from && st.to && !st.back && !st.figure);
  const at1 = J.scene(j, k, { speed: 1, static: true }), at2 = J.scene(j, k, { speed: 2, static: true });
  assert.match(at1, /animation-duration:0\.75s/); assert.match(at2, /animation-duration:0\.375s/);
});

test('level cards: no shields / run-length / question-type chips; only the boss card shows the boss clock', () => {
  const { ONA } = boot();
  for (const l of ONA.LEVELS) {
    const h = ONA.game.cardFlags(l);
    assert.doesNotMatch(h, /shields|questions \/ run|×\d/, 'world ' + l.id + ' card has a removed chip');
    for (const t of ['Choice', 'Multi-select', 'Calc', 'Sequence', 'Diagram', 'Scenario']) assert.ok(!h.includes(t), 'world ' + l.id + ' shows ' + t);
    if (l.boss) assert.match(h, /⏱ 15 min boss clock/); else assert.equal(h, '', 'world ' + l.id + ' has no chips');
  }
});

test('Databricks worlds are derived from the question bank: 4, 5 and the boss', () => {
  const { ONA } = boot();
  assert.deepEqual([...ONA.LEVELS.filter((l) => ONA.util.isDbxWorld(l)).map((l) => l.id)], [4, 5, 6]);
});

// ---------------------------------------------------------------- integration: migrations compose
test('migrations compose: a save from before music, ship and journeys loads with all three upgraded', () => {
  const old = { version: 1, created: 1, settings: { freeRoam: true, muted: true, motion: 'reduce' }, xp: 500, bestStreak: 2, shipAt: 2, sessions: [],
    levels: { 1: { bestStars: 3, bestScore: 0, bestAccuracy: 1, plays: 1 } }, questions: { 'l1-dns-a': { seen: 1, correct: 0, wrong: 1, totalMs: 900, last: 1, box: 1, due: 0 } } };
  const mem = new Map();
  const { store } = boot(JSON.stringify(old), mem);
  const st = store.state;
  assert.equal(st.settings.muted, true); assert.equal(st.settings.music, true); assert.equal(st.settings.motion, 'reduce');
  assert.deepEqual(plain(st.ship), { tier: 1, repairs: 0 }, '3 stars → Cutter, no fake upgrade');
  assert.deepEqual({ ...st.journeys }, {});
  assert.equal(st.questions['l1-dns-a'].earned, 0); assert.equal(st.questions['l1-dns-a'].possible, 1);
  store.completeJourney('dns', true);
  assert.equal(st.xp, 500 + store.JOURNEY_XP);
  assert.equal(store.claimShipUpgrade(), null, 'journey XP is not stars: no ship upgrade');
  store.save();
  const again = boot(undefined, mem).store.state;
  assert.equal(again.journeys.dns.done, 1); assert.deepEqual(plain(again.ship), { tier: 1, repairs: 0 }); assert.equal(again.settings.musicVol, 0.5);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}
console.log(`\n${tests.length - failed}/${tests.length} store unit tests passed`);
process.exit(failed ? 1 : 0);
