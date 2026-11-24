#!/usr/bin/env node
// Headless browser smoke test + screenshot capture.
// Usage: node tests/smoke_browser.mjs [--chrome /path/to/chrome] [--no-shots] [--mobile-only] [--mobile-audit]
//   --mobile-only   only the phone viewport pass (tests/mobile_checks.mjs) on a seeded save; --mobile-audit reports, never fails
// Opens index.html over file://, plays real missions through the keyboard, fails on any console error
// or uncaught exception, and saves screenshots to screenshots/.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mobilePass, mobileAudioPass } from './mobile_checks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const chromeArg = args.indexOf('--chrome');
const CHROME = chromeArg >= 0 ? args[chromeArg + 1] : [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(existsSync);
const SHOTS = !args.includes('--no-shots');
const onlyArg = args.indexOf('--shots-only');          // e.g. --shots-only 19,20  (prefix filter)
const ONLY = onlyArg >= 0 ? args[onlyArg + 1].split(',') : null;
const MOBILE_AUDIT = args.includes('--mobile-audit');
const MOBILE_ONLY = MOBILE_AUDIT || args.includes('--mobile-only');
let VW = 1440;
const PORT = 9300 + Math.floor(Math.random() * 500);
const shotDir = join(root, 'screenshots');
if (!CHROME) { console.error('No Chrome found; pass --chrome'); process.exit(2); }
if (SHOTS) ['', 'mobile', 'mobile-all'].forEach((d) => mkdirSync(join(shotDir, d), { recursive: true }));

const profile = mkdtempSync(join(tmpdir(), 'ona-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--window-size=1440,900', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
let ws, msgId = 0;
const pending = new Map();

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
          else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) problems.push('console.' + m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
          else if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
          else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
        };
        return;
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
  return r.result.value;
}
async function key(k, modifiers = 0) {   // modifiers: CDP bitmask (8 = Shift)
  const code = { Enter: 'Enter', Escape: 'Escape', ArrowRight: 'ArrowRight', ArrowLeft: 'ArrowLeft', Tab: 'Tab' }[k];
  const vk = { Enter: 13, Escape: 27, ArrowRight: 39, ArrowLeft: 37, Tab: 9 }[k] || k.toUpperCase().charCodeAt(0);
  const base = { key: k, code: code || (/\d/.test(k) ? 'Digit' + k : 'Key' + k.toUpperCase()), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: k.length === 1 ? k : k === 'Enter' ? '\r' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
async function shot(name) {
  if (!SHOTS || (ONLY && !ONLY.some((p) => name.startsWith(p)))) return;
  await sleep(400);
  const m = await send('Page.getLayoutMetrics');
  const vw = m.cssVisualViewport.clientWidth, vh = m.cssVisualViewport.clientHeight;
  const scale = Math.min(1, 1600 / Math.max(vw * 2, vh * 2));    // DPR 2 → cap the long edge at 1600px
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: vw, height: vh, scale } });
  writeFileSync(join(shotDir, name + '.jpg'), Buffer.from(r.data, 'base64'));
  console.log('  screenshot', 'screenshots/' + name + '.jpg');
}
async function viewport(w, h, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  await sleep(300);
}
async function waitFor(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expr)) return true; await sleep(80); }
  throw new Error('timeout waiting for: ' + expr);
}
async function clearDialogs() {
  for (let i = 0; i < 40 && (await evaluate('ONA.game.dialogOpen')); i++) { await key('Enter'); await sleep(60); }
}

// Answer the current question/part. correct=false picks a wrong answer on purpose.
async function answer(correct) {
  const info = await evaluate(`(() => {
    const r = ONA.game.run, q = r.queue[r.i], p = q.type === 'multipart' ? q.parts[r.part] : q;
    return { type: p.type, answer: p.answer, n: (p.choices || p.items || (p.diagram && p.diagram.nodes) || []).length,
      nodes: p.diagram ? p.diagram.nodes.map(n => n.id) : null };
  })()`);
  if (info.type === 'mc') {
    const k = correct ? info.answer : (info.answer + 1) % info.n;
    await key(String(k + 1));
  } else if (info.type === 'multi') {
    const pick = correct ? info.answer : [...Array(info.n).keys()].filter((k) => !info.answer.includes(k)).slice(0, 1);
    for (const k of (pick.length ? pick : [0])) { await key(String(k + 1)); await sleep(30); }
  } else if (info.type === 'numeric') {
    await evaluate(`document.getElementById('num-input').focus()`);
    await send('Input.insertText', { text: String(correct ? info.answer : info.answer + 1) });
  } else if (info.type === 'order') {
    if (correct) await evaluate(`(() => { const s = ONA.game.run.sel; s.sort((a, b) => a - b); })()`);
    else await evaluate(`(() => { const s = ONA.game.run.sel; if (s.every((v, i) => v === i)) s.reverse(); })()`);
  } else if (info.type === 'diagram') {
    const idx = info.nodes.indexOf(info.answer);
    await key(String((correct ? idx : (idx + 1) % info.nodes.length) + 1));
  }
  await sleep(60);
  await key('Enter');
  await waitFor('ONA.game.run && ONA.game.run.answered');
}

// Concept figure in the feedback panel: answer one question (wrong → panel open, right → collapsed),
// check the figure/text/a11y state and that Continue is still on screen, optionally screenshot, then finish.
async function conceptCheck(qid, fig, { correct = false, name = null } = {}) {
  await evaluate(`ONA.game.run = null; ONA.game.startRun(null, 'drill', [ONA.util.qById('${qid}')], 'Concept check'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(250);
  await answer(correct); await sleep(900);
  const st = await evaluate(`(() => {
    const d = document.querySelector('#feedback details.fb-concept'), b = document.getElementById('btn-next'), r = b && b.getBoundingClientRect();
    return { has: !!d, open: !!(d && d.open), fig: d && d.dataset.fig, svg: !!(d && d.querySelector('svg.cfig.cf-${fig}')),
      text: d ? d.querySelector('.fc-text').textContent.trim().length : 0, figHidden: d && d.querySelector('.fc-fig').getAttribute('aria-hidden'),
      svgHidden: d && d.querySelector('svg.cfig') && d.querySelector('svg.cfig').getAttribute('aria-hidden'),
      btnOnScreen: !!r && r.top >= 0 && r.bottom <= innerHeight + 1 };
  })()`);
  const where = `${qid} (${correct ? 'right' : 'wrong'} answer, ${await evaluate('innerWidth')}px)`;
  if (!st.has || st.fig !== fig || !st.svg) problems.push(`concept: ${where} should show the "${fig}" figure: ` + JSON.stringify(st));
  if (st.open !== !correct) problems.push(`concept: ${where} panel should be ${correct ? 'collapsed' : 'open'}`);
  if (st.text < 60) problems.push(`concept: ${where} concept text missing`);
  if (st.figHidden !== 'true' || st.svgHidden !== 'true') problems.push(`concept: ${where} figure must be aria-hidden`);
  if (!st.btnOnScreen) problems.push(`concept: ${where} Continue button pushed off-screen`);
  // integration: the mission ship panel coexists with the (expanded) figure + Learn button and never covers the card
  const sh = await evaluate(SHIP_STATE);
  if (!sh.ok || !sh.visible || sh.overlap) problems.push(`concept: ${where} ship panel missing or overlapping the question card: ` + JSON.stringify(sh));
  const learn = await evaluate(`(() => { const l = document.querySelector('#feedback .jr-learn'); if (!l) return null; const r = l.getBoundingClientRect(), s = document.getElementById('ship-panel').getBoundingClientRect();
    return { w: r.width, overShip: Math.max(0, Math.min(r.right, s.right) - Math.max(r.left, s.left)) * Math.max(0, Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top)) > 4 }; })()`);
  if (learn && (learn.w < 40 || learn.overShip)) problems.push(`concept: ${where} Learn button hidden or under the ship panel: ` + JSON.stringify(learn));
  if (name) await shot(name);
  await evaluate(`document.activeElement && document.activeElement.blur()`);
  await key('Enter'); await waitFor(`ONA.game.screen === 'debrief'`);
  return st;
}

async function playRun({ accuracy = 0.85, shotAt = null, maxQ = 99 } = {}) {
  let q = 0;
  while (q < maxQ) {
    await clearDialogs();
    const state = await evaluate(`(() => ({ screen: ONA.game.screen, run: !!ONA.game.run && !ONA.game.run.over, card: !!document.querySelector('#q-body') }))()`);
    if (state.screen !== 'mission' || !state.run) break;
    if (!state.card) { await sleep(120); continue; }
    if (shotAt && q === shotAt.q) await shot(shotAt.name + '-question');
    const good = Math.random() < accuracy || (shotAt && q === shotAt.q);
    await answer(good);
    if (shotAt && q === shotAt.q) { await sleep(500); await shot(shotAt.name + '-correct'); }
    await sleep(80);
    await evaluate(`document.activeElement && document.activeElement.blur()`);
    await key('Enter');
    await sleep(120);
    q++;
  }
  // A disabled ship plays its power-down before the dialog opens: keep clearing until the run leaves the mission screen.
  for (let t = 0; t < 120 && (await evaluate(`ONA.game.screen === 'mission' && !!ONA.game.run && ONA.game.run.over`)); t++) { await clearDialogs(); await sleep(100); }
  await clearDialogs();
}

// Meter the real output (after the limiter) for `ms`: peak must stay < 1.0 (no clipping), RMS > 0 (music audible).
const METER = (ms) => `new Promise((res) => {
  const c = ONA.audio.ctx, an = c.createAnalyser(); an.fftSize = 2048; ONA.audio.out.connect(an);
  const buf = new Float32Array(an.fftSize); let peak = 0, sum = 0, n = 0;
  const iv = setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; } }, 40);
  setTimeout(() => { clearInterval(iv); ONA.audio.out.disconnect(an); res({ peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(5) }); }, ${ms});
})`;
// Frame pacing of the page (the starfield draws every rAF) while music plays.
const FRAMES = (ms) => `new Promise((res) => {
  const d = []; let last = performance.now(); const end = last + ${ms};
  const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { d.sort((a, b) => a - b);
    res({ frames: d.length, mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) }); } };
  requestAnimationFrame(f);
})`;
const AUDIO_STATE = `(() => { const s = ONA.store.state.settings, a = ONA.audio, m = ONA.music.stats();
  return { ctx: !!a.ctx, state: a.ctx && a.ctx.state, playing: m.playing, mood: m.mood, want: m.want, music: s.music, muted: s.muted,
    musicGain: a.musicBus ? +a.musicBus.gain.value.toFixed(3) : null, masterGain: a.master ? +a.master.gain.value.toFixed(3) : null, stats: m }; })()`;
const audioLog = {};
// The mission ship: rendered, decorative, shield level, damaged modules, live text, and no overlap with the question.
const SHIP_STATE = `(() => { const s = document.querySelector('#ship-view svg.ship'), p = document.getElementById('ship-panel'), c = document.getElementById('q-card');
  if (!s) return { ok: false };
  const a = p.getBoundingClientRect(), b = c.getBoundingClientRect();
  const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { ok: true, hidden: p.getAttribute('aria-hidden'), visible: a.width > 100 && a.height > 50, shield: +s.style.getPropertyValue('--shield'),
    damaged: [...s.querySelectorAll('.mod.sev-2, .mod.sev-3')].map(m => m.dataset.mod), tier: [...s.classList].find(x => /^tier-/.test(x)),
    disabled: s.classList.contains('disabled'), live: document.getElementById('ship-live').textContent,
    liveOutsideApp: !document.getElementById('app').contains(document.getElementById('ship-live')), overlap: ox * oy > 4 }; })()`;
// Exact module ids shown in the Repair Bay by: the hangar ship's damage classes, the callouts, the list rows,
// and what the store says (ONA.ship.damagedModules). Re-renders the bay first.
const HANGAR_IDS = `(() => { ONA.game.run = null; ONA.game.show('log'); ONA.game.show('bay');
  const ids = (sel) => [...document.querySelectorAll(sel)].map((n) => n.getAttribute('data-mod')).sort();
  return { store: ONA.ship.damagedModules(ONA.store).map((m) => m.id).sort(),
    ship: [...document.querySelectorAll('#hangar svg.ship .mod')].filter((m) => /\\bsev-\\d\\b/.test(m.getAttribute('class'))).map((m) => m.dataset.mod).sort(),
    callouts: ids('#hangar .callout[data-mod]'), rows: ids('.mod-list li[data-mod]'),
    nominal: !!document.querySelector('#hangar .hg-nominal'), pristine: !!document.querySelector('#hangar svg.ship.pristine') }; })()`;
const hangarAgrees = (tag, h, expectIds) => {
  const want = JSON.stringify(expectIds || h.store);
  for (const k of ['store', 'ship', 'callouts', 'rows']) if (JSON.stringify(h[k]) !== want) return problems.push(tag + ': hangar ' + k + ' ids differ: ' + JSON.stringify(h));
  if (!h.store.length && !(h.nominal && h.pristine)) problems.push(tag + ': empty bay should show a pristine ship + "All modules nominal": ' + JSON.stringify(h));
};
// Start a level-1 mission and answer wrong until the hull is gone; the final Continue starts the power-down.
async function driveHullToZero() {
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.game.startRun(ONA.util.level(1), 'mission'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`);
  const max = await evaluate(`ONA.game.run.maxShields`);
  for (let k = 0; k < max; k++) {
    await answer(false); await sleep(150);
    await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter');
    if (k < max - 1) { await sleep(150); await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`); }
  }
  await waitFor(`document.getElementById('screen-mission').classList.contains('power-down')`, 3000);
}
const SEQ_STATE = `(() => ({ screen: ONA.game.screen, dialog: ONA.game.dialogOpen, powerDown: document.getElementById('screen-mission').classList.contains('power-down'),
  danger: ONA.starfield.isDanger(), seq: ONA.game.seqActive(), alarms: window.__alarms, run: ONA.game.run ? ONA.game.run.mode : null,
  debriefTitle: (document.querySelector('#screen-debrief .db-title') || {}).textContent || null }))()`;
// UI polish + branding screenshots (screenshots/polish/): title desktop + phone, the map's Databricks marks, a level
// card, the boss card, a mission with the Map button and the branded ship, a journey mid-autoplay with the speed control.
async function polishShot(name) {
  if (!SHOTS) return;
  await sleep(400);
  const m = await send('Page.getLayoutMetrics');
  const vw = m.cssVisualViewport.clientWidth, vh = m.cssVisualViewport.clientHeight;
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: vw, height: vh, scale: Math.min(1, 1600 / Math.max(vw * 2, vh * 2)) } });
  writeFileSync(join(shotDir, 'polish', name + '.jpg'), Buffer.from(r.data, 'base64'));
  console.log('  screenshot', 'screenshots/polish/' + name + '.jpg');
}
async function polishShots() {
  if (!SHOTS) return;
  mkdirSync(join(shotDir, 'polish'), { recursive: true });
  const fr = await evaluate(`ONA.store.state.settings.freeRoam`);
  await evaluate(`ONA.store.setting('freeRoam', true); true`);      // the default for new players: every world open
  await evaluate(`ONA.game.run = null; ONA.game.selected = 2; ONA.game.show('title'); ONA.game.show('map'); true`); await sleep(1200);
  await polishShot('03-level-card');
  await evaluate(`ONA.game.selected = 5; ONA.game.show('title'); ONA.game.show('map'); true`); await sleep(1200);
  await polishShot('02-galaxy-map-databricks-marks');
  await evaluate(`ONA.game.selected = 6; ONA.game.show('title'); ONA.game.show('map'); true`); await sleep(1200);
  await polishShot('04-boss-card');
  await evaluate(`ONA.game.show('title'); true`); await sleep(900);
  await polishShot('01-title-desktop');
  await viewport(390, 844, true); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await sleep(600);
  await polishShot('01-title-phone');
  await evaluate(`ONA.game.startRun(ONA.util.level(4), 'mission'); true`); await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(900);
  await polishShot('05-mission-map-button-phone');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await viewport(VW, 900); await sleep(900);
  await polishShot('05-mission-map-button-ship');
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.store.setting('journeySpeed', 1); ONA.journeys.open('dns', { src: 'library' }); true`);
  await sleep(await evaluate(`ONA.journeys.dwellMs(ONA.journeys.get('dns').steps[0], 1) + 900`));
  if (!(await evaluate(`ONA.journeys.state().auto && ONA.journeys.state().step === 1`))) problems.push('polish shot: journey should be mid-autoplay on step 2');
  await polishShot('06-journey-autoplay-speed');
  await key('Escape'); await sleep(200);
  await evaluate(`ONA.store.setting('freeRoam', ${fr}); true`);
  const foot = await evaluate(`(() => { const f = document.querySelector('.title-foot'); return { count: document.getElementById('title-count').textContent, heart: (f.querySelector('.dbx-heart') || {}).getAttribute && f.querySelector('.dbx-heart').getAttribute('aria-label'), made: f.querySelector('.made-with').textContent.replace(/\\s+/g, ' ').trim() }; })()`);
  if (foot.count !== '114 questions: Basic and Databricks networking' || foot.heart !== 'love' || foot.made !== 'Made with by Kriti Sen Sharma') problems.push('title footer wrong: ' + JSON.stringify(foot));
}

const shipProblems = (tag, st) => {
  if (!st.ok) return problems.push(tag + ': no ship rendered in the mission panel');
  if (st.hidden !== 'true') problems.push(tag + ': ship panel must be aria-hidden');
  if (!st.visible) problems.push(tag + ': ship panel not visible');
  if (st.overlap) problems.push(tag + ': ship panel overlaps the question card');
  if (!st.liveOutsideApp) problems.push(tag + ': #ship-live must sit outside #app (inert under dialogs)');
};

try {
  await connect();
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  // Keep the headless page focused + visible: a CDP-dispatched Escape can otherwise flip document.hidden,
  // which (correctly) suspends audio and throttles timers, and would make focus/timing checks flaky.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await viewport(1440, 900);
  const url = pathToFileURL(join(root, 'index.html')).href;
  await send('Page.navigate', { url });
  await waitFor(`!!(window.ONA && ONA.game && ONA.game.screen === 'title')`);
  // deterministic visuals for screenshots
  await evaluate(`localStorage.clear(); Math.random; true`);
  await send('Page.reload'); await waitFor(`!!(window.ONA && ONA.game && ONA.game.screen === 'title')`);
  console.log('Loaded', url);
  await sleep(900);
  const H = { send, evaluate, sleep, shot, waitFor, clearDialogs, answer, problems, key };
  if (MOBILE_ONLY) {
    // seed a little history so the Repair Bay, Captain's Log and debrief have content
    await evaluate(`ONA.store.setting('freeRoam', true); true`); await key('Enter'); await sleep(400);
    for (const [lvl, acc] of [[1, 0.7], [2, 0.6], [4, 0.75]]) {
      await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.game.startRun(ONA.util.level(${lvl}), 'mission'); true`);
      await playRun({ accuracy: acc }); await waitFor(`ONA.game.screen === 'debrief'`);
    }
    const rep = await mobilePass(H, { audit: MOBILE_AUDIT });
    if (MOBILE_AUDIT) {   // --no-shots skips the screenshot dirs: make sure this one exists
      mkdirSync(join(shotDir, 'mobile-all'), { recursive: true });
      writeFileSync(join(shotDir, 'mobile-all', 'metrics.json'), JSON.stringify(rep, null, 1));
    }
    console.log('Mobile pass:', Object.keys(rep).length, 'screen checks');
    if (!MOBILE_AUDIT) console.log('Mobile audio (taps, plus labelled keyboard-N checks):', JSON.stringify(await mobileAudioPass(H)));
  }
  full: {
  if (MOBILE_ONLY) break full;
  await shot('01-title');
  // Autoplay rules: no AudioContext may exist before the first user gesture.
  const preGesture = await evaluate(AUDIO_STATE);
  if (preGesture.ctx || preGesture.playing) problems.push('audio started before any user gesture: ' + JSON.stringify(preGesture));

  // Title → map (the Enter press is the first user gesture: it must create the AudioContext and start calm music)
  await key('Enter'); await waitFor(`ONA.game.screen === 'map'`); await sleep(1300);
  await shot('02-galaxy-map-fresh');
  const a1 = await evaluate(AUDIO_STATE);
  audioLog.afterGesture = { state: a1.state, playing: a1.playing, mood: a1.mood };
  if (!a1.ctx) problems.push('first gesture did not create an AudioContext');
  if (a1.state !== 'running') problems.push('AudioContext not running after the first gesture: ' + a1.state);
  if (!a1.playing || a1.mood !== 'calm') problems.push('galaxy map music should be playing "calm": ' + JSON.stringify(a1));
  const toastSeen = await evaluate(`[...document.querySelectorAll('.toast')].some(t => /Music on/.test(t.textContent))`);
  if (!toastSeen) problems.push('first-time "Music on" toast not shown');
  // Let the scheduler run, then meter the real output and frame pacing together
  const [meter, frames] = await Promise.all([evaluate(METER(3000)), evaluate(FRAMES(3000))]);
  audioLog.meterCalm = meter; audioLog.framesWithMusic = frames;
  if (!(meter.rms > 1e-4)) problems.push('music not audible at the output (rms ' + meter.rms + ')');
  if (!(meter.peak < 1)) problems.push('output clipped (peak ' + meter.peak + ')');
  const s1 = (await evaluate(AUDIO_STATE)).stats;
  if (!(s1.ticks > 10 && s1.notes > 0)) problems.push('music scheduler not scheduling notes: ' + JSON.stringify(s1));

  // N toggles music only; M mutes everything; both restore
  await key('n'); await sleep(500);
  const n1 = await evaluate(AUDIO_STATE);
  if (n1.music || n1.playing || n1.musicGain > 0.01) problems.push('N did not turn music off: ' + JSON.stringify(n1));
  if (n1.muted || n1.masterGain < 0.99) problems.push('N must not mute SFX: ' + JSON.stringify(n1));
  // A/B on the same screen: starfield frame pacing with music off vs. on (allow one frame of headless jitter)
  await sleep(3500);                                         // let the faded deck dispose
  audioLog.framesNoMusic = await evaluate(FRAMES(3000));
  if (frames.mean > audioLog.framesNoMusic.mean * 1.25 + 2 && frames.p95 > audioLog.framesNoMusic.p95 + 17)
    problems.push('starfield frame pacing degraded with music on: ' + JSON.stringify({ withMusic: frames, without: audioLog.framesNoMusic }));
  await key('n'); await sleep(500);
  const n2 = await evaluate(AUDIO_STATE);
  if (!n2.music || !n2.playing || n2.musicGain < 0.05 || n2.mood !== 'calm') problems.push('N did not turn music back on: ' + JSON.stringify(n2));
  await key('m'); await sleep(500);
  const m1 = await evaluate(AUDIO_STATE);
  if (!m1.muted || m1.playing || m1.masterGain > 0.01 || !m1.music) problems.push('M (mute all) wrong: ' + JSON.stringify(m1));
  await key('m'); await sleep(500);
  const m2 = await evaluate(AUDIO_STATE);
  if (m2.muted || !m2.playing || m2.masterGain < 0.99) problems.push('M did not restore sound: ' + JSON.stringify(m2));
  const persisted = await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('ona.progress.v1')).settings; return { music: s.music, sfx: s.sfx, muted: s.muted, musicVol: s.musicVol }; })()`);
  if (!persisted.music || persisted.muted || typeof persisted.musicVol !== 'number') problems.push('audio settings not persisted: ' + JSON.stringify(persisted));

  // Hidden tab: fade out + suspend; visible again: resume + music back
  await evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); true`);
  await sleep(900);
  const h1 = await evaluate(AUDIO_STATE);
  if (h1.state !== 'suspended' || h1.playing) problems.push('hidden tab should suspend audio + stop music: ' + JSON.stringify(h1));
  await evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); true`);
  await sleep(700);
  const h2 = await evaluate(AUDIO_STATE);
  if (h2.state !== 'running' || !h2.playing) problems.push('visible tab should resume audio + music: ' + JSON.stringify(h2));

  // Mission 1 with briefing dialog screenshot
  await key('Enter'); await waitFor('ONA.game.dialogOpen');
  const f1 = await evaluate(AUDIO_STATE);
  if (f1.mood !== 'focus') problems.push('mission music should be "focus": ' + JSON.stringify({ mood: f1.mood, want: f1.want }));
  await sleep(1600); await shot('03-briefing-dialog');
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(700);
  const healthy = await evaluate(SHIP_STATE);
  shipProblems('mission 1', healthy);
  if (healthy.shield !== 1 || healthy.damaged.length || healthy.tier !== 'tier-0') problems.push('fresh mission ship should be tier-0, full shield, undamaged: ' + JSON.stringify(healthy));
  await shot('22-ship-healthy');
  await playRun({ accuracy: 0.92, shotAt: { q: 1, name: '04-mission1' } });
  await waitFor(`ONA.game.screen === 'debrief'`); await sleep(2200);
  await shot('05-debrief');

  // Ship damage → disabled: every wrong answer damages the module for its topic; losing the last hull point
  // plays the power-down sequence BEFORE the dialog, then the debrief says "Ship disabled" with the wreck.
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.game.startRun(ONA.util.level(1), 'mission'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(500);
  const hits = [];
  for (let k = 0; k < 3; k++) {
    await answer(false); await sleep(450);
    const st = await evaluate(SHIP_STATE);
    hits.push({ shield: st.shield, damaged: st.damaged.length, live: st.live });
    if (k === 1) { await sleep(300); await shot('23-ship-damaged'); }
    if (k === 2) break;
    await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await sleep(250);
    await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`);
  }
  if (!(hits[0].damaged >= 1 && /^Hit: .+ damaged\. Hull 2 of 3\.$/.test(hits[0].live))) problems.push('first wrong answer should damage a module + announce it: ' + JSON.stringify(hits[0]));
  if (!(hits[0].shield < 1 && hits[1].shield < hits[0].shield && hits[2].shield === 0)) problems.push('shield bubble should drop with each hull point: ' + JSON.stringify(hits));
  await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter');
  await waitFor(`document.getElementById('screen-mission').classList.contains('power-down')`, 3000);
  const pd = await evaluate(`(() => ({ dialog: ONA.game.dialogOpen, disabled: document.querySelector('#ship-view svg.ship').classList.contains('disabled'), live: document.getElementById('ship-live').textContent }))()`);
  if (pd.dialog || !pd.disabled) problems.push('power-down must play before the dialog: ' + JSON.stringify(pd));
  await sleep(1300); await shot('24-ship-disabled');
  await waitFor('ONA.game.dialogOpen', 6000);
  const dlgTag = await evaluate(`document.getElementById('dlg-tag').textContent`);
  if (dlgTag !== 'Ship disabled') problems.push('disabled dialog tag wrong: ' + dlgTag);
  await clearDialogs(); await waitFor(`ONA.game.screen === 'debrief'`); await sleep(1200);
  const wreck = await evaluate(`(() => ({ title: document.querySelector('.db-title').textContent, wreck: !!document.querySelector('.db-wreck svg.ship.disabled'),
    sub: (document.querySelector('.db-sub') || {}).textContent || '', mods: document.querySelectorAll('.db-mods li').length }))()`);
  if (wreck.title !== 'Ship disabled' || !wreck.wreck || !/Hull integrity 0%/.test(wreck.sub) || wreck.mods < 1) problems.push('disabled debrief inconsistent: ' + JSON.stringify(wreck));
  await shot('25-debrief-disabled');

  // Abandoned power-down sequences must not take over the UI (no late alarm, dialog or debrief).
  await evaluate(`window.__alarms = 0; const a0 = ONA.sfx.alarm; ONA.sfx.alarm = function () { window.__alarms++; return a0.apply(this, arguments); };
    document.getElementById('screen-debrief').innerHTML = ''; true`);
  // (a) navigate to the map mid-sequence through the real UI: Esc → Pause → Abort to map
  await driveHullToZero(); await sleep(150);
  await key('Escape'); await waitFor('ONA.game.modalOpen');
  await evaluate(`document.querySelector('#modal-body [data-act="abort"]').click(); true`);
  await waitFor(`ONA.game.screen === 'map'`);
  const navA = await evaluate(SEQ_STATE);
  await sleep(3200);
  const lateA = await evaluate(SEQ_STATE);
  audioLog.abandonMap = { atNav: navA, after3s: lateA };
  if (lateA.screen !== 'map' || lateA.dialog || lateA.powerDown || lateA.danger || lateA.seq || lateA.alarms !== navA.alarms || lateA.debriefTitle)
    problems.push('abandoned sequence (map) took over the UI: ' + JSON.stringify({ navA, lateA }));
  // (b) start another run mid-sequence
  await evaluate(`document.getElementById('screen-debrief').innerHTML = ''; true`);
  await driveHullToZero(); await sleep(150);
  await evaluate(`ONA.game.startRun(ONA.util.level(2), 'drill'); true`);
  const navB = await evaluate(SEQ_STATE);
  await sleep(3200);
  const lateB = await evaluate(SEQ_STATE);
  const newRunOk = await evaluate(`!!document.querySelector('#q-body') && !document.querySelector('#ship-view svg.ship').classList.contains('disabled')`);
  audioLog.abandonRun = { atStart: navB, after3s: lateB };
  if (lateB.screen !== 'mission' || lateB.run !== 'drill' || lateB.dialog || lateB.powerDown || lateB.danger || lateB.seq || lateB.alarms !== navB.alarms || lateB.debriefTitle || !newRunOk)
    problems.push('abandoned sequence (new run) took over the UI: ' + JSON.stringify({ navB, lateB, newRunOk }));
  // (c) reduced motion: the full sequence still completes, every alarm fires before the dialog, none after
  await evaluate(`ONA.store.setting('motion', 'reduce'); window.__alarms = 0; true`);
  await driveHullToZero();
  await waitFor('ONA.game.dialogOpen', 4000);
  const atDialog = await evaluate(`window.__alarms`);
  await clearDialogs(); await waitFor(`ONA.game.screen === 'debrief'`); await sleep(1500);
  const afterRM = await evaluate(SEQ_STATE);
  if (atDialog !== 3 || afterRM.alarms !== 3 || afterRM.debriefTitle !== 'Ship disabled' || afterRM.seq) problems.push('reduced-motion power-down: alarms must all fire before the dialog: ' + JSON.stringify({ atDialog, afterRM }));
  await evaluate(`ONA.store.setting('motion', 'auto'); ONA.game.run = null; ONA.game.show('map'); true`);

  // On-screen Map button = the Esc key: pause menu (Resume keeps the run), Abort returns to the galaxy map,
  // and it cancels a power-down sequence in flight exactly like Esc → Abort does (a).
  await evaluate(`ONA.game.startRun(ONA.util.level(1), 'mission'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`);
  const mapBtn = await evaluate(`(() => { const b = document.getElementById('hud-map'), r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), name: b.getAttribute('aria-label'), w: r.width, h: r.height, tab: b.tabIndex, visible: !!b.offsetParent }; })()`);
  if (mapBtn.text !== 'Map' || !/galaxy map/i.test(mapBtn.name || '') || !mapBtn.visible || mapBtn.tab < 0 || mapBtn.h < 36) problems.push('mission Map button missing or unlabelled: ' + JSON.stringify(mapBtn));
  await evaluate(`document.getElementById('hud-map').click(); true`); await waitFor('ONA.game.modalOpen');
  const pausedVia = await evaluate(`(() => ({ title: document.querySelector('#modal-title').textContent, abort: !!document.querySelector('#modal-body [data-act="abort"]') }))()`);
  if (pausedVia.title !== 'Paused' || !pausedVia.abort) problems.push('Map button should open the same pause menu as Esc: ' + JSON.stringify(pausedVia));
  await evaluate(`document.querySelector('#modal-body [data-close]').click(); true`); await sleep(150);
  if (!(await evaluate(`ONA.game.screen === 'mission' && !!ONA.game.run && !ONA.game.modalOpen`))) problems.push('Resume after the Map button should keep the mission running');
  await evaluate(`document.getElementById('hud-map').focus(); true`); await key('Enter'); await waitFor('ONA.game.modalOpen');   // keyboard path
  await evaluate(`document.querySelector('#modal-body [data-act="abort"]').click(); true`);
  await waitFor(`ONA.game.screen === 'map'`);
  if (!(await evaluate(`ONA.game.run === null && !!document.querySelector('#galaxy')`))) problems.push('Map button → Abort should return to the galaxy map with no run');
  await evaluate(`document.getElementById('screen-debrief').innerHTML = ''; window.__alarms = 0; true`);
  await driveHullToZero(); await sleep(150);
  await evaluate(`document.getElementById('hud-map').click(); true`); await waitFor('ONA.game.modalOpen');
  await evaluate(`document.querySelector('#modal-body [data-act="abort"]').click(); true`);
  await waitFor(`ONA.game.screen === 'map'`);
  const navD = await evaluate(SEQ_STATE); await sleep(3200); const lateD = await evaluate(SEQ_STATE);
  if (lateD.screen !== 'map' || lateD.dialog || lateD.powerDown || lateD.danger || lateD.seq || lateD.alarms !== navD.alarms || lateD.debriefTitle)
    problems.push('Map button during the power-down should cancel it like Esc: ' + JSON.stringify({ navD, lateD }));
  console.log('Map button:', JSON.stringify({ ...mapBtn, powerDownCancelled: !lateD.seq && !lateD.powerDown }));
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); true`);

  // Seed more history: replay missions 1–3, a drill, and the boss (free roam) with varied accuracy.
  await evaluate(`ONA.store.setting('freeRoam', true); true`);
  const plays = [[1, 0.8], [2, 0.6], [2, 0.85], [3, 0.7], [4, 0.75], [5, 0.65]];
  for (const [lvl, acc] of plays) {
    await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.game.startRun(ONA.util.level(${lvl}), 'mission'); true`);
    await playRun({ accuracy: acc, shotAt: lvl === 2 && acc === 0.6 ? { q: 0, name: '06-cidr' } : lvl === 5 ? { q: 3, name: '07-asteroid' } : null });
    await waitFor(`ONA.game.screen === 'debrief'`);
  }
  // Boss: shoot one scenario question mid-run (multipart / diagram)
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.game.startRun(ONA.util.level(6), 'mission'); true`);
  const boss = await evaluate(AUDIO_STATE);
  if (boss.mood !== 'tension') problems.push('boss music should be "tension": ' + JSON.stringify({ mood: boss.mood, want: boss.want }));
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(700);
  await shot('08-boss-scenario');
  await playRun({ accuracy: 0.7, shotAt: { q: 3, name: '09-boss-diagram' } });
  await waitFor(`ONA.game.screen === 'debrief'`);

  // Ensure each question type renders + grades in isolation (diagram, order, numeric, multi, mc, multipart)
  const typeCheck = await evaluate(`(() => {
    const types = {}; ONA.QUESTIONS.forEach(q => { types[q.type] = types[q.type] || q; });
    return Object.keys(types).map(t => types[t].id);
  })()`);
  for (const id of typeCheck) {
    await evaluate(`ONA.game.run = null; ONA.game.startRun(null, 'drill', [ONA.util.qById('${id}')], 'type check'); true`);
    await playRun({ accuracy: 1 });
    await waitFor(`ONA.game.screen === 'debrief'`);
  }
  // Order question screenshot (drag list)
  await evaluate(`ONA.game.run = null; ONA.game.startRun(null, 'drill', [ONA.util.qById('l3-tls-order')], 'Sequence'); true`);
  await waitFor(`!!document.querySelector('.order-list')`); await sleep(700);
  await shot('10-order-question');
  await playRun({ accuracy: 0 });

  // Concept figures: render every figure once (library samples + every question / step mapping) in the live page.
  const figCheck = await evaluate(`(() => {
    const X = ONA.explainers, host = document.createElement('div'), bad = [];
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px'; document.body.appendChild(host);
    const items = Object.keys(X.FIGURES).map((f) => [f, X.FIGURES[f].sample, 'sample ' + f]);
    ONA.QUESTIONS.forEach((q) => { items.push([q.fig, q.figParams, q.id]); (q.figParts || []).forEach((o, i) => { const s = X.spec(q, i); items.push([s.fig, s.params, q.id + ' step ' + (i + 1)]); }); });
    let n = 0;
    for (const [f, p, where] of items) {
      try {
        const out = X.render(f, p);
        const doc = new DOMParser().parseFromString(out.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml');
        if (doc.querySelector('parsererror')) { bad.push(where + ': malformed SVG'); continue; }
        host.innerHTML = out;
        const svg = host.querySelector('svg.cfig'), bb = svg && svg.getBBox();
        if (!svg || svg.getAttribute('aria-hidden') !== 'true' || !(bb.width > 100 && bb.height > 60)) bad.push(where + ': empty or not aria-hidden');
        n++;
      } catch (e) { bad.push(where + ': ' + e.message); }
    }
    host.remove();
    return { rendered: n, figures: Object.keys(X.FIGURES).length, questions: ONA.QUESTIONS.filter((q) => q.fig).length, bad };
  })()`);
  console.log('Concept figures rendered:', JSON.stringify({ rendered: figCheck.rendered, figures: figCheck.figures, questions: figCheck.questions }));
  if (figCheck.bad.length) problems.push('concept figures failed: ' + figCheck.bad.join(' | '));
  // Wrong answer on the TCP/IP question opens the layer-stack figure; plus the screenshots for the README.
  await conceptCheck('l1-tcpip-layers', 'layers', { name: '34-concept-tcpip-layers' });
  await conceptCheck('l1-dns-a', 'dns-records', { name: '35-concept-dns-records' });
  await conceptCheck('l2-aws-26', 'cidr', { name: '36-concept-cidr' });
  await conceptCheck('l5-aws-be-endpoints', 'private-link', { name: '37-concept-private-link' });
  await conceptCheck('l5-ncc-what', 'ncc', { name: '38-concept-ncc' });
  await conceptCheck('l5-policy-implicit', 'egress-policy', { name: '39-concept-network-policy' });
  await conceptCheck('l1-dns-a', 'dns-records', { correct: true, name: '40-concept-correct-collapsed' });
  // Boss multipart: a step override (l6-azure-500 step 3 switches to the carve figure)
  await evaluate(`ONA.game.run = null; ONA.game.startRun(null, 'drill', [ONA.util.qById('l6-azure-500')], 'Steps'); true`);
  for (let s = 0; s < 3; s++) {
    await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`); await answer(false); await sleep(200);
    const f = await evaluate(`(document.querySelector('#feedback details.fb-concept[open]') || {}).dataset?.fig || null`);
    const want = s === 2 ? 'carve' : 'cidr';
    if (f !== want) problems.push(`concept: l6-azure-500 step ${s + 1} should show ${want}, got ${f}`);
    await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await sleep(250);
  }
  await waitFor(`ONA.game.screen === 'debrief'`);

  // ---------------------------------------------------------------- holo-sim journeys
  const JST = `ONA.journeys.state()`;
  // Open and step through every journey with the keyboard; each step must draw a scene; Esc closes.
  const jIds = await evaluate(`ONA.journeys.list().map((j) => j.id)`);
  for (const id of jIds) {
    await evaluate(`ONA.journeys.open('${id}', { src: 'library' }); true`); await sleep(120);
    const n = await evaluate(`ONA.journeys.get('${id}').steps.length`);
    const open = await evaluate(`(() => ({ dots: document.querySelectorAll('#jr-dots .jr-dot').length, inert: document.getElementById('app').hasAttribute('inert'), flag: ONA.game.journeyOpen }))()`);
    if (open.dots !== n + 1 || !open.inert || open.flag !== true) problems.push(`journey ${id}: open state wrong ` + JSON.stringify(open));
    for (let s = 0; s < n; s++) {
      const st = await evaluate(`(() => ({ step: ${JST}.step, scene: !!document.querySelector('#jr-stage svg.jr-scene, #jr-stage .jr-figure svg'), packet: document.querySelectorAll('#jr-packet dd').length, narr: document.getElementById('jr-narr').textContent.length }))()`);
      if (st.step !== s || !st.scene || !st.packet || st.narr < 40) { problems.push(`journey ${id} step ${s + 1}: ` + JSON.stringify(st)); break; }
      await key('ArrowRight'); await sleep(90);
    }
    const chk = await evaluate(`(() => ({ step: ${JST}.step, choices: document.querySelectorAll('#jr-check .jr-choice').length }))()`);
    if (chk.step !== n || chk.choices < 3) problems.push(`journey ${id}: check question not shown ` + JSON.stringify(chk));
    await key('Escape'); await sleep(120);
    const closed = await evaluate(`(() => ({ open: ${JST}.open, inert: document.getElementById('app').hasAttribute('inert'), flag: ONA.game.journeyOpen }))()`);
    if (closed.open || closed.inert || closed.flag) problems.push(`journey ${id}: did not close cleanly ` + JSON.stringify(closed));
  }
  console.log('Journeys stepped through:', jIds.length);

  // Autoplay is on when a journey opens (off under reduced motion), the speed button cycles 1× → 1.5× → 2× and
  // persists, and the scene ship is the shared ship art with the Databricks mark.
  await evaluate(`ONA.store.setting('journeySpeed', 1); ONA.journeys.open('dns', { src: 'library' }); true`); await sleep(150);
  const jAuto = await evaluate(`(() => { const b = document.getElementById('jr-speed'), r = b.getBoundingClientRect();
    return { auto: ${JST}.auto, autoBtn: document.getElementById('jr-auto').getAttribute('aria-pressed'), speed: ${JST}.speed, label: b.textContent, name: b.getAttribute('aria-label'), w: r.width, h: r.height,
      ship: !!document.querySelector('#jr-stage .jb-ship svg.ship .dbx-mark'), legacy: !!document.querySelector('#jr-stage .jb-ship .ship-art') }; })()`);
  if (!jAuto.auto || jAuto.autoBtn !== 'true') problems.push('journey autoplay should be on when a journey opens: ' + JSON.stringify(jAuto));
  if (jAuto.speed !== 1 || jAuto.label !== '1×' || !/speed/i.test(jAuto.name || '')) problems.push('journey speed control wrong at open: ' + JSON.stringify(jAuto));
  if (!jAuto.ship || jAuto.legacy) problems.push('journey ship should be the shared ship art with the Databricks mark: ' + JSON.stringify(jAuto));
  const stepAt0 = await evaluate(`${JST}.step`);
  await sleep(await evaluate(`ONA.journeys.dwellMs(ONA.journeys.get('dns').steps[0], 1) + 500`));
  const stepAfter = await evaluate(`${JST}.step`);
  if (stepAfter !== stepAt0 + 1) problems.push(`journey autoplay should advance one step after the 1× dwell: ${stepAt0} → ${stepAfter}`);
  const speeds = [];
  for (let c = 0; c < 3; c++) { await evaluate(`document.getElementById('jr-speed').click(); true`); await sleep(60); speeds.push(await evaluate(`[document.getElementById('jr-speed').textContent, ONA.store.state.settings.journeySpeed, ${JST}.auto]`)); }
  if (JSON.stringify(speeds.map((x) => x.slice(0, 2))) !== JSON.stringify([['1.5×', 1.5], ['2×', 2], ['1×', 1]]) || !speeds.every((x) => x[2])) problems.push('journey speed button should cycle 1.5× → 2× → 1× and keep autoplay running: ' + JSON.stringify(speeds));
  await evaluate(`document.getElementById('jr-speed').click(); true`); await key('Escape'); await sleep(120);
  await evaluate(`ONA.journeys.open('tcp', { src: 'library' }); true`); await sleep(120);
  const kept = await evaluate(`[document.getElementById('jr-speed').textContent, ${JST}.speed]`);
  if (kept[0] !== '1.5×' || kept[1] !== 1.5) problems.push('journey speed should persist to the next journey: ' + JSON.stringify(kept));
  const legOn = await evaluate(`(() => { const t = document.querySelector('#jr-stage .jr-trail'); return t ? t.style.animationDuration : 'none'; })()`);
  await key('Escape'); await sleep(120);
  await evaluate(`ONA.store.setting('motion', 'reduce'); ONA.journeys.open('dns', { src: 'library' }); true`); await sleep(120);
  const rmAuto = await evaluate(`${JST}.auto`);
  if (rmAuto) problems.push('journey autoplay should start paused under reduced motion');
  await key('Escape'); await sleep(120);
  await evaluate(`ONA.store.setting('motion', 'auto'); ONA.store.setting('journeySpeed', 1); true`);
  console.log('Journey autoplay:', JSON.stringify({ openAuto: jAuto.auto, reducedMotionAuto: rmAuto, speeds: speeds.map((x) => x[0]), persisted: kept[0], trailAt1_5x: legOn }));

  // DNS journey end to end, launched from the order question ("Watch the journey first"), then the question itself.
  const xpBefore = await evaluate(`ONA.store.state.xp`);
  await evaluate(`ONA.game.run = null; ONA.game.startRun(null, 'drill', [ONA.util.qById('l1-dns-path')], 'Journey'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-card [data-journey-open="dns"][data-src="hint"]')`);
  await evaluate(`document.querySelector('#q-card [data-journey-open="dns"]').click(); true`); await sleep(200);
  if (!(await evaluate(`${JST}.open && ${JST}.id === 'dns'`))) problems.push('DNS journey did not open from the order question');
  await evaluate(`document.getElementById('jr-next').click(); true`); await sleep(100);            // Next button
  await key('ArrowRight'); await sleep(2600);                                                        // keyboard; let the packet land
  await evaluate(`document.querySelector('#jr-stage .jn[data-node="res"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`); await sleep(250);
  const tip = await evaluate(`(() => { const t = document.getElementById('jr-tip'); return { shown: !t.hidden, text: t.textContent, sel: ${JST}.sel, step: ${JST}.step }; })()`);
  if (!tip.shown || !/Recursive resolver/.test(tip.text) || tip.sel !== 'res' || tip.step !== 2) problems.push('DNS journey node tooltip wrong: ' + JSON.stringify(tip));
  await shot('42-journey-dns-step3');
  await evaluate(`document.activeElement && document.activeElement.blur(); true`);   // Space on a focused button presses it; off a button it toggles autoplay
  await key(' '); await sleep(100);
  const autoOn = await evaluate(`${JST}.auto`);
  await key('p'); await sleep(100);
  const autoOff = await evaluate(`${JST}.auto`);
  if (!autoOn || autoOff) problems.push(`DNS journey autoplay toggle wrong: on=${autoOn} off=${autoOff}`);
  await key('r'); await sleep(100);
  if ((await evaluate(`${JST}.step`)) !== 2) problems.push('Replay should stay on the same step');
  await key('ArrowLeft'); await sleep(80);
  if ((await evaluate(`${JST}.step`)) !== 1) problems.push('ArrowLeft should go back a step');
  for (let s = 0; s < 6; s++) { await key('ArrowRight'); await sleep(80); }
  const atCheck = await evaluate(`(() => ({ step: ${JST}.step, n: ONA.journeys.get('dns').steps.length, nextDisabled: document.getElementById('jr-next').disabled }))()`);
  if (atCheck.step !== atCheck.n || !atCheck.nextDisabled) problems.push('DNS journey check state wrong: ' + JSON.stringify(atCheck));
  await key('1'); await sleep(200);                                                                  // wrong on purpose
  const wrong = await evaluate(`(() => ({ solved: ${JST}.solved, verdict: (document.querySelector('#jr-result .jr-verdict') || {}).textContent, done: (ONA.store.state.journeys.dns || {}).done || 0 }))()`);
  if (wrong.solved || !/Not quite/.test(wrong.verdict || '') || wrong.done) problems.push('DNS check wrong answer handling: ' + JSON.stringify(wrong));
  await key('2'); await sleep(300);                                                                  // correct
  const rec = await evaluate(`(() => ({ solved: ${JST}.solved, rec: ONA.store.state.journeys.dns, xp: ONA.store.state.xp, reward: (document.querySelector('#jr-result .jr-xp') || {}).textContent }))()`);
  if (!rec.solved || !rec.rec || rec.rec.done !== 1 || rec.rec.firstTry !== false || rec.rec.hints !== 1 || rec.xp !== xpBefore + 40 || rec.reward !== '+40 XP')
    problems.push('DNS journey completion not recorded: ' + JSON.stringify({ ...rec, xpBefore }));
  await key('Enter'); await sleep(250);                                                              // focus is on Finish
  const back = await evaluate(`(() => ({ open: ${JST}.open, answered: ONA.game.run && ONA.game.run.answered, inQ: !!document.querySelector('#q-body') }))()`);
  if (back.open || back.answered !== false || !back.inQ) problems.push('closing the journey should return to the unanswered question: ' + JSON.stringify(back));
  await answer(true); await sleep(400);
  if (!(await evaluate(`!!document.querySelector('#feedback [data-journey-open="dns"][data-src="feedback"]')`))) problems.push('feedback panel has no "Learn: DNS resolution" button');
  await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await waitFor(`ONA.game.screen === 'debrief'`);

  // Integration: a journey opened mid-mission lowers the music onto the calm bed, never damages the ship
  // (even a wrong check answer), and hands back the boss/mission state untouched.
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.game.startRun(ONA.util.level(6), 'mission'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`); await sleep(400);
  const preJ = await evaluate(`(() => ({ shields: ONA.game.run.shields, time: ONA.game.run.timeLeft, ship: ${SHIP_STATE}, audio: ${AUDIO_STATE} }))()`);
  await evaluate(`ONA.journeys.open('dns', { src: 'library' }); true`); await sleep(900);
  const inJ = await evaluate(AUDIO_STATE);
  const lowered = await evaluate(`ONA.audio.levels(ONA.store.state.settings, { journey: true }).music`);
  if (inJ.want !== 'calm' || (inJ.musicGain !== null && Math.abs(inJ.musicGain - lowered) > 0.02)) problems.push('journey should put the music on a lowered calm bed: ' + JSON.stringify({ want: inJ.want, gain: inJ.musicGain, lowered }));
  const nSteps = await evaluate(`ONA.journeys.get('dns').steps.length`);
  for (let s = 0; s < nSteps; s++) { await key('ArrowRight'); await sleep(60); }
  await key('1'); await sleep(300);                                                       // wrong check answer
  const tIn = await evaluate(`ONA.game.run.timeLeft`);
  await sleep(1500);                                                                       // clock would tick here if not frozen
  const tOut = await evaluate(`ONA.game.run.timeLeft`);
  if (typeof tIn === 'number' && tIn - tOut > 0) problems.push('boss clock ran while a journey was open: ' + JSON.stringify({ tIn, tOut }));
  await key('Escape'); await sleep(900);
  const postJ = await evaluate(`(() => ({ shields: ONA.game.run.shields, time: ONA.game.run.timeLeft, answered: ONA.game.run.answered, ship: ${SHIP_STATE}, audio: ${AUDIO_STATE} }))()`);
  if (postJ.shields !== preJ.shields || JSON.stringify(postJ.ship.damaged) !== JSON.stringify(preJ.ship.damaged) || postJ.ship.disabled || postJ.answered)
    problems.push('a journey must not damage the ship or answer the question: ' + JSON.stringify({ pre: preJ.shields, post: postJ.shields, preD: preJ.ship.damaged, postD: postJ.ship.damaged, answered: postJ.answered }));
  if (postJ.audio.want !== 'tension' || (postJ.audio.musicGain !== null && Math.abs(postJ.audio.musicGain - preJ.audio.musicGain) > 0.02)) problems.push('closing the journey should restore boss music: ' + JSON.stringify({ pre: preJ.audio, post: postJ.audio }));
  audioLog.journey = { inJourney: { want: inJ.want, gain: inJ.musicGain }, after: { want: postJ.audio.want, gain: postJ.audio.musicGain } };
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); true`); await sleep(300);
  // Private Link journey screenshot (step 3), the library, and the Captain's Log card
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.journeys.open('privatelink'); true`); await sleep(150);
  await key('ArrowRight'); await sleep(80); await key('ArrowRight'); await sleep(2200);
  await shot('43-journey-privatelink');
  await key('Escape'); await sleep(150);
  await evaluate(`ONA.game.show('journeys'); true`); await sleep(700);
  const lib = await evaluate(`(() => ({ cards: document.querySelectorAll('#screen-journeys .jl-card').length, worlds: document.querySelectorAll('#screen-journeys .jl-world').length, done: document.querySelectorAll('#screen-journeys .jl-card.done').length }))()`);
  if (lib.cards !== jIds.length || lib.worlds < 4 || lib.done !== 1) problems.push('journeys library wrong: ' + JSON.stringify(lib));
  await shot('44-journeys-library');
  await evaluate(`document.querySelector('#screen-journeys [data-journey-open="tcp"]').click(); true`); await sleep(150);
  if ((await evaluate(`${JST}.id`)) !== 'tcp') problems.push('library Launch button did not open the TCP journey');
  await key('Escape'); await sleep(150);
  await evaluate(`ONA.game.show('log'); true`); await sleep(600);
  const logCard = await evaluate(`(() => { const c = document.querySelector('#screen-log .journeys-card'); return c ? c.querySelector('.card-title').textContent : null; })()`);
  if (!logCard || !/1 \/ 10 completed/.test(logCard)) problems.push("Captain's Log journeys card wrong: " + logCard);

  // Map after progress, Repair Bay, Captain's Log
  await evaluate(`ONA.store.setting('freeRoam', false); ONA.game.run = null; ONA.game.selected = 4; ONA.game.show('map'); true`);
  await sleep(1500); await shot('11-galaxy-map-progress');
  await polishShots();
  await evaluate(`ONA.store.setting('freeRoam', false); ONA.game.run = null; ONA.game.selected = 4; ONA.game.show('map'); true`); await sleep(600);
  await evaluate(`ONA.game.show('bay'); true`); await sleep(900); await shot('12-repair-bay');
  // Repair Bay = hangar: one damaged module on the docked ship (and one callout + list row) per module in the bay
  const bayShip = await evaluate(`(() => { const want = ONA.ship.damagedModules(ONA.store); const svg = document.querySelector('#hangar svg.ship');
    return { want: want.map(m => m.id + ':' + m.sev).sort(), shown: svg ? [...svg.querySelectorAll('.mod')].filter(m => /sev-\\d/.test(m.getAttribute('class'))).map(m => m.dataset.mod + ':' + m.getAttribute('class').match(/sev-(\\d)/)[1]).sort() : null,
      callouts: document.querySelectorAll('#hangar .callout').length, rows: document.querySelectorAll('.mod-list li').length, labels: [...document.querySelectorAll('#hangar .co-label')].map(t => t.textContent) }; })()`);
  if (!bayShip.want.length) problems.push('expected damaged modules in the Repair Bay after missed questions');
  if (JSON.stringify(bayShip.shown) !== JSON.stringify(bayShip.want)) problems.push('hangar ship damage does not match the bay: ' + JSON.stringify({ want: bayShip.want, shown: bayShip.shown }));
  if (bayShip.callouts !== bayShip.want.length || bayShip.rows !== bayShip.want.length) problems.push('hangar callouts/list do not match damaged modules: ' + JSON.stringify(bayShip));
  audioLog.hangar = { modules: bayShip.want.length, labels: bayShip.labels };
  await evaluate(`ONA.game.show('log'); true`); await sleep(1200); await shot('13-captains-log');
  await evaluate(`document.getElementById('screen-log').scrollTop = 700; true`); await sleep(400); await shot('14-captains-log-lower');

  // Repair run works
  await evaluate(`ONA.game.show('bay'); true`); await sleep(300);
  const due = await evaluate(`ONA.store.bay().due.length`);
  if (due > 0) {
    await evaluate(`document.getElementById('bay-start').click(); true`);
    await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await sleep(400);
    const before = await evaluate(SHIP_STATE);
    shipProblems('repair run', before);
    await answer(true); await sleep(300);
    const weld = await evaluate(`(() => ({ on: !!document.querySelector('#ship-view .weld-fx.on'), live: document.getElementById('ship-live').textContent }))()`);
    if (!weld.on || !/^Welding the /.test(weld.live)) problems.push('a correct repair-run answer should weld its module: ' + JSON.stringify(weld));
    // the concept block also shows in Repair Bay runs (collapsed after a hit), next to the welding ship
    const bayConcept = await evaluate(`(() => { const d = document.querySelector('#feedback details.fb-concept'); return { mode: ONA.game.run.mode, has: !!d, open: !!(d && d.open) }; })()`);
    if (bayConcept.mode !== 'repair' || !bayConcept.has || bayConcept.open) problems.push('Repair Bay feedback should show a collapsed concept block: ' + JSON.stringify(bayConcept));
    await shot('26-repair-weld');
    await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await sleep(300);
    await playRun({ accuracy: 1, maxQ: 2 });
  }

  // Export JSON round-trip + import
  const roundtrip = await evaluate(`(() => { const s = ONA.store.exportJSON(); ONA.store.importJSON(s); return JSON.parse(s).sessions.length; })()`);
  if (!(roundtrip > 0)) problems.push('export/import round-trip produced no sessions');

  // Progression: enough stars for the top tier → upgraded ship everywhere (hangar, map, mission), decals per world
  await evaluate(`ONA.LEVELS.forEach(l => { ONA.store.levelRec(l.id).bestStars = l.bonus ? 2 : 3; }); ONA.store.save(); ONA.game.run = null; ONA.game.show('map'); ONA.game.show('bay'); true`);
  await sleep(900); await shot('27-ship-upgraded-hangar');
  const upg = await evaluate(`(() => ({ hangar: !!document.querySelector('#hangar svg.ship.tier-4'), decals: document.querySelectorAll('#hangar svg.ship .decal').length,
    chips: document.querySelectorAll('.decal-chip.on').length, maxed: !!document.querySelector('.hc-next.max') }))()`);
  if (!upg.hangar || upg.decals !== 6 || upg.chips !== 6 || !upg.maxed) problems.push('upgraded hangar wrong (want tier-4, 6 world decals): ' + JSON.stringify(upg));
  await evaluate(`ONA.game.show('map'); true`); await sleep(1200);
  if (!(await evaluate(`!!document.querySelector('#map-ship svg.ship.tier-4')`))) problems.push('galaxy map ship does not show the upgraded tier');
  await shot('28-map-upgraded-ship');
  await evaluate(`ONA.game.startRun(ONA.util.level(6), 'drill'); true`);
  await waitFor(`!!document.querySelector('#q-body')`);
  if ((await evaluate(SHIP_STATE)).tier !== 'tier-4') problems.push('mission ship does not show the upgraded tier');
  for (let k = 0; k < 3; k++) {                                  // build a streak: afterburner
    await answer(true); await sleep(250);
    if (k < 2) { await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await sleep(250); await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`); }
  }
  await sleep(400);
  if (!(await evaluate(`document.querySelector('#ship-view svg.ship').classList.contains('afterburner')`))) problems.push('a 3-answer streak should light the afterburner');
  await shot('29-ship-afterburner');

  // iPad landscape + portrait
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); true`);
  await viewport(1180, 820); await sleep(900); await shot('15-ipad-landscape-map');
  await evaluate(`ONA.game.startRun(ONA.util.level(4), 'drill'); true`);
  await waitFor(`!!document.querySelector('#q-body')`); await answer(true); await sleep(700);
  await shot('16-ipad-landscape-feedback');
  shipProblems('iPad landscape', await evaluate(SHIP_STATE));
  await viewport(820, 1180, true); await sleep(700); await shot('17-ipad-portrait-feedback');
  shipProblems('iPad portrait', await evaluate(SHIP_STATE));
  await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await sleep(300);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body') && !ONA.game.run.answered`);
  await answer(false); await sleep(600);
  await evaluate(`document.getElementById('screen-mission').querySelector('.play').scrollTop = 0; true`);
  await shot('30-ipad-portrait-ship-hit');
  await evaluate(`ONA.game.run = null; ONA.game.show('bay'); true`); await sleep(900); await shot('31-ipad-portrait-hangar');
  await conceptCheck('l1-tcpip-layers', 'layers', { name: '41-ipad-portrait-concept' });
  await viewport(1180, 820); await sleep(300);
  await conceptCheck('l5-aws-be-endpoints', 'private-link');                       // iPad landscape: Continue still reachable
  await viewport(820, 1180, true); await sleep(300);
  // iPad portrait journey: stacked layout, controls reachable
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.journeys.open('dns'); true`); await sleep(150);
  await key('ArrowRight'); await sleep(80); await key('ArrowRight'); await sleep(2200);
  const ipadJ = await evaluate(`(() => { const r = document.getElementById('jr-next').getBoundingClientRect(), s = document.getElementById('jr-stage').getBoundingClientRect();
    return { next: r.bottom <= innerHeight + 1 && r.top >= 0, stageW: Math.round(s.width), vw: innerWidth }; })()`);
  if (!ipadJ.next || ipadJ.stageW < ipadJ.vw * 0.8) problems.push('iPad portrait journey layout wrong: ' + JSON.stringify(ipadJ));
  await shot('45-ipad-portrait-journey');
  await key('Escape'); await sleep(150);
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); true`); await sleep(900); await shot('18-ipad-portrait-map');

  // Modal a11y: labelled, background inert, Tab trapped, Esc closes, focus restored
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); true`); await sleep(600);
  await evaluate(`document.querySelector('#topbar .settings-btn').focus(); document.querySelector('#topbar .settings-btn').click(); true`);
  await waitFor('ONA.game.modalOpen'); await sleep(100);
  // Settings: music volume slider drives the music bus live and persists on release
  const vol = await evaluate(`new Promise((res) => {
    const r = document.getElementById('set-music-vol');
    r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => res({ setting: ONA.store.state.settings.musicVol, label: document.getElementById('set-music-vol-out').textContent,
      gain: +ONA.audio.musicBus.gain.value.toFixed(3), expect: ONA.audio.levels(ONA.store.state.settings).music,
      saved: JSON.parse(localStorage.getItem('ona.progress.v1')).settings.musicVol, sfxSwitch: !!document.getElementById('set-sfx') }), 600);
  })`);
  if (vol.setting !== 0.2 || vol.label !== '20%' || Math.abs(vol.gain - vol.expect) > 0.01 || vol.saved !== 0.2 || !vol.sfxSwitch) problems.push('music volume slider wrong: ' + JSON.stringify(vol));
  await evaluate(`const r = document.getElementById('set-music-vol'); r.value = 50; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); true`);
  await shot('21-settings-audio');
  const a11y = await evaluate(`(() => ({
    labelled: !!document.getElementById(document.getElementById('modal').getAttribute('aria-labelledby')),
    appInert: document.getElementById('app').hasAttribute('inert') && document.getElementById('topbar').hasAttribute('inert'),
    modalLive: !document.getElementById('modal').hasAttribute('inert') }))()`);
  if (!a11y.labelled || !a11y.appInert || !a11y.modalLive) problems.push('modal a11y state wrong: ' + JSON.stringify(a11y));
  for (let i = 0; i < 12; i++) {
    await key('Tab');
    const inside = await evaluate(`document.getElementById('modal').contains(document.activeElement)`);
    if (!inside) { problems.push('Tab escaped the open modal on press ' + (i + 1)); break; }
  }
  // Shift+Tab from the first focusable wraps to the last (reverse wrap)
  const FOC = `[...document.querySelectorAll('#modal button:not([disabled]), #modal [href], #modal input:not([disabled]), #modal [tabindex]:not([tabindex="-1"])')].filter(n => n.offsetParent !== null)`;
  await evaluate(`${FOC}[0].focus(); true`);
  await key('Tab', 8);
  const wrapped = await evaluate(`(() => { const f = ${FOC}; return document.activeElement === f[f.length - 1]; })()`);
  if (!wrapped) problems.push('Shift+Tab from the first modal control did not wrap to the last');
  await key('Tab'); // forward from last wraps to first
  const fwd = await evaluate(`(() => { const f = ${FOC}; return document.activeElement === f[0]; })()`);
  if (!fwd) problems.push('Tab from the last modal control did not wrap to the first');

  // A commander dialog stacked on top of the open modal: modal becomes inert, dialog traps focus,
  // closing the dialog hands focus back into the (re-activated) modal.
  await evaluate(`window.__stackDone = false; ONA.game.dialog([{ who: 'vega', text: 'Stacked test.' }], { done: 'OK' }).then(() => { window.__stackDone = true; }); true`);
  await waitFor('ONA.game.dialogOpen'); await sleep(150);
  const stacked = await evaluate(`(() => ({ modalInert: document.getElementById('modal').hasAttribute('inert'),
    dialogLive: !document.getElementById('dialog').hasAttribute('inert'), appInert: document.getElementById('app').hasAttribute('inert'),
    focusInDialog: document.getElementById('dialog').contains(document.activeElement) }))()`);
  if (!stacked.modalInert || !stacked.dialogLive || !stacked.appInert || !stacked.focusInDialog) problems.push('stacked dialog state wrong: ' + JSON.stringify(stacked));
  for (const mods of [0, 8, 8, 0, 0]) {
    await key('Tab', mods);
    if (!(await evaluate(`document.getElementById('dialog').contains(document.activeElement)`))) { problems.push('Tab escaped the stacked dialog'); break; }
  }
  await key('Escape'); await waitFor('window.__stackDone'); await sleep(150);
  const unstacked = await evaluate(`(() => ({ modalOpen: ONA.game.modalOpen, modalLive: !document.getElementById('modal').hasAttribute('inert'),
    dialogInert: document.getElementById('dialog').hasAttribute('inert'), focusInModal: document.getElementById('modal').contains(document.activeElement) }))()`);
  if (!unstacked.modalOpen || !unstacked.modalLive || !unstacked.dialogInert || !unstacked.focusInModal) problems.push('after closing stacked dialog: ' + JSON.stringify(unstacked));

  await key('Escape'); await sleep(200);
  const after = await evaluate(`(() => ({ open: ONA.game.modalOpen, appInert: document.getElementById('app').hasAttribute('inert'),
    restored: document.activeElement === document.querySelector('#topbar .settings-btn') }))()`);
  if (after.open || after.appInert || !after.restored) problems.push('modal close/restore wrong: ' + JSON.stringify(after));

  // Reduced motion pass: no errors
  await viewport(1440, 900);
  await evaluate(`ONA.store.setting('motion', 'reduce'); ONA.starfield.motion(); ONA.game.startRun(ONA.util.level(1), 'drill'); true`);
  await playRun({ accuracy: 0.5, maxQ: 3 });
  // Reduced motion: concept figures are static (no probes, no flowing dashes, everything revealed)
  await evaluate(`document.documentElement.classList.add('reduce-motion'); true`);   // what applySettings() does for motion: reduce
  await conceptCheck('l1-dns-path', 'dns-resolve');
  await evaluate(`ONA.game.run = null; ONA.game.startRun(null, 'drill', [ONA.util.qById('l1-dns-path')], 'RM'); true`);
  await clearDialogs(); await waitFor(`!!document.querySelector('#q-body')`); await answer(false); await sleep(400);
  const rm = await evaluate(`(() => { const f = document.querySelector('#feedback .fc-fig'), rev = f && f.querySelector('.cf-rev'), flow = f && f.querySelector('.cw-flow');
    return { probes: f ? f.querySelectorAll('.cf-probe, animateMotion').length : -1, revOpacity: rev ? getComputedStyle(rev).opacity : null,
      flowShown: flow ? getComputedStyle(flow).display !== 'none' : false }; })()`);
  if (rm.probes !== 0 || rm.revOpacity !== '1' || rm.flowShown) problems.push('reduced motion: concept figure still animates: ' + JSON.stringify(rm));
  await evaluate(`document.activeElement && document.activeElement.blur()`); await key('Enter'); await waitFor(`ONA.game.screen === 'debrief'`);
  // Reduced motion journeys: state changes only (no travelling packet, trail fully drawn)
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); ONA.journeys.open('nat'); true`); await sleep(150);
  await key('ArrowRight'); await sleep(150); await key('ArrowRight'); await sleep(150);
  const rmJ = await evaluate(`(() => { const st = document.getElementById('jr-stage'), tr = st.querySelector('.jr-trail');
    return { moving: st.querySelectorAll('animateMotion').length, pkt: !!st.querySelector('.jr-pkt'), dash: tr ? getComputedStyle(tr).strokeDashoffset : null }; })()`);
  if (rmJ.moving !== 0 || !rmJ.pkt || !/^0(px)?$/.test(String(rmJ.dash))) problems.push('reduced motion: journey still animates: ' + JSON.stringify(rmJ));
  await key('Escape'); await sleep(150);

  // Journey focus / rAF race: Esc fired synchronously, before the open() rAF and the focus timeouts get a chance to run.
  // Afterwards the overlay must stay hidden WITHOUT .open, nothing may be pending, and focus must be back on the opener.
  const RACE_STATE = `(() => { const el = document.getElementById('journey'), op = document.querySelector('#screen-journeys [data-journey-open="tcp"]');
    return { open: ${JST}.open, hidden: el.hidden, cls: el.classList.contains('open'), focusOnOpener: !!op && document.activeElement === op,
      active: document.activeElement && (document.activeElement.id || document.activeElement.className), pending: ONA.journeys.pending() }; })()`;
  const ESC = `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`;
  await evaluate(`ONA.game.run = null; ONA.game.show('journeys'); true`); await sleep(700);
  await evaluate(`(() => { const op = document.querySelector('#screen-journeys [data-journey-open="tcp"]'); op.focus(); op.click(); ${ESC}; return true; })()`);
  await sleep(300);
  const race1 = await evaluate(RACE_STATE);
  if (race1.open || !race1.hidden || race1.cls || !race1.focusOnOpener || race1.pending) problems.push('Esc right after journey open left a bad state: ' + JSON.stringify(race1));
  // Esc right after a correct check answer (the Finish-button focus timeout is still pending).
  await evaluate(`(() => { const op = document.querySelector('#screen-journeys [data-journey-open="tcp"]'); op.focus(); op.click(); return true; })()`); await sleep(200);
  const tcpN = await evaluate(`ONA.journeys.get('tcp').steps.length`);
  for (let s = 0; s < tcpN; s++) { await key('ArrowRight'); await sleep(40); }
  const tcpAns = await evaluate(`ONA.journeys.get('tcp').check.answer + 1`);
  await evaluate(`(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '${tcpAns}', bubbles: true, cancelable: true }));
    const solved = ONA.journeys.state().solved; ${ESC}; return solved; })()`).then((solved) => { if (!solved) problems.push('race test: the tcp check answer did not register'); });
  await sleep(300);
  const race2 = await evaluate(RACE_STATE);
  if (race2.open || !race2.hidden || race2.cls || !race2.focusOnOpener || race2.pending) problems.push('Esc right after a correct check answer left a bad state: ' + JSON.stringify(race2));
  console.log('Journey Esc races:', JSON.stringify({ afterOpen: race1, afterCorrect: race2 }));

  const summary = await evaluate(`(() => { const t = ONA.store.totals(); return { sessions: t.sessions, answered: t.seen, stars: t.stars, bay: ONA.store.bay().total }; })()`);
  console.log('Telemetry after run:', JSON.stringify(summary));

  // Music health after the whole play-through: still playing, no node leak, scheduler cheap, a sting fired
  await evaluate(`ONA.game.run = null; ONA.game.show('map'); true`); await sleep(3000);
  const end = await evaluate(AUDIO_STATE);
  const endMeter = await evaluate(METER(1500));
  audioLog.end = { mood: end.mood, ...end.stats, meter: endMeter };
  if (!end.playing || end.mood !== 'calm') problems.push('music not back to calm on the map at the end: ' + JSON.stringify({ playing: end.playing, mood: end.mood }));
  if (end.stats.live > 250) problems.push('possible audio node leak: ' + end.stats.live + ' live voices');
  // Faded-out decks are disposed once their pad tails ring out (≤ ~16 s): only the active deck may remain.
  try { await waitFor(`ONA.music.stats().decks <= 1`, 25000); }
  catch { problems.push('mood decks not disposed after fade-out: ' + (await evaluate(`ONA.music.stats().decks`))); }
  audioLog.end.decksAfterSettle = await evaluate(`ONA.music.stats().decks`);
  audioLog.end.liveAfterSettle = await evaluate(`ONA.music.stats().live`);
  if (end.stats.maxTickMs > 25) problems.push('music scheduler tick too slow: ' + end.stats.maxTickMs + ' ms');
  if (end.stats.stings < 1) problems.push('no victory sting fired after clearing a level');
  if (!(endMeter.peak < 1)) problems.push('output clipped at end (peak ' + endMeter.peak + ')');
  // ---- Repair Bay ids agree everywhere: hangar ship damage, callouts, list rows and the store
  const hg0 = await evaluate(HANGAR_IDS);
  if (!hg0.store.length) problems.push('expected damaged modules before the repair checks');
  hangarAgrees('damaged bay', hg0);
  const snapshot = await evaluate(`ONA.store.exportJSON()`);
  // fully repair ONE module (every part of it, through the real Leitner path), then everything
  const fixOne = hg0.store[0];
  await evaluate(`(() => { const S = ONA.store, ids = ONA.ship.damagedModules(S).find((m) => m.id === '${fixOne}').ids;
    ids.forEach((id) => { const r = S.qRec(id); r.box = 5; r.due = 0; S.recordAnswer(ONA.util.qById(id), 1, 1); }); S.save(); return true; })()`);
  const hg1 = await evaluate(HANGAR_IDS);
  hangarAgrees('after repairing ' + fixOne, hg1, hg0.store.filter((id) => id !== fixOne));
  await evaluate(`(() => { const S = ONA.store; S.bayAll().forEach((id) => { const r = S.qRec(id); r.box = 5; r.due = 0; S.recordAnswer(ONA.util.qById(id), 1, 1); }); S.save(); return true; })()`);
  hangarAgrees('after a full repair', await evaluate(HANGAR_IDS), []);
  await evaluate(`ONA.store.importJSON(${JSON.stringify(snapshot)}); true`);
  hangarAgrees('after export/import round-trip', await evaluate(HANGAR_IDS), hg0.store);
  await evaluate(`ONA.store.reset(); true`);
  hangarAgrees('after reset', await evaluate(HANGAR_IDS), []);
  await evaluate(`ONA.store.importJSON(${JSON.stringify(snapshot)}); ONA.game.show('map'); true`);
  audioLog.hangarIds = { damaged: hg0.store, repairedOne: fixOne };

  // ---- Fresh visit where M is the FIRST gesture: "All sound off", then unmuting starts music → "Music on" exactly once.
  await evaluate(`ONA.store.setting('muted', false); ONA.store.setting('music', true); true`);
  await send('Page.reload'); await waitFor(`!!(window.ONA && ONA.game && ONA.game.screen === 'title')`); await sleep(600);
  await evaluate(`window.__toastLog = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.classList && n.classList.contains('toast')) window.__toastLog.push(n.textContent); }))).observe(document.getElementById('toasts'), { childList: true }); true`);
  await key('m'); await sleep(500);
  const fm1 = await evaluate(AUDIO_STATE);
  if (!fm1.ctx || !fm1.muted || fm1.playing) problems.push('M as first gesture should create the context and mute: ' + JSON.stringify({ ctx: fm1.ctx, muted: fm1.muted, playing: fm1.playing }));
  await key('m'); await sleep(600);
  const fm2 = await evaluate(AUDIO_STATE);
  if (fm2.muted || !fm2.playing) problems.push('second M should unmute and start music: ' + JSON.stringify({ muted: fm2.muted, playing: fm2.playing }));
  await key('m'); await sleep(300); await key('m'); await sleep(400);
  const tlog = await evaluate(`window.__toastLog.slice()`);
  const musicOn = tlog.filter((t) => /^Music on/.test(t)).length;
  audioLog.firstGestureM = tlog;
  if (musicOn !== 1) problems.push('"Music on" toast must show exactly once when M is the first gesture: ' + JSON.stringify(tlog));
  if (tlog[1] !== 'Music on · N toggles music, M mutes all') problems.push('unmuting that first starts music should show "Music on" (not "Sound on"): ' + JSON.stringify(tlog));
  if (tlog.length !== 4) problems.push('expected one toast per M press (no duplicates): ' + JSON.stringify(tlog));

  // ---- M / N while a volume slider has focus do nothing (the slider owns the keys)
  await key('Enter'); await waitFor(`ONA.game.screen === 'map'`); await sleep(500);
  await evaluate(`document.querySelector('#topbar .settings-btn').click(); true`); await waitFor('ONA.game.modalOpen'); await sleep(150);
  await evaluate(`document.getElementById('set-music-vol').focus(); true`);
  const beforeKeys = await evaluate(`JSON.stringify(ONA.store.state.settings)`);
  await key('m'); await key('n'); await key('M'); await key('N'); await sleep(300);
  const afterKeys = await evaluate(`({ s: JSON.stringify(ONA.store.state.settings), focus: document.activeElement && document.activeElement.id, playing: ONA.music.playing() })`);
  if (afterKeys.s !== beforeKeys || afterKeys.focus !== 'set-music-vol' || !afterKeys.playing) problems.push('M/N with the volume slider focused must do nothing: ' + JSON.stringify({ beforeKeys, afterKeys }));
  // explicit exception: a focused Settings checkbox still lets M mute
  await evaluate(`document.getElementById('set-free').focus(); true`);
  await key('m'); await sleep(200);
  if (!(await evaluate(`ONA.store.state.settings.muted`))) problems.push('M with a Settings checkbox focused should still mute (explicit exception)');
  await key('m'); await sleep(200);
  await key('Escape'); await sleep(200);

  // ---- Muting during a victory sting disposes the sting graph promptly (not ~9.5 s later)
  await evaluate(`ONA.music.sting(); true`); await sleep(400);
  const st1 = (await evaluate(AUDIO_STATE)).stats;
  if (!st1.stingLive || st1.stingBuses !== 1) problems.push('sting should be live with one bus: ' + JSON.stringify(st1));
  await key('m'); await sleep(800);
  const st2 = (await evaluate(AUDIO_STATE)).stats;
  if (st2.stingLive || st2.stingBuses !== 0 || st2.playing) problems.push('muting mid-sting should dispose it within ~0.5 s: ' + JSON.stringify(st2));
  await key('m'); await sleep(300);
  audioLog.stingDispose = { during: { live: st1.stingLive, buses: st1.stingBuses }, afterMute: { live: st2.stingLive, buses: st2.stingBuses } };

  console.log('Audio:', JSON.stringify(audioLog));

  // ---- Phones: every screen at 375/390/412 px portrait + landscape (tests/mobile_checks.mjs)
  const mob = await mobilePass(H);
  console.log('Mobile pass:', Object.keys(mob).length, 'screen checks');
  console.log('Mobile audio (taps, plus labelled keyboard-N checks):', JSON.stringify(await mobileAudioPass(H)));
  }
} catch (e) {
  problems.push('driver: ' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* closed */ }
  chrome.kill('SIGKILL');
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (problems.length) {
  console.error('\nFAIL — ' + problems.length + ' problem(s):');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('\nPASS — no console errors or exceptions');
