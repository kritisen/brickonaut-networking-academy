#!/usr/bin/env node
// Validates the Brickonaut Networking Academy question bank.
// Usage: node tests/validate_questions.mjs
// Loads data/questions.js (+ every registered extra level file) in a sandbox exactly as the browser would.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILES = ['data/questions.js', 'data/concepts.js', 'data/journeys.js'];
// Concept-figure library (pure string renderers; art.js supplies the node icons).
const LIB_FILES = ['js/art.js', 'js/explainers.js', 'js/journeys.js'];

// Keep in sync with index.html script tags.
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const f of DATA_FILES) {
  if (!html.includes(`src="${f}"`)) fail(`index.html does not load ${f}`);
}

const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of LIB_FILES) {
  if (!html.includes(`src="${f}"`)) fail(`index.html does not load ${f}`);
}
for (const f of DATA_FILES.concat(LIB_FILES)) vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
const ONA = sandbox.window.ONA;

const errors = [];

// ---- cloud consistency: a docs URL must match the cloud the question is about
const CLOUD_TOPIC = { 'dbx-aws-vpc': 'aws', 'dbx-pl-aws': 'aws', 'dbx-azure-vnet': 'azure', 'dbx-pl-azure': 'azure', 'dbx-gcp-vpc': 'gcp', 'dbx-psc-gcp': 'gcp' };
const MARK = {
  azure: /\bAzure\b|\bVNets?\b|\bNSGs?\b|ExpressRoute|\bUDRs?\b|\bEntra\b|storage account|service tag|AzureDatabricks/i,
  aws: /\bAWS\b|\bS3\b|\bNACLs?\b|Transit Gateway|\bTGW\b|Direct Connect|\bVPC endpoints?\b|\bVPCEs?\b|security groups?\b|\bSGs?\b|\bIGW\b/i,
  gcp: /\bGCP\b|Private Service Connect|\bPSC\b|\bGCS\b|Shared VPC|Cloud NAT/i
};
function urlCloud(u) {
  if (/learn\.microsoft\.com\/[a-z-]+\/azure\/databricks\/|docs\.databricks\.com\/azure\//.test(u)) return 'azure';
  if (/docs\.databricks\.com\/gcp\//.test(u)) return 'gcp';
  if (/docs\.databricks\.com\/aws\//.test(u)) return 'aws';
  return null;
}
// Text a question asserts: prompt, explanation, and the CORRECT answers. Wrong choices are skipped
// because they're often deliberate cross-cloud distractors.
function correctText(p) {
  if (p.type === 'mc' && p.choices) return [p.choices[p.answer]];
  if (p.type === 'multi' && p.choices) return p.answer.map((k) => p.choices[k]);
  if (p.type === 'order') return p.items || [];
  return [];
}
function textOf(q) {
  return [q.prompt, q.explain].concat(correctText(q), (q.parts || []).flatMap((p) => [p.prompt, p.explain].concat(correctText(p))))
    .join(' \n ').replace(/\bVPCs?\s*(\/|or|and)\s*VNets?\b|\bVNets?\s*(\/|or|and)\s*VPCs?\b/gi, ' ');   // "VPC/VNet" is cloud-neutral
}
// The clouds a question is about: every cloud its text mentions, plus its topic's cloud.
// Override with q.cloud: 'any' (cloud-neutral) or an explicit list like ['aws', 'azure'].
function questionClouds(q) {
  if (q.cloud === 'any') return [];
  if (Array.isArray(q.cloud)) return q.cloud;
  const t = textOf(q), hits = new Set(Object.keys(MARK).filter((c) => MARK[c].test(t)));
  if (CLOUD_TOPIC[q.topic]) hits.add(CLOUD_TOPIC[q.topic]);
  return [...hits];
}
function allUrls(q) {
  const out = [];
  [q.source, q.docs].concat((q.parts || []).flatMap((p) => [p.source, p.docs])).flat()
    .forEach((u) => { if (typeof u === 'string' && /^https?:/.test(u) && !out.includes(u)) out.push(u); });
  return out;
}
function fail(msg) { console.error('FATAL: ' + msg); process.exit(1); }
function err(id, msg) { errors.push(`[${id}] ${msg}`); }

const DOC_HOSTS = [/^https:\/\/docs\.databricks\.com\//, /^https:\/\/learn\.microsoft\.com\/[a-z-]+\/azure\/databricks\//];
const TYPES = new Set(['mc', 'multi', 'numeric', 'order', 'diagram', 'multipart']);

// Recompute CIDR-style answers from first principles.
function recompute(c) {
  const size = (p) => 2 ** (32 - p);
  switch (c.kind) {
    case 'total': return size(c.prefix);
    case 'usable': return size(c.prefix) - c.reserved;
    case 'awsNodes': return Math.floor((size(c.prefix) - 5) / 2);           // 5 reserved, 2 IPs per node
    case 'azureNodes': return size(c.prefix) - 5;                          // 5 reserved, 1 IP per node per subnet
    case 'fit': return 2 ** (c.child - c.parent);
    case 'ipsNeeded': return c.nodes * c.perNode + c.reserved;
    case 'minPrefix': {                                                    // largest prefix (smallest block) that fits
      for (let p = 32; p >= 0; p--) if (size(p) - c.reserved >= c.need * c.perNode) return p;
      return null;
    }
    case 'container': return c.child - Math.ceil(Math.log2(c.count));       // smallest block holding `count` child blocks
    default: return undefined;
  }
}

function checkItem(q, id, ctx) {
  if (!TYPES.has(q.type)) return err(id, `unknown type "${q.type}"`);
  if (!q.prompt || typeof q.prompt !== 'string') err(id, 'missing prompt');
  if (!q.explain || typeof q.explain !== 'string') err(id, 'missing explanation');
  if (q.type !== 'multipart' && q.answer === undefined) err(id, 'missing answer');
  switch (q.type) {
    case 'mc':
      if (!Array.isArray(q.choices) || q.choices.length < 2) err(id, 'mc needs >=2 choices');
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) err(id, `answer index ${q.answer} out of range`);
      if (q.choices && new Set(q.choices).size !== q.choices.length) err(id, 'duplicate choices');
      if (q.choices && q.choices.length > 9) err(id, 'too many choices for 1-9 shortcuts');
      ctx.types.mc++;
      break;
    case 'multi':
      if (!Array.isArray(q.choices) || q.choices.length < 2) err(id, 'multi needs >=2 choices');
      else if (!Array.isArray(q.answer) || !q.answer.length) err(id, 'multi answer must be a non-empty array');
      else {
        if (new Set(q.answer).size !== q.answer.length) err(id, 'duplicate indexes in answer');
        q.answer.forEach((a) => { if (!Number.isInteger(a) || a < 0 || a >= q.choices.length) err(id, `answer index ${a} out of range`); });
      }
      ctx.types.multi++;
      break;
    case 'numeric':
      if (typeof q.answer !== 'number' || !Number.isFinite(q.answer)) err(id, 'numeric answer must be a number');
      if (q.calc) {
        const r = recompute(q.calc);
        if (r === undefined) err(id, `unknown calc kind ${q.calc.kind}`);
        else if (r !== q.answer) err(id, `calc ${JSON.stringify(q.calc)} recomputes to ${r}, but answer is ${q.answer}`);
        else ctx.recomputed++;
      }
      ctx.types.numeric++;
      break;
    case 'order':
      if (!Array.isArray(q.items) || q.items.length < 3) err(id, 'order needs >=3 items');
      else {
        if (new Set(q.items).size !== q.items.length) err(id, 'duplicate order items');
        const ok = Array.isArray(q.answer) && q.answer.length === q.items.length && q.answer.every((v, i) => v === i);
        if (!ok) err(id, 'order answer must be the identity permutation [0..n-1] (items are authored in correct order)');
      }
      ctx.types.order++;
      break;
    case 'diagram': {
      const d = q.diagram;
      if (!d || !Array.isArray(d.nodes) || d.nodes.length < 2) { err(id, 'diagram needs nodes'); break; }
      const ids = new Set(d.nodes.map((n) => n.id));
      if (ids.size !== d.nodes.length) err(id, 'duplicate diagram node ids');
      if (!ids.has(q.answer)) err(id, `diagram answer "${q.answer}" is not a node`);
      (d.links || []).forEach((l) => { if (!ids.has(l[0]) || !ids.has(l[1])) err(id, `bad link ${l}`); });
      d.nodes.forEach((n) => { if (typeof n.x !== 'number' || typeof n.y !== 'number' || !n.label) err(id, `node ${n.id} needs x,y,label`); });
      if (d.nodes.length > 9) err(id, 'too many nodes for 1-9 shortcuts');
      ctx.types.diagram++;
      break;
    }
    case 'multipart':
      if (!Array.isArray(q.parts) || q.parts.length < 2) err(id, 'multipart needs >=2 parts');
      else q.parts.forEach((p, i) => {
        if (p.type === 'multipart') err(id, 'nested multipart not allowed');
        checkItem(p, `${id}#${i + 1}`, ctx);
      });
      ctx.types.multipart++;
      break;
  }
}

const ids = new Set();
const perLevel = {};
const ctx = { types: { mc: 0, multi: 0, numeric: 0, order: 0, diagram: 0, multipart: 0 }, recomputed: 0 };
const levelIds = new Set(ONA.LEVELS.map((l) => l.id));
if (levelIds.size !== ONA.LEVELS.length) fail('duplicate level ids');
ONA.LEVELS.forEach((l) => { if (!l.name || !l.art) err('level ' + l.id, 'level needs name + art'); });

for (const q of ONA.QUESTIONS) {
  const id = q.id || '(no id)';
  if (!q.id) err(id, 'missing id');
  else if (ids.has(q.id)) err(id, 'duplicate id');
  ids.add(q.id);
  if (!levelIds.has(q.level)) err(id, `unknown level ${q.level}`);
  if (!q.topic || !ONA.TOPICS[q.topic]) err(id, `missing/unknown topic "${q.topic}"`);
  if (![1, 2, 3].includes(q.difficulty)) err(id, 'difficulty must be 1, 2 or 3');
  if (q.mini && !ONA.MINI[q.mini] && !['osi', 'handshake'].includes(q.mini)) err(id, `unknown mini diagram "${q.mini}"`);
  // `source` = a URL or a citation string. `docs` = a URL or an array of URLs.
  // Databricks docs URLs (docs.databricks.com, learn.microsoft.com/…/azure/databricks) prove dbx facts;
  // other https URLs (e.g. Azure NAT Gateway docs) are allowed as supporting references.
  const topic = ONA.TOPICS[q.topic];
  if (q.source !== undefined && (typeof q.source !== 'string' || !q.source.trim())) err(id, 'source must be a non-empty string');
  if (q.docs !== undefined && !(typeof q.docs === 'string' || (Array.isArray(q.docs) && q.docs.length))) err(id, 'docs must be a URL string or a non-empty array of URLs');
  const urls = allUrls(q);
  urls.forEach((u) => { if (!/^https:\/\/[^\s/]+\.[^\s/]+\//.test(u)) err(id, 'source URL must be an https URL: ' + u); });
  [q.docs].flat().forEach((u) => { if (u !== undefined && !/^https:/.test(u)) err(id, 'docs entries must be URLs: ' + u); });
  const dbxUrls = urls.filter((u) => DOC_HOSTS.some((re) => re.test(u)));
  if (topic && topic.dbx && !dbxUrls.length) err(id, 'Databricks-topic question has no Databricks docs URL (source or docs)');
  // One Databricks docs URL per cloud the question is about, and no docs from a cloud it isn't about.
  const clouds = questionClouds(q);
  if (clouds.length) {
    const cited = new Set(dbxUrls.map(urlCloud).filter(Boolean));
    if (topic && topic.dbx) clouds.forEach((c) => { if (!cited.has(c)) err(id, `mentions ${c.toUpperCase()} but cites no ${c.toUpperCase()} Databricks docs URL`); });
    dbxUrls.forEach((u) => { const uc = urlCloud(u); if (uc && !clouds.includes(uc)) err(id, `${clouds.join('+').toUpperCase()} question cites a ${uc.toUpperCase()} docs URL: ${u}`); });
  }
  const lvl = ONA.LEVELS.find((l) => l.id === q.level);
  checkItem(q, id, ctx);
  const lv = (perLevel[q.level] = perLevel[q.level] || { total: 0, parts: 0 });
  lv.total++;
  lv.parts += q.type === 'multipart' ? q.parts.length : 1;
}

// ---- concept figures: every question maps to a real figure with valid params + its own concept text
const X = ONA.explainers;
const figUse = {};
// Minimal well-formedness check for generated SVG: every opened tag is closed in order.
function balanced(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (m[4] === '/') continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}
function checkFig(id, fig, params, where) {
  if (!fig || !X.FIGURES[fig]) return err(id, `${where}: figure "${fig}" is not in the concept library`);
  X.validate(fig, params || {}).forEach((e) => err(id, `${where}: ${e}`));
  let out = '';
  try { out = X.render(fig, params || {}); } catch (e) { return err(id, `${where}: figure ${fig} threw: ${e.message}`); }
  if (!/^<svg class="cfig cf-/.test(out) || !/aria-hidden="true"/.test(out)) err(id, `${where}: figure ${fig} did not render an aria-hidden concept SVG`);
  else if (!balanced(out)) err(id, `${where}: figure ${fig} rendered unbalanced SVG markup`);
  if (/NaN|undefined/.test(out)) err(id, `${where}: figure ${fig} rendered NaN/undefined`);
  figUse[fig] = (figUse[fig] || 0) + (where === 'question' ? 1 : 0);
}
if (!X) fail('js/explainers.js did not define ONA.explainers');
Object.keys(X.FIGURES).forEach((f) => { figUse[f] = 0; checkFig('figure ' + f, f, X.FIGURES[f].sample, 'sample'); });
Object.keys(ONA.CONCEPTS || {}).forEach((k) => { if (!ids.has(k)) err(k, 'data/concepts.js maps an id that is not a question'); });
for (const q of ONA.QUESTIONS) {
  const id = q.id;
  if (!q.fig) { err(id, 'no concept figure (add it to data/concepts.js)'); continue; }
  checkFig(id, q.fig, q.figParams, 'question');
  if (typeof q.concept !== 'string' || q.concept.trim().length < 60) err(id, 'concept text missing or too short (< 60 chars)');
  else {
    if (q.concept.length > 520) err(id, `concept text too long (${q.concept.length} > 520 chars; keep it to 1–3 sentences)`);
    if ((q.concept.match(/[.!?](\s|$)/g) || []).length > 3) err(id, 'concept text should be 1–3 sentences');
    if (q.concept.trim() === String(q.explain).trim()) err(id, 'concept text must teach the idea, not repeat the explanation');
  }
  if (q.figParts !== undefined) {
    if (q.type !== 'multipart') err(id, 'figParts is only for multipart questions');
    else if (!Array.isArray(q.figParts) || q.figParts.length > q.parts.length) err(id, 'figParts must be an array no longer than parts');
    else q.figParts.forEach((o, i) => {
      if (!o || typeof o !== 'object') return err(id, `figParts[${i}] must be an object`);
      if (o.concept !== undefined && (typeof o.concept !== 'string' || o.concept.trim().length < 60)) err(id, `figParts[${i}].concept too short`);
      const s = X.spec(q, i);
      checkFig(id, s.fig, s.params, `step ${i + 1}`);
    });
  }
}

// ---- holo-sim journeys: structure, references, renderability, question mapping
const JR = ONA.JOURNEYS, JMAP = ONA.JOURNEY_MAP || {};
const jIds = new Set();
const BODIES = new Set(['ship', 'station', 'sat', 'mother', 'gate', 'planet']), SHAPES = new Set(['ring', 'nebula', 'box']), TONES = new Set(['ok', 'bad', 'hl']);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const sentences = (s) => (s.match(/[.!?](\s|$)/g) || []).length;
if (!Array.isArray(JR) || !JR.length) fail('data/journeys.js defines no ONA.JOURNEYS');
if (!ONA.journeys || typeof ONA.journeys.scene !== 'function') fail('js/journeys.js did not define ONA.journeys.scene');
for (const j of JR) {
  const jid = 'journey ' + (j.id || '?');
  if (!nonEmpty(j.id)) { err(jid, 'missing id'); continue; }
  if (jIds.has(j.id)) err(jid, 'duplicate journey id');
  jIds.add(j.id);
  if (!levelIds.has(j.level)) err(jid, `unknown level ${j.level}`);
  ['title', 'tagline'].forEach((k) => { if (!nonEmpty(j[k])) err(jid, `missing ${k}`); });
  const nodes = new Map();
  (j.nodes || []).forEach((n) => {
    if (!nonEmpty(n.id) || nodes.has(n.id)) err(jid, `node id missing or duplicate: ${n.id}`);
    nodes.set(n.id, n);
    if (!BODIES.has(n.body)) err(jid, `node ${n.id}: body must be one of ${[...BODIES].join('|')}`);
    if (typeof n.x !== 'number' || typeof n.y !== 'number' || n.x < 0 || n.y < 0 || n.x > (j.w || 720) || n.y > (j.h || 400)) err(jid, `node ${n.id}: x,y must be inside the scene`);
    ['label', 'info'].forEach((k) => { if (!nonEmpty(n[k])) err(jid, `node ${n.id}: missing ${k} (the scanner tooltip needs it)`); });
  });
  (j.zones || []).forEach((z, k) => { if (!SHAPES.has(z.shape) || ![z.x, z.y, z.w, z.h].every((v) => typeof v === 'number')) err(jid, `zone ${k}: needs shape + x,y,w,h`); });
  if (!Array.isArray(j.steps) || j.steps.length < 4 || j.steps.length > 9) err(jid, 'needs 4–9 steps');
  const ref = (v, where) => { if (typeof v === 'string') { if (!nodes.has(v)) err(jid, `${where}: unknown node "${v}"`); } else if (!(Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number'))) err(jid, `${where}: must be a node id or [x, y]`); };
  (j.steps || []).forEach((s, i) => {
    const w = `step ${i + 1}`;
    if (!nonEmpty(s.title)) err(jid, `${w}: missing title`);
    if (!nonEmpty(s.say)) err(jid, `${w}: missing narration (say)`);
    else if (sentences(s.say) > 3) err(jid, `${w}: narration should be 1–3 sentences`);
    if (!s.packet || !nonEmpty(s.packet.title) || !Array.isArray(s.packet.fields) || !s.packet.fields.length) err(jid, `${w}: needs packet { title, fields }`);
    else s.packet.fields.forEach((f, k) => { if (!Array.isArray(f) || f.length !== 2 || !nonEmpty(f[0]) || !nonEmpty(f[1])) err(jid, `${w}: packet field ${k} must be [label, value]`); });
    if (s.figure) {
      if (!X.FIGURES[s.figure.fig]) err(jid, `${w}: figure "${s.figure.fig}" is not in the concept library`);
      else X.validate(s.figure.fig, s.figure.params || {}).forEach((e) => err(jid, `${w}: ${e}`));
    } else {
      if (!s.from && !s.to && !(s.hl && s.hl.length)) err(jid, `${w}: needs a travel (from/to) or highlighted nodes (hl)`);
      if ((s.from && !s.to) || (!s.from && s.to)) err(jid, `${w}: from and to go together`);
      if (s.from) ref(s.from, w + ' from');
      if (s.to) ref(s.to, w + ' to');
      (s.via || []).forEach((v, k) => ref(v, `${w} via[${k}]`));
      (s.hl || []).forEach((v) => ref(v, w + ' hl'));
      (s.badges || []).forEach((b) => { ref(b.node, w + ' badge'); if (!nonEmpty(b.text)) err(jid, `${w}: badge needs text`); if (b.tone && !TONES.has(b.tone)) err(jid, `${w}: badge tone ${b.tone}`); });
      if (s.blocked && s.back) err(jid, `${w}: a blocked travel can't also be a round trip`);
    }
    let out = '';
    try { out = ONA.journeys.scene(j, i, { static: true }); } catch (e) { err(jid, `${w}: scene threw ${e.message}`); }
    if (out && (!balanced(out) || /NaN|undefined/.test(out))) err(jid, `${w}: scene rendered malformed markup or NaN/undefined`);
  });
  const c = j.check;
  if (!c || !nonEmpty(c.prompt) || !Array.isArray(c.choices) || c.choices.length < 3 || c.choices.length > 4 || !nonEmpty(c.explain)) err(jid, 'check needs prompt, 3–4 choices and explain');
  else {
    if (!Number.isInteger(c.answer) || c.answer < 0 || c.answer >= c.choices.length) err(jid, 'check answer index out of range');
    if (new Set(c.choices).size !== c.choices.length) err(jid, 'check has duplicate choices');
  }
  if (!(JMAP[j.id] || []).length) err(jid, 'no questions map to this journey');
}
const jSeen = new Map();
Object.keys(JMAP).forEach((jid) => {
  if (!jIds.has(jid)) err('JOURNEY_MAP', `unknown journey "${jid}"`);
  JMAP[jid].forEach((qid) => {
    if (!ids.has(qid)) err('JOURNEY_MAP', `${jid}: "${qid}" is not a question`);
    if (jSeen.has(qid)) err(qid, `mapped to two journeys (${jSeen.get(qid)}, ${jid})`);
    jSeen.set(qid, jid);
  });
});
for (const q of ONA.QUESTIONS) if (q.journey !== undefined && !jIds.has(q.journey)) err(q.id, `journey "${q.journey}" does not exist`);

// Coverage requirements.
for (const l of ONA.LEVELS.filter((l) => !l.bonus)) {
  const n = (perLevel[l.id] || { total: 0 }).total;
  if (n < 15) err('level ' + l.id, `only ${n} questions (need >= 15)`);
}
const boss = ONA.LEVELS.find((l) => l.boss);
if (boss && ONA.QUESTIONS.filter((q) => q.level === boss.id && q.type === 'multipart').length < 5) err('boss', 'boss level needs >= 5 multipart scenarios');

// ---- Databricks mark: js/brand.js draws the exact path of the committed official asset (no redraws, no fetch)
{
  const svg = readFileSync(join(root, 'assets/databricks-mark.svg'), 'utf8');
  const filePaths = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)];
  const bs = { window: {} }; bs.globalThis = bs; vm.createContext(bs);
  vm.runInContext(readFileSync(join(root, 'js/brand.js'), 'utf8'), bs, { filename: 'js/brand.js' });
  const B = bs.window.ONA.brand;
  if (filePaths.length !== 1) err('brand', 'assets/databricks-mark.svg should hold exactly one path');
  else {
    if (filePaths[0][1] !== B.MARK_PATH) err('brand', 'js/brand.js MARK_PATH differs from assets/databricks-mark.svg');
    if (filePaths[0][2].toUpperCase() !== '#FF3621' || B.LAVA.toUpperCase() !== '#FF3621') err('brand', 'the mark must stay Lava #FF3621');
  }
  if (!/viewBox="0 0 104\.5 113"/.test(svg)) err('brand', 'assets/databricks-mark.svg viewBox changed');
  const iBrand = html.indexOf('src="js/brand.js"'), iShip = html.indexOf('src="js/ship.js"');
  if (iBrand < 0 || iShip < 0 || iBrand > iShip) err('brand', 'index.html must load js/brand.js before js/ship.js');
  const m = html.match(/id="title-count"[^>]*>(\d+) questions/);
  if (!m || +m[1] !== ONA.QUESTIONS.length) err('title', `index.html title count (${m && m[1]}) must equal the bank size (${ONA.QUESTIONS.length}); game.js also sets it at runtime`);
}

console.log('Brickonaut Networking Academy — question bank validation');
console.log('Level  Name                    Questions  Gradable steps');
for (const l of ONA.LEVELS) {
  const s = perLevel[l.id] || { total: 0, parts: 0 };
  console.log(`${String(l.id).padEnd(6)} ${l.name.padEnd(23)} ${String(s.total).padEnd(10)} ${s.parts}${l.bonus ? '  (bonus slot)' : ''}`);
}
console.log('Total questions:', ONA.QUESTIONS.length);
console.log('By type (multipart parts counted by their own type too):', JSON.stringify(ctx.types));
console.log('CIDR/numeric answers recomputed from calc:', ctx.recomputed);
const mapped = ONA.QUESTIONS.filter((q) => q.fig && q.concept).length;
console.log(`Concept figures: ${Object.keys(X.FIGURES).length} in library · ${mapped}/${ONA.QUESTIONS.length} questions mapped`);
console.log('Questions per figure:', Object.entries(figUse).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(' · '));
const unused = Object.entries(figUse).filter(([, n]) => n === 0).map(([f]) => f);
if (unused.length) err('library', 'figures not used by any question: ' + unused.join(', '));
const jq = ONA.QUESTIONS.filter((q) => q.journey).length;
console.log(`Journeys: ${JR.length} · ${JR.reduce((a, j) => a + j.steps.length, 0)} steps rendered · ${jq}/${ONA.QUESTIONS.length} questions mapped (${ONA.QUESTIONS.filter((q) => q.journey && q.type === 'order').length} sequence questions get "Watch the journey first")`);
console.log('Questions per journey:', JR.map((j) => `${j.id} ${(JMAP[j.id] || []).length}`).join(' · '));

if (errors.length) {
  console.error(`\nFAIL — ${errors.length} problem(s):`);
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('\nPASS');
