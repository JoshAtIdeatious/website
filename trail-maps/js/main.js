import { getKey, setCustomKey, isCustomKey, loadCatalog, loadTopoStyle, FIXED_BASES, findBase, intersects, coverage, BASEMAPS } from './linz.js';
import { PRESETS, LICENCES, GRADES, fetchOSM, fetchDOC, parseFile, bboxOf } from './sources.js';
import { buildStyle, attachIcons, FONTS, DASHES, ROAD_CLASSES, PLACE_CATS, roadLook } from './style.js';
import { printGeometry, boundsOf, niceScale, renderPrint, encode, worldFile, download, paperSize } from './export.js';

const $ = s => document.querySelector(s);
const STORE = 'tm.state.v1';

// ---- State ------------------------------------------------------------------------

const DEFAULTS = {
  view: { center: [168.6626, -45.0312], zoom: 12.5 },
  imagery: { base: 'aerial', opacity: 1, brightness: 0, contrast: 0, saturation: 0, fillGaps: true },
  terrain: { hillshade: false, hillshadeStrength: 0.35, contours: false, contourColor: '#c8691a', contourOpacity: 0.7, labels: true },
  labelFont: 'Open Sans Bold',
  places: {
    halo: '#ffffff', haloWidth: 1.6,
    cats: {
      city: { on: true, color: '#1b1b1b', size: 16, font: 'Roboto Bold', caps: true },
      town: { on: true, color: '#1b1b1b', size: 13, font: 'Roboto Bold', caps: false },
      suburb: { on: true, color: '#333333', size: 11, font: 'Roboto Regular', caps: false },
      water: { on: true, color: '#1d5f8c', size: 12, font: 'Open Sans Italic', caps: false },
      peak: { on: true, color: '#4a3420', size: 11, font: 'Roboto Italic', caps: false },
      island: { on: true, color: '#1b1b1b', size: 12, font: 'Roboto Regular', caps: false },
    },
  },
  layers: [],
  print: {
    paper: 'A3', orientation: 'portrait', customW: 500, customH: 700, dpi: 300, bleed: 0,
    scaleMode: 'fit', scale: 25000, title: '', subtitle: '', titleFont: 'Barlow Condensed',
    showTitle: true, showLegend: true, showScale: true, showNorth: true, showAttribution: true, showCropMarks: false,
    credits: '', creditsEdited: false, format: 'png', worldFile: false, frame: true,
    publisher: '', showFinePrint: true, safety: true,
  },
};

const clone = o => JSON.parse(JSON.stringify(o));
function merge(def, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(def)) return saved ?? def;
  const out = { ...def };
  for (const k of Object.keys(saved)) out[k] = (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) ? merge(def[k], saved[k]) : saved[k];
  return out;
}

let state = clone(DEFAULTS);
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved) state = merge(clone(DEFAULTS), saved);
} catch { /* ignore */ }
state.layers.forEach(l => { l.status = l.data ? 'ok' : 'empty'; l.error = null; });

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const c = map.getCenter();
    state.view = { center: [c.lng, c.lat], zoom: map.getZoom() };
    const strip = s => JSON.stringify({ ...s, layers: s.layers.map(({ status, error, ...l }) => l) });
    try { localStorage.setItem(STORE, strip(state)); }
    catch {
      try { localStorage.setItem(STORE, strip({ ...state, layers: state.layers.map(l => ({ ...l, data: null })) })); } catch { /* full */ }
    }
  }, 400);
}

let key = getKey();
let catalog = null;
let topo = null;

// ---- Map ----------------------------------------------------------------------------

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(state, { key }),
  center: state.view.center,
  zoom: state.view.zoom,
  maxZoom: 21,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  attributionControl: false,
  hash: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
const attrib = new maplibregl.AttributionControl({ compact: true, customAttribution: '' });
map.addControl(attrib, 'bottom-right');
attachIcons(map);
window.__map = map;

// Apply a new style without tearing the map down: add/remove only what changed.
const applied = { sources: new Map(), layers: new Map(), data: new Map() };
function syncMap() {
  if (!map.isStyleLoaded() && !map._loaded) { map.once('load', syncMap); return; }
  const style = buildStyle(state, { key, topo });
  const srcKey = s => JSON.stringify({ ...s, data: undefined });

  const replace = new Set();
  for (const [id, s] of Object.entries(style.sources)) {
    if (applied.sources.has(id) && applied.sources.get(id) !== srcKey(s)) replace.add(id);
  }
  const newLayers = new Map(style.layers.map(l => [l.id, l]));
  for (const id of map.getLayersOrder()) {
    const nl = newLayers.get(id);
    if (!nl || JSON.stringify(nl) !== applied.layers.get(id) || replace.has(nl.source) || !style.sources[nl.source] && nl.source) {
      map.removeLayer(id); applied.layers.delete(id);
    }
  }
  for (const id of [...applied.sources.keys()]) {
    if (!style.sources[id] || replace.has(id)) {
      if (map.getSource(id)) map.removeSource(id);
      applied.sources.delete(id); applied.data.delete(id);
    }
  }
  for (const [id, s] of Object.entries(style.sources)) {
    if (!map.getSource(id)) {
      map.addSource(id, s); applied.sources.set(id, srcKey(s)); applied.data.set(id, s.data);
    } else if (s.type === 'geojson' && applied.data.get(id) !== s.data) {
      map.getSource(id).setData(s.data); applied.data.set(id, s.data);
    }
  }
  for (const l of style.layers) {
    if (!map.getLayer(l.id)) { map.addLayer(l); applied.layers.set(l.id, JSON.stringify(l)); }
  }
  const want = style.layers.map(l => l.id);
  const have = map.getLayersOrder();
  if (want.join() !== have.join()) want.forEach(id => map.moveLayer(id));
  updateAttribution();
  save();
}

map.on('load', () => {
  const init = buildStyle(state, { key });
  for (const [id, src] of Object.entries(init.sources)) {
    applied.sources.set(id, JSON.stringify({ ...src, data: undefined }));
    applied.data.set(id, src.data);
  }
  for (const l of init.layers) applied.layers.set(l.id, JSON.stringify(l));
  loadTopoStyle().then(s => { topo = s; syncMap(); }).catch(err => toast(`Couldn’t load LINZ contours/labels: ${err.message}`));
  syncMap();
  updateFrame();
});
map.on('error', e => {
  const msg = e?.error?.message || '';
  if (/401|403/.test(msg) || e?.error?.status === 403) toast('LINZ rejected the API key — check Settings.');
});
map.on('move', updateFrame);
map.on('moveend', () => { renderImageryList(); save(); });
window.addEventListener('resize', updateFrame);

// ---- Toast ------------------------------------------------------------------------------

let toastTimer;
function toast(msg, ms = 4200) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---- Tabs ------------------------------------------------------------------------------

document.querySelectorAll('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs [role=tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
  if (b.dataset.tab === 'print') updateSummary();
}));

// ---- Imagery -----------------------------------------------------------------------------

let yearFilter = null;

function viewBbox() {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

function setsInView() {
  if (!catalog) return [];
  const v = viewBbox();
  const scanned = $('#show-scanned').checked;
  return catalog
    .filter(c => intersects(v, c.bbox))
    .filter(c => scanned || c.category !== 'Scanned Aerial Imagery')
    .filter(c => c.category !== 'Topographic')
    .map(c => ({ ...c, cov: coverage(v, c.bbox) }))
    .filter(c => c.cov > 0.02);
}

const yearLabel = c => c.year ? (c.yearEnd && c.yearEnd !== c.year ? `${c.year}–${String(c.yearEnd).slice(2)}` : `${c.year}`) : '—';

function renderImageryList() {
  const list = $('#imagery-list');
  if (!catalog) return;
  const sets = setsInView();
  const years = [...new Set(sets.map(s => s.yearEnd || s.year).filter(Boolean))].sort((a, b) => b - a);
  const decades = [...new Set(years.map(y => Math.floor(y / 10) * 10))];
  $('#year-chips').innerHTML = ['All', ...decades.map(d => `${d}s`)].map(d =>
    `<button type="button" class="chip" data-d="${d}" aria-pressed="${(yearFilter ?? 'All') === d}">${d}</button>`).join('');
  const shown = sets.filter(s => !yearFilter || yearFilter === 'All' || `${Math.floor((s.yearEnd || s.year) / 10) * 10}s` === yearFilter);
  const rows = [...FIXED_BASES.filter(f => !yearFilter || yearFilter === 'All'), ...shown];
  list.innerHTML = rows.map(c => `
    <li><button type="button" data-id="${c.id}" aria-current="${c.id === state.imagery.base}">
      <span class="yr">${c.fixed ? c.short : yearLabel(c)}</span>
      <span><span class="t">${esc(c.title)}</span>
      <span class="m">${c.res ? `${c.res} m` : ''}${c.cov != null ? ` <span class="cov" title="${Math.round(c.cov * 100)}% of view"><i style="width:${Math.round(c.cov * 100)}%"></i></span>` : ''}
      ${c.category && !c.fixed ? `<span class="tag">${esc(c.category.replace(' Aerial Photos', '').replace('Scanned Aerial Imagery', 'Historic scan'))}</span>` : ''}${c.draft ? '<span class="tag">Draft</span>' : ''}</span></span>
    </button></li>`).join('') || '<li class="muted small" style="padding:10px">No imagery sets here — try zooming in over New Zealand.</li>';
  updateBaseCard();
}

function stepSets() {
  // Chronological list of sets covering most of the view, for the Older/Newer buttons.
  return setsInView().filter(s => s.cov > 0.5).sort((a, b) => (a.yearEnd || 0) - (b.yearEnd || 0) || (b.res || 9) - (a.res || 9));
}

function updateBaseCard() {
  const b = findBase(catalog, state.imagery.base);
  $('#base-title').textContent = b.title;
  $('#base-meta').textContent = [b.category, b.res ? `${b.res} m/pixel` : '', b.year ? yearLabel(b) : ''].filter(Boolean).join(' · ');
  const steps = stepSets();
  const i = steps.findIndex(s => s.id === state.imagery.base);
  $('#year-pos').textContent = steps.length ? (i >= 0 ? `${i + 1} of ${steps.length} here` : `${steps.length} sets here`) : '';
  $('#year-prev').disabled = !steps.length || i === 0;
  $('#year-next').disabled = !steps.length || i === steps.length - 1;
}

function setBase(id) {
  state.imagery.base = id;
  syncMap();
  renderImageryList();
  refreshCredits();
}

function step(dir) {
  const steps = stepSets();
  if (!steps.length) return;
  let i = steps.findIndex(s => s.id === state.imagery.base);
  i = i < 0 ? (dir < 0 ? steps.length - 1 : 0) : Math.max(0, Math.min(steps.length - 1, i + dir));
  setBase(steps[i].id);
  toast(steps[i].title, 1800);
}

$('#imagery-list').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) setBase(b.dataset.id); });
$('#year-chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { yearFilter = b.dataset.d; renderImageryList(); } });
$('#show-scanned').addEventListener('change', renderImageryList);
$('#year-prev').addEventListener('click', () => step(-1));
$('#year-next').addEventListener('click', () => step(1));

loadCatalog().then(c => { catalog = c; renderImageryList(); refreshCredits(); })
  .catch(err => { $('#imagery-list').innerHTML = `<li class="muted small" style="padding:10px">Couldn’t load LINZ catalogue (${esc(err.message)}).</li>`; });

// Sliders and toggles bound straight to state.
function bind(sel, obj, prop, { num = false, check = false, after } = {}) {
  const el = $(sel);
  const get = () => (check ? el.checked : num ? parseFloat(el.value) : el.value);
  const set = () => { if (check) el.checked = !!obj()[prop]; else el.value = obj()[prop]; };
  set();
  el.addEventListener(check || el.tagName === 'SELECT' ? 'change' : 'input', () => { obj()[prop] = get(); after ? after() : syncMap(); });
  return set;
}
const IMG = () => state.imagery, TER = () => state.terrain, PR = () => state.print;
const setters = [
  bind('#img-opacity', IMG, 'opacity', { num: true }),
  bind('#img-brightness', IMG, 'brightness', { num: true }),
  bind('#img-contrast', IMG, 'contrast', { num: true }),
  bind('#img-saturation', IMG, 'saturation', { num: true }),
  bind('#img-fill', IMG, 'fillGaps', { check: true }),
  bind('#t-hillshade', TER, 'hillshade', { check: true }),
  bind('#t-hillshade-strength', TER, 'hillshadeStrength', { num: true }),
  bind('#t-contours', TER, 'contours', { check: true }),
  bind('#t-contour-color', TER, 'contourColor'),
  bind('#t-contour-opacity', TER, 'contourOpacity', { num: true }),
  bind('#t-labels', TER, 'labels', { check: true }),
];
// ---- Place labels -----------------------------------------------------------------------
function renderPlaceEditor() {
  const P = state.places;
  const fontOpts = cur => FONTS.map(f => `<option ${f === cur ? 'selected' : ''}>${f}</option>`).join('');
  $('#place-cats').innerHTML = PLACE_CATS.map(c => {
    const st = P.cats[c.k];
    return `<div class="pcat ${st.on ? '' : 'off'}" data-cat="${c.k}">
      <label class="check"><input type="checkbox" data-p="on" ${st.on ? 'checked' : ''}> ${c.label}</label>
      <div class="pcat__row">
        <input type="color" data-p="color" value="${st.color}" title="Colour">
        <input type="number" data-p="size" min="6" max="40" step="0.5" value="${st.size}" title="Size (px)">
        <select data-p="font" title="Font">${fontOpts(st.font)}</select>
        <label class="caps" title="Capitals"><input type="checkbox" data-p="caps" ${st.caps ? 'checked' : ''}>AA</label>
      </div>
    </div>`;
  }).join('');
  $('#place-halo').value = P.halo;
  $('#place-halo-w').value = P.haloWidth;
}
$('#place-cats').addEventListener('input', e => {
  const el = e.target, row = el.closest('[data-cat]');
  if (!row || !el.dataset.p) return;
  const st = state.places.cats[row.dataset.cat];
  st[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (parseFloat(el.value) || st.size) : el.value;
  row.classList.toggle('off', !st.on);
  syncMap();
});
$('#place-halo').addEventListener('input', e => { state.places.halo = e.target.value; syncMap(); });
$('#place-halo-w').addEventListener('input', e => { state.places.haloWidth = parseFloat(e.target.value); syncMap(); });
$('#t-labels').addEventListener('change', () => { $('#place-editor').hidden = !state.terrain.labels; });

$('#img-reset').addEventListener('click', () => {
  Object.assign(state.imagery, { opacity: 1, brightness: 0, contrast: 0, saturation: 0 });
  setters.forEach(s => s()); syncMap();
});

// ---- Trail layers ------------------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderPresetGrid() {
  const groups = {};
  for (const [id, p] of Object.entries(PRESETS)) if (id !== 'file') (groups[p.group] ||= []).push([id, p]);
  $('#preset-grid').innerHTML = Object.entries(groups).map(([g, items]) => `
    <h3>${esc(g)} <span class="muted small" style="text-transform:none;letter-spacing:0">· ${[...new Set(items.map(([, p]) => LICENCES[p.source].licence))].join(' / ')}, commercial OK</span></h3>
    <div class="preset-grid">${items.map(([id, p]) => `
      <button type="button" class="preset" data-preset="${id}">
        <i style="background:${p.kind === 'roads' ? `linear-gradient(90deg,${p.style.hwyColor} 50%,#999 50%)` : p.style.colorBy === 'grade' ? `linear-gradient(90deg,${GRADES.slice(0, 4).map(g => g.color).join(',')})` : p.style.color};${p.style.color === '#ffffff' || p.style.color === '#f5f5f5' ? 'outline:1px solid #999' : ''}"></i>
        <span><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></span>
      </button>`).join('')}</div>`).join('');
}
renderPresetGrid();

$('#btn-add-layer').addEventListener('click', () => $('#dlg-add').showModal());
$('#preset-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  $('#dlg-add').close();
  addLayer(b.dataset.preset);
});

function addLayer(presetId, extra = {}) {
  const p = PRESETS[presetId];
  const L = {
    id: uid(), preset: presetId, name: p.name, source: p.source, kind: p.kind, visible: true,
    style: { ...clone(p.style), labelFont: state.labelFont }, data: null, status: 'empty', expanded: false,
    query: p.custom ? p.query : undefined, attribution: '', ...extra,
  };
  if (L.kind === 'roads') { L.style.labelFont = 'Open Sans Regular'; state.layers.push(L); } else state.layers.unshift(L);
  renderLayers(); syncMap(); refreshCredits();
  if (L.source === 'osm' || L.source === 'doc') loadLayer(L);
  else if (L.source === 'linz' && L.kind !== 'roads') toast('LINZ tracks show from zoom ~12 — zoom in if you don’t see them.');
  return L;
}

function fetchBbox() {
  let b = viewBbox();
  if (state.print.frame) {
    const f = boundsOf(map, printGeometry(map, state.print));
    b = [Math.min(b[0], f[0]), Math.min(b[1], f[1]), Math.max(b[2], f[2]), Math.max(b[3], f[3])];
  }
  return b;
}

const controllers = new Map();
async function loadLayer(L) {
  const b = fetchBbox();
  const area = (b[2] - b[0]) * (b[3] - b[1]);
  if (area > 3) { L.status = 'error'; L.error = 'Area too big — zoom in to load'; renderLayers(); return; }
  controllers.get(L.id)?.abort();
  const ctl = new AbortController();
  controllers.set(L.id, ctl);
  L.status = 'loading'; L.error = null; renderLayers();
  try {
    const p = PRESETS[L.preset];
    const data = L.source === 'osm' ? await fetchOSM(L.query || p.query, b, ctl.signal) : await fetchDOC(p.service, b, ctl.signal);
    L.data = data; L.status = 'ok'; L.loadedBbox = b;
    if (!data.features.length) toast(`${L.name}: nothing found here`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    L.status = 'error'; L.error = err.message;
  } finally {
    if (controllers.get(L.id) === ctl) controllers.delete(L.id);
  }
  renderLayers(); syncMap();
}

$('#btn-reload-all').addEventListener('click', () => state.layers.filter(l => l.source === 'osm' || l.source === 'doc').forEach(loadLayer));

$('#file-input').addEventListener('change', async e => {
  for (const file of e.target.files) {
    try {
      const { data, kind } = await parseFile(file);
      const L = addLayer('file', { name: file.name.replace(/\.[^.]+$/, ''), kind, data, status: 'ok' });
      if (kind === 'point') L.style = { ...clone(PRESETS['osm-huts'].style), color: '#a020f0', icon: 'circle', labelFont: state.labelFont };
      syncMap(); renderLayers();
      const bb = bboxOf(data);
      if (bb) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, maxZoom: 15 });
    } catch (err) { toast(`${file.name}: ${err.message}`); }
  }
  e.target.value = '';
  $('#dlg-add').close();
});

const ICON = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8"/></svg>',
};

function swatch(L) {
  const s = L.style;
  if (L.kind === 'roads') return `<svg class="layer__sw" viewBox="0 0 26 14" style="background:#8a8f7a"><line x1="0" y1="7" x2="13" y2="7" stroke="${s.casingColor}" stroke-width="7"/><line x1="0" y1="7" x2="13" y2="7" stroke="${s.hwyColor}" stroke-width="5"/><line x1="13" y1="7" x2="26" y2="7" stroke="${s.casingColor}" stroke-width="5"/><line x1="13" y1="7" x2="26" y2="7" stroke="${s.color}" stroke-width="3"/></svg>`;
  if (L.kind === 'point') return `<span class="layer__sw" style="display:grid;place-items:center"><i style="width:12px;height:12px;border-radius:50%;background:${s.color};box-shadow:0 0 0 2px ${s.casing ? s.casingColor : 'transparent'},0 0 0 3px rgba(0,0,0,.2)"></i></span>`;
  const col = s.colorBy === 'grade' ? GRADES.slice(0, 4).map(g => g.color) : [s.color];
  const dash = DASHES[s.dash];
  const w = Math.min(6, s.width + 1);
  const da = dash ? `stroke-dasharray="${dash.map(v => Math.max(v, 0.3) * w).join(' ')}"` : '';
  const lines = col.map((c, i) => `<line x1="${i * 26 / col.length}" y1="7" x2="${(i + 1) * 26 / col.length}" y2="7" stroke="${c}" stroke-width="${w}" ${da} stroke-linecap="${dash && s.dash.includes('dot') ? 'round' : 'butt'}"/>`).join('');
  const stripe = (L.source === 'osm' || L.source === 'file') && s.bike === 'side' ? `<line x1="0" y1="${Math.min(13, 7 + w / 2 + 2.2)}" x2="26" y2="${Math.min(13, 7 + w / 2 + 2.2)}" stroke="${s.bikeColor}" stroke-width="2"/>` : '';
  return `<svg class="layer__sw" viewBox="0 0 26 14" style="background:#8a8f7a">${s.casing ? `<line x1="0" y1="7" x2="26" y2="7" stroke="${s.casingColor}" stroke-width="${w + 3}"/>` : ''}${lines}${stripe}</svg>`;
}

function statusText(L) {
  if (L.status === 'loading') return '<span><i class="spin"></i> Loading…</span>';
  if (L.status === 'error') return `<span class="err">${esc(L.error)}</span>`;
  if (L.source === 'linz') return '<span>LINZ · whole country, instant</span>';
  if (L.data) return `<span>${L.data.features.length.toLocaleString()} features · ${LICENCES[L.source].name}</span>`;
  return '<span>Not loaded</span>';
}

function layerBody(L) {
  const s = L.style;
  const p = PRESETS[L.preset];
  const opt = (v, cur, label = v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  const mm = v => (v * 25.4 / 96).toFixed(2);
  let h = `<label class="row">Name <input type="text" data-k="name" value="${esc(L.name)}"></label>`;
  if (L.kind === 'roads') {
    h += `<div class="row">Show <div class="road-classes">${ROAD_CLASSES.slice().reverse().map(c => `<label class="check"><input type="checkbox" data-c="${c.k}" ${s.classes[c.k] ? 'checked' : ''}> ${c.label}</label>`).join('')}</div></div>
      <div class="row">Highways <input type="color" data-s="hwyColor" value="${s.hwyColor}"></div>
      <div class="row">Roads <input type="color" data-s="color" value="${s.color}"></div>
      <div class="row">Gravel <div class="split"><input type="color" data-s="gravelColor" value="${s.gravelColor}"><label class="check"><input type="checkbox" data-s="gravelDash" ${s.gravelDash ? 'checked' : ''}> dashed</label></div></div>
      <label class="row">Width <span class="split"><input type="range" data-s="width" data-num min="0.4" max="6" step="0.1" value="${s.width}"><span class="muted small" data-mm>${mm(s.width)} mm</span></span></label>
      <div class="row">Casing <div class="split"><input type="checkbox" data-s="casing" ${s.casing ? 'checked' : ''}><input type="color" data-s="casingColor" value="${s.casingColor}"><input type="range" data-s="casingWidth" data-num min="0.25" max="3" step="0.25" value="${s.casingWidth}"></div></div>`;
  } else if (L.kind !== 'point') {
    h += `<div class="row">Colour <div class="split"><input type="color" data-s="color" value="${s.color}">
      ${p.grades || L.source === 'file' ? `<select data-s="colorBy">${opt('single', s.colorBy, 'Single colour')}${opt('grade', s.colorBy, 'By difficulty')}</select>` : ''}</div></div>
      <label class="row">Width <span class="split"><input type="range" data-s="width" data-num min="0.5" max="8" step="0.1" value="${s.width}"><span class="muted small" data-mm>${mm(s.width)} mm</span></span></label>
      <label class="row">Line <select data-s="dash">${Object.keys(DASHES).map(d => opt(d, s.dash, { solid: 'Solid', dash: 'Dashed', longdash: 'Long dash', dot: 'Dotted', dashdot: 'Dash-dot' }[d])).join('')}</select></label>
      <div class="row">Halo <div class="split"><input type="checkbox" data-s="casing" ${s.casing ? 'checked' : ''}><input type="color" data-s="casingColor" value="${s.casingColor}"><input type="range" data-s="casingWidth" data-num min="0.5" max="4" step="0.25" value="${s.casingWidth}"></div></div>`;
  } else {
    h += `<div class="row">Colour <div class="split"><input type="color" data-s="color" value="${s.color}">
      <select data-s="icon">${opt('circle', s.icon, 'Dot')}${opt('hut', s.icon, 'Hut')}${opt('peak', s.icon, 'Peak')}</select></div></div>
      <label class="row">Size <input type="range" data-s="size" data-num min="2" max="16" step="0.5" value="${s.size}"></label>
      <div class="row">Outline <div class="split"><input type="checkbox" data-s="casing" ${s.casing ? 'checked' : ''}><input type="color" data-s="casingColor" value="${s.casingColor}"></div></div>`;
  }
  if (L.kind === 'line' && (L.source === 'osm' || L.source === 'file')) {
    h += `<label class="row">Show <select data-s="show">${opt('all', s.show || 'all', 'Everything')}${opt('bike', s.show, 'Bike-friendly only')}${opt('walk', s.show, 'Walkable only')}</select></label>
      <div class="row">Bike-friendly <div class="split"><select data-s="bike">${opt('none', s.bike || 'none', 'No highlight')}${opt('side', s.bike, 'Stripe alongside')}${opt('color', s.bike, 'Recolour trail')}</select><input type="color" data-s="bikeColor" value="${s.bikeColor || '#ffd400'}"></div></div>
      ${p.combined ? `<label class="check"><input type="checkbox" data-s="hideRoads" ${s.hideRoads ? 'checked' : ''}> Hide road sections of cycle routes</label>` : ''}`;
  }
  h += `<label class="row">Opacity <input type="range" data-s="opacity" data-num min="0.1" max="1" step="0.05" value="${s.opacity}"></label>
    <div class="row">Labels <div class="split"><input type="checkbox" data-s="labels" ${s.labels ? 'checked' : ''}><input type="color" data-s="labelColor" value="${s.labelColor}"><input type="range" data-s="labelSize" data-num min="7" max="24" step="0.5" value="${s.labelSize}" title="Label size"></div></div>`;
  if (L.source === 'osm' && p.custom) {
    h += `<label class="stack">Overpass query (use {{bbox}})<textarea data-k="query" rows="4">${esc(L.query)}</textarea></label>`;
  }
  if (L.source === 'file') {
    h += `<label class="stack">Credit for this data <input type="text" data-k="attribution" value="${esc(L.attribution)}" placeholder="e.g. GPS data © Your Name"></label>`;
  }
  const lic = LICENCES[L.source];
  h += `<p class="layer__src">${esc(lic.name)} · ${esc(lic.licence)}${L.loadedBbox ? ' · loaded for previous view' : ''}</p><div class="split" style="margin-top:8px">`;
  if (L.source === 'osm' || L.source === 'doc') h += `<button type="button" class="btn small" data-act="reload">Reload for this area</button>`;
  if (L.data) h += `<button type="button" class="btn ghost small" data-act="geojson" title="${L.source === 'osm' ? 'OSM data is ODbL: if you share or sell this file it must stay ODbL and credit OpenStreetMap contributors' : 'Keep the source credit with the data'}">Download GeoJSON</button>`;
  h += '</div>';
  return h;
}

function renderLayers() {
  const ul = $('#layer-list');
  $('#layers-empty').hidden = state.layers.length > 0;
  const c = state.layers.length;
  $('#layer-count').hidden = !c; $('#layer-count').textContent = c;
  ul.innerHTML = state.layers.map((L, i) => `
    <li class="layer ${L.visible ? '' : 'off'}" data-id="${L.id}">
      <div class="layer__head">
        <button type="button" class="mini" data-act="vis" title="Show/hide">${L.visible ? ICON.eye : ICON.eyeOff}</button>
        ${swatch(L)}
        <div class="layer__name"><b>${esc(L.name)}</b>${statusText(L)}</div>
        <div class="layer__btns">
          <button type="button" class="mini" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button type="button" class="mini" data-act="down" title="Move down" ${i === c - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button type="button" class="mini" data-act="edit" title="Style">${ICON.gear}</button>
          <button type="button" class="mini" data-act="del" title="Remove">${ICON.x}</button>
        </div>
      </div>
      ${L.expanded ? `<div class="layer__body">${layerBody(L)}</div>` : ''}
    </li>`).join('');
}

const layerOf = el => state.layers.find(l => l.id === el.closest('.layer')?.dataset.id);

$('#layer-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const L = layerOf(b);
  const i = state.layers.indexOf(L);
  switch (b.dataset.act) {
    case 'vis': L.visible = !L.visible; break;
    case 'up': if (i > 0) [state.layers[i - 1], state.layers[i]] = [state.layers[i], state.layers[i - 1]]; break;
    case 'down': if (i < state.layers.length - 1) [state.layers[i + 1], state.layers[i]] = [state.layers[i], state.layers[i + 1]]; break;
    case 'edit': L.expanded = !L.expanded; renderLayers(); return;
    case 'del': controllers.get(L.id)?.abort(); state.layers.splice(i, 1); refreshCredits(); break;
    case 'reload': loadLayer(L); return;
    case 'geojson': download(new Blob([JSON.stringify(L.data)], { type: 'application/geo+json' }), `${L.name}.geojson`); return;
  }
  renderLayers(); syncMap();
});

$('#layer-list').addEventListener('input', e => {
  const el = e.target;
  const L = layerOf(el);
  if (!L) return;
  if (el.dataset.k) {
    L[el.dataset.k] = el.value;
    if (el.dataset.k === 'name') el.closest('.layer').querySelector('.layer__name b').textContent = el.value;
    if (el.dataset.k === 'attribution') refreshCredits();
    save(); return;
  }
  if (el.dataset.c) { L.style.classes[el.dataset.c] = el.checked; el.closest('.layer').querySelector('.layer__sw').outerHTML = swatch(L); syncMap(); return; }
  const k = el.dataset.s;
  if (!k) return;
  L.style[k] = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? parseFloat(el.value) : el.value;
  if (k === 'width') el.parentElement.querySelector('[data-mm]').textContent = `${(L.style.width * 25.4 / 96).toFixed(2)} mm`;
  el.closest('.layer').querySelector('.layer__sw').outerHTML = swatch(L);
  syncMap();
});
$('#layer-list').addEventListener('change', e => { if (e.target.dataset.k === 'query') { const L = layerOf(e.target); loadLayer(L); } });

// ---- Print frame & settings ----------------------------------------------------------------

function updateFrame() {
  const el = $('#frame');
  const shade = $('#shade');
  if (!state.print.frame) { el.hidden = true; shade.toggleAttribute('hidden', true); return; }
  const g = printGeometry(map, state.print);
  const f = g.frame;
  const bp = f.bleedPx;
  el.hidden = false; shade.toggleAttribute('hidden', false);
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
  shade.querySelector('path').setAttribute('d', `M0 0H${W}V${H}H0Z M${f.x} ${f.y}h${f.w}v${f.h}h${-f.w}Z`);
  Object.assign(el.style, { left: `${f.x + bp}px`, top: `${f.y + bp}px`, width: `${f.w - bp * 2}px`, height: `${f.h - bp * 2}px` });
  const bl = el.querySelector('.frame__bleed');
  bl.hidden = !bp;
  Object.assign(bl.style, { left: `${-bp}px`, top: `${-bp}px`, right: `${-bp}px`, bottom: `${-bp}px` });
  const { w, h } = paperSize(state.print);
  el.querySelector('.frame__label').textContent = `${state.print.paper === 'custom' ? `${w}×${h} mm` : state.print.paper} ${state.print.orientation} · 1:${Math.round(g.scale).toLocaleString('en-NZ')}`;
  if (!$('#tab-print').hidden) updateSummary(g);
}

function updateSummary(g = printGeometry(map, state.print)) {
  const p = state.print;
  const mb = (g.devW * g.devH * 4 / 1e6);
  const warn = g.devW * g.devH > 250e6 ? '<div class="warn">Too large for the browser — lower DPI or paper size.</div>'
    : mb > 400 ? '<div class="warn">Big render — may take a few minutes and lots of memory.</div>' : '';
  const base = findBase(catalog, state.imagery.base);
  const ground = (g.scale * 25.4 / p.dpi / 1000);
  const imgNote = base.res && ground < base.res * 0.5 ? `<div class="warn">Imagery is ${base.res} m/px; at this scale you’re printing ${ground.toFixed(2)} m/px — expect softness. Try a smaller scale number or newer imagery.</div>` : '';
  $('#p-summary').innerHTML = `
    <b>${g.devW.toLocaleString()} × ${g.devH.toLocaleString()} px</b> at ${p.dpi} dpi<br>
    Scale <b>1:${Math.round(g.scale).toLocaleString('en-NZ')}</b> · covers ${(g.groundW / 1000).toFixed(2)} × ${(g.groundH / 1000).toFixed(2)} km<br>
    Sheet ${g.paper.w}×${g.paper.h} mm${g.paper.bleed ? ` + ${g.paper.bleed} mm bleed` : ''}${warn}${imgNote}`;
  $('#p-scale-hint').textContent = p.scaleMode === 'fit' ? `Frame fits your screen. Zoom the map to change scale (now 1:${Math.round(g.scale).toLocaleString('en-NZ')}).` : 'Pan the map to move the frame. 1 cm on paper = ' + (p.scale / 100000).toFixed(p.scale < 100000 ? 2 : 1) + ' km.';
}

const printSetters = [
  bind('#p-paper', PR, 'paper', { after: printChanged }),
  bind('#p-orientation', PR, 'orientation', { after: printChanged }),
  bind('#p-cw', PR, 'customW', { num: true, after: printChanged }),
  bind('#p-ch', PR, 'customH', { num: true, after: printChanged }),
  bind('#p-dpi', PR, 'dpi', { num: true, after: printChanged }),
  bind('#p-bleed', PR, 'bleed', { num: true, after: printChanged }),
  bind('#p-scale', PR, 'scale', { num: true, after: printChanged }),
  bind('#p-title', PR, 'title', { after: save }),
  bind('#p-subtitle', PR, 'subtitle', { after: save }),
  bind('#p-font', PR, 'titleFont', { after: save }),
  bind('#p-show-title', PR, 'showTitle', { check: true, after: save }),
  bind('#p-show-legend', PR, 'showLegend', { check: true, after: save }),
  bind('#p-show-scale', PR, 'showScale', { check: true, after: save }),
  bind('#p-show-north', PR, 'showNorth', { check: true, after: save }),
  bind('#p-show-attr', PR, 'showAttribution', { check: true, after: save }),
  bind('#p-show-crop', PR, 'showCropMarks', { check: true, after: save }),
  bind('#p-format', PR, 'format', { after: save }),
  bind('#p-publisher', PR, 'publisher', { after: updateFinePreview }),
  bind('#p-show-fine', PR, 'showFinePrint', { check: true, after: updateFinePreview }),
  bind('#p-safety', PR, 'safety', { check: true, after: updateFinePreview }),
  bind('#p-world', PR, 'worldFile', { check: true, after: save }),
];
function printChanged() {
  $('#p-custom').hidden = state.print.paper !== 'custom';
  $('#p-scale-row').hidden = state.print.scaleMode !== 'fixed';
  document.querySelectorAll('[name=scale-mode]').forEach(r => { r.checked = r.value === state.print.scaleMode; });
  $('#btn-frame').setAttribute('aria-pressed', state.print.frame);
  if (state.print.scaleMode === 'fixed' && state.print.frame && map.loaded()) {
    // Keep the whole sheet on screen when its size/scale changes.
    const f = printGeometry(map, state.print).frame, el = map.getContainer();
    const tooBig = f.w > el.clientWidth - 80 || f.h > el.clientHeight - 80;
    const tooSmall = f.w < el.clientWidth * 0.3 && f.h < el.clientHeight * 0.3;
    if (tooBig || tooSmall) fitFrame();
  }
  updateFrame(); updateSummary(); save();
}
document.querySelectorAll('[name=scale-mode]').forEach(r => r.addEventListener('change', () => {
  if (r.value === 'fixed' && state.print.scaleMode === 'fit') {
    state.print.scale = niceScale(printGeometry(map, state.print).scale);
    $('#p-scale').value = state.print.scale;
  }
  state.print.scaleMode = r.value; printChanged();
}));
$('#p-lock').addEventListener('click', () => {
  state.print.scale = niceScale(printGeometry(map, state.print).scale);
  state.print.scaleMode = 'fixed';
  $('#p-scale').value = state.print.scale;
  printChanged();
});
function fitFrame() {
  const g = printGeometry(map, state.print);
  const el = map.getContainer();
  const k = Math.min((el.clientWidth - 112) / g.frame.w, (el.clientHeight - 112) / g.frame.h);
  map.easeTo({ zoom: Math.min(20, map.getZoom() + Math.log2(k)), duration: 300 });
}
$('#btn-frame').addEventListener('click', () => { state.print.frame = !state.print.frame; printChanged(); });
$('#btn-panel').addEventListener('click', () => { document.body.classList.toggle('panel-hidden'); setTimeout(() => { map.resize(); updateFrame(); }, 220); });
$('#p-credits').addEventListener('input', e => { state.print.credits = e.target.value; state.print.creditsEdited = true; save(); });
$('#p-credits-auto').addEventListener('click', () => { state.print.creditsEdited = false; refreshCredits(); });

// ---- Fine print -------------------------------------------------------------------------------
function finePrintText() {
  const p = state.print, img = state.imagery;
  if (!p.showFinePrint) return '';
  const adjusted = img.brightness || img.contrast || img.saturation || img.opacity < 1;
  const srcs = activeSources();
  const out = [];
  out.push(`${p.publisher ? `Map © ${new Date().getFullYear()} ${p.publisher}. ` : ''}Compiled from the credited sources; data has been modified (cropped, re-projected, restyled${adjusted ? ', colour-adjusted' : ''}). No endorsement by any data provider is implied. Licences: CC BY 4.0 creativecommons.org/licenses/by/4.0${srcs.includes('osm') ? ' · ODbL openstreetmap.org/copyright' : ''}.`);
  if (p.safety) out.push('Tracks, closures and access change: check DOC and local alerts before you go. Not a navigation device; use at your own risk.');
  return out.join(' ');
}
function updateFinePreview() { $('#p-fine-preview').textContent = finePrintText(); save(); }

// ---- Credits / licences -------------------------------------------------------------------------

const providerCache = new Map();
async function imageryProviders(id) {
  if (providerCache.has(id)) return providerCache.get(id);
  if (id.startsWith('eox')) return [];
  const p = fetch(`${BASEMAPS}/v1/tiles/${id}/WebMercatorQuad/attribution.json?api=${key}`)
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (!j || id === 'aerial') return [];
      const names = new Set();
      for (const c of j.collections || []) for (const pr of c.providers || []) {
        if (pr.roles?.some(r => r === 'licensor' || r === 'producer') && !/Land Information New Zealand/.test(pr.name)) names.add(pr.name);
      }
      return [...names];
    }).catch(() => []);
  providerCache.set(id, p);
  return p;
}

function activeSources() {
  const s = new Set(['linz']);
  if (state.imagery.base.startsWith('eox')) s.add('eox');
  for (const L of state.layers) if (L.visible) s.add(L.source);
  return [...s];
}

async function buildCredits() {
  const base = findBase(catalog, state.imagery.base);
  const providers = await imageryProviders(state.imagery.base);
  const parts = [];
  if (base.licence === 'eox') parts.push(LICENCES.eox.credit);
  else {
  const imgName = base.id === 'aerial' ? 'LINZ aerial imagery basemap' : base.title;
  parts.push(`Imagery: ${imgName}${providers.length ? ` (${providers.join(', ')})` : ''} – Toitū Te Whenua LINZ, CC BY 4.0`);
  }
  const srcs = activeSources();
  if (state.terrain.contours || state.terrain.labels || state.terrain.hillshade || state.layers.some(l => l.visible && l.source === 'linz')) parts.push('Topographic data: LINZ, CC BY 4.0');
  if (srcs.includes('osm')) parts.push('© OpenStreetMap contributors (ODbL)');
  if (srcs.includes('doc')) parts.push('Department of Conservation, CC BY 4.0');
  for (const L of state.layers) if (L.visible && L.source === 'file' && L.attribution) parts.push(L.attribution);
  return parts.join(' · ');
}

async function refreshCredits() {
  const text = await buildCredits();
  if ($('#p-fine-preview')) $('#p-fine-preview').textContent = finePrintText();
  if (!state.print.creditsEdited) { state.print.credits = text; $('#p-credits').value = text; save(); }
  updateAttribution(text);
}

function updateAttribution(text) {
  const srcs = activeSources();
  const html = ['<a href="https://basemaps.linz.govt.nz" target="_blank" rel="noopener">© LINZ CC BY 4.0</a>'];
  if (srcs.includes('osm')) html.push('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>');
  if (srcs.includes('doc')) html.push('DOC CC BY 4.0');
  if (srcs.includes('eox')) html.push('<a href="https://cloudless.eox.at" target="_blank" rel="noopener">Sentinel-2 cloudless 2016 by EOX (Copernicus data)</a>');
  attrib.options.customAttribution = html.join(' | ');
  attrib._updateAttributions?.();
}

$('#btn-credits').addEventListener('click', async () => {
  const srcs = new Set(activeSources());
  const credit = await buildCredits();
  const L = LICENCES;
  const card = (id, body) => `<div class="lic" style="${srcs.has(id) || !L[id] ? '' : 'opacity:.65'}">${body}</div>`;
  const head = id => `<b>${esc(L[id].name)}</b> <span class="tag">${esc(L[id].licence)}</span> ${id !== 'file' ? '<span class="ok">✓ commercial use</span>' : ''} ${srcs.has(id) ? '<span class="tag">in this map</span>' : ''}`;
  $('#credits-body').innerHTML = `
    <p class="small">Every data source here can be used on maps you <b>sell</b>, as long as you meet its terms. The Print tab’s <b>credits line</b> and <b>fine print</b> cover the attribution. Keep both switched on.</p>
    ${card('linz', `${head('linz')}<ul>
      <li>Credit LINZ, plus the council or partner named for the imagery (added for you), and name the licence: CC BY 4.0.</li>
      <li>Say the data was modified. Cropping, restyling and colour changes all count, and the fine print says so.</li>
      <li>Don’t suggest LINZ endorses your map, and don’t use the LINZ or Toitū Te Whenua logos.</li>
      <li>Basemaps API: free, fair use. Use your own permanent key for a public or commercial site (Settings).</li>
      <li>Place names come from the NZ Gazetteer. Keep official spellings and macrons.</li></ul>
      <p><a href="https://www.linz.govt.nz/products-services/data/licensing-and-using-data/attributing-linz-data" target="_blank" rel="noopener">Attributing LINZ data</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p>`)}
    ${card('osm', `${head('osm')}<ul>
      <li>A printed map is a “Produced Work”. Show “© OpenStreetMap contributors” where people will see it. Adding openstreetmap.org/copyright is recommended (in the fine print).</li>
      <li>Selling prints doesn’t trigger share-alike. Sharing or selling the <i>data</i> does: a GeoJSON export, or the trail database in an app, must stay ODbL.</li>
      <li>Overpass and Nominatim are free community servers. Light, interactive use only. No bulk scraping, and don’t point a busy public site at them (pre-built tiles fix this).</li></ul>
      <p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM copyright</a> · <a href="https://osmfoundation.org/wiki/Licence/Attribution_Guidelines" target="_blank" rel="noopener">Attribution guidelines</a> · <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener">Nominatim policy</a></p>`)}
    ${card('doc', `${head('doc')}<ul>
      <li>Credit the Department of Conservation and CC BY 4.0. Data is supplied as-is.</li>
      <li>Track status changes often. Check closures before printing (the safety note covers buyers).</li>
      <li>Don’t use DOC logos or imply DOC approves your map.</li></ul>`)}
    ${card('eox', `${head('eox')}<ul>
      <li>Only the 2016 mosaic is offered, because it’s CC BY 4.0. Use the exact credit (added automatically).</li>
      <li>EOX’s 2017+ mosaics are CC BY-NC-SA, so commercial use needs a paid EOX licence.</li></ul>`)}
    ${card('file', `${head('file')}<ul>
      <li>Upload only data you created or are licensed to sell. Strava, Trailforks, AllTrails and Google data are not.</li>
      <li>Add a credit line for any third-party data in the layer’s settings.</li></ul>`)}
    <h3>Credit line for this map</h3>
    <p class="small" style="background:var(--soft);padding:10px;border-radius:8px">${esc(credit)}</p>
    <h3>Fine print for this map</h3>
    <p class="small" style="background:var(--soft);padding:10px;border-radius:8px">${esc(finePrintText() || '(switched off on the Print tab)')}</p>
    <h3>Software &amp; fonts</h3>
    <p class="small muted">MapLibre GL JS © MapLibre contributors (BSD-3-Clause) · jsPDF (MIT) · Open Sans &amp; Roboto label fonts, served by LINZ (Apache 2.0) · Barlow, Inter and Cormorant Garamond (SIL Open Font Licence 1.1). All allow commercial use, and the fonts can be embedded in images and PDFs you sell.</p>
    <h3>Disclaimer</h3>
    <p class="small muted">This tool, and the data it pulls in, come with no warranty of accuracy or fitness for any purpose. These notes summarise each licence as published (checked November 2026). They aren’t legal advice, and licences can change, so recheck the links before a big print run.</p>`;
  $('#dlg-credits').showModal();
});

// ---- Settings ------------------------------------------------------------------------------------

$('#s-font').innerHTML = FONTS.map(f => `<option>${f}</option>`).join('');
$('#btn-settings').addEventListener('click', () => {
  $('#s-key').value = isCustomKey() ? key : '';
  $('#s-font').value = state.labelFont;
  $('#dlg-settings').showModal();
});
$('#s-save').addEventListener('click', () => {
  setCustomKey($('#s-key').value.trim());
  const newKey = getKey();
  state.labelFont = $('#s-font').value;
  state.layers.forEach(l => { l.style.labelFont = state.labelFont; });
  if (newKey !== key) { save(); setTimeout(() => location.reload(), 450); return; }
  syncMap();
});

// ---- Project files --------------------------------------------------------------------------------

$('#btn-project').addEventListener('click', () => $('#dlg-project').showModal());
$('#proj-save').addEventListener('click', () => {
  const c = map.getCenter();
  state.view = { center: [c.lng, c.lat], zoom: map.getZoom() };
  const data = { app: 'trail-map-studio', version: 1, saved: new Date().toISOString(), state: { ...state, layers: state.layers.map(({ status, error, ...l }) => l) } };
  const name = (state.print.title || 'trail-map').replace(/[^\w-]+/g, '-').toLowerCase();
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${name}.tmap.json`);
});
$('#proj-open').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'trail-map-studio') throw new Error('Not a Trail Map Studio project');
    loadState(j.state);
    $('#dlg-project').close();
    toast('Project opened');
  } catch (err) { toast(err.message); }
  e.target.value = '';
});
$('#proj-new').addEventListener('click', () => {
  if (!confirm('Clear all layers and settings?')) return;
  const view = state.view;
  loadState({ ...clone(DEFAULTS), view });
  $('#dlg-project').close();
});

function loadState(s) {
  state = merge(clone(DEFAULTS), s);
  state.layers.forEach(l => { l.status = l.data ? 'ok' : 'empty'; l.error = null; });
  map.jumpTo({ center: state.view.center, zoom: state.view.zoom });
  setters.forEach(x => x()); printSetters.forEach(x => x()); renderPlaceEditor();
  $('#place-editor').hidden = !state.terrain.labels;
  $('#p-credits').value = state.print.credits;
  renderLayers(); syncMap(); renderImageryList(); printChanged(); refreshCredits();
}

// ---- Search (OSM Nominatim) -----------------------------------------------------------------------

let searchTimer;
$('#search').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
$('#search-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 600); });
async function doSearch() {
  const q = $('#search-q').value.trim();
  const ul = $('#search-results');
  if (q.length < 3) { ul.hidden = true; return; }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=nz&q=${encodeURIComponent(q)}`);
    const res = await r.json();
    ul.innerHTML = res.map(x => `<li><button type="button" data-bb="${x.boundingbox.join(',')}">${esc(x.display_name)}</button></li>`).join('') || '<li class="muted small" style="padding:6px">No results</li>';
    ul.hidden = false;
  } catch { ul.hidden = true; }
}
$('#search-results').addEventListener('click', e => {
  const b = e.target.closest('[data-bb]');
  if (!b) return;
  const [s, n, w, ea] = b.dataset.bb.split(',').map(Number);
  map.fitBounds([[w, s], [ea, n]], { padding: 40, maxZoom: 14 });
  $('#search-results').hidden = true;
});
document.addEventListener('click', e => { if (!e.target.closest('#search')) $('#search-results').hidden = true; });

// ---- Export ------------------------------------------------------------------------------------------

let exportCtl = null;
async function runExport({ preview = false } = {}) {
  const geo = printGeometry(map, state.print);
  let st = state;
  if (preview) {
    // Same layout, low DPI, so it renders in seconds.
    const longIn = Math.max(geo.paper.W, geo.paper.H) / 25.4;
    const dpi = Math.max(30, Math.min(150, Math.floor(1400 / longIn)));
    st = { ...state, print: { ...state.print, dpi } };
  }
  const g = preview ? printGeometry(map, st.print) : geo;
  const prog = $('#export-progress');
  const bar = prog.querySelector('.progress__bar');
  const label = prog.querySelector('span');
  prog.hidden = false;
  $('#btn-export').disabled = $('#btn-preview').disabled = true;
  exportCtl = new AbortController();
  const t0 = performance.now();
  try {
    if (!state.print.creditsEdited) await refreshCredits();
    st = { ...st, print: { ...st.print, finePrint: finePrintText() } };
    const canvas = await renderPrint({
      state: st, key, topo, geo: g, signal: exportCtl.signal,
      onProgress: (msg, f) => { label.textContent = msg; bar.style.setProperty('--p', `${Math.round(f * 100)}%`); },
    });
    if (preview) {
      $('#preview-img').src = canvas.toDataURL('image/jpeg', 0.85);
      $('#dlg-preview').showModal();
    } else {
      label.textContent = 'Encoding file…';
      const { blob, ext } = await encode(canvas, st, g);
      const name = `${(state.print.title || 'trail-map').replace(/[^\w-]+/g, '-').toLowerCase()}-${state.print.paper}-${state.print.dpi}dpi`;
      download(blob, `${name}.${ext}`);
      if (state.print.worldFile && ext !== 'pdf') download(new Blob([worldFile(g)], { type: 'text/plain' }), `${name}.${ext === 'png' ? 'pgw' : 'jgw'}`);
      toast(`Exported ${(blob.size / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    }
    canvas.width = canvas.height = 0;
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast(`Export failed: ${err.message}`, 7000); }
  } finally {
    prog.hidden = true;
    $('#btn-export').disabled = $('#btn-preview').disabled = false;
    exportCtl = null;
  }
}
$('#btn-export').addEventListener('click', () => runExport());
$('#btn-preview').addEventListener('click', () => runExport({ preview: true }));
$('#btn-cancel').addEventListener('click', () => exportCtl?.abort());

// ---- Keyboard -------------------------------------------------------------------------------------------

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
  if (e.key === '[') step(-1);
  else if (e.key === ']') step(1);
  else if (e.key === 'f' || e.key === 'F') { state.print.frame = !state.print.frame; printChanged(); }
});

// ---- Init -------------------------------------------------------------------------------------------------

$('#p-credits').value = state.print.credits;
renderPlaceEditor();
$('#place-editor').hidden = !state.terrain.labels;
renderLayers();
updateFinePreview();
printChanged();
refreshCredits();
window.__tm = { get state() { return state; }, syncMap, runExport, addLayer, loadLayer, setBase };
