// LINZ Basemaps: API key handling + imagery catalogue.
// All LINZ Basemaps imagery is CC BY 4.0 (commercial use allowed with attribution).

export const BASEMAPS = 'https://basemaps.linz.govt.nz';
export const GLYPHS = `${BASEMAPS}/v1/fonts/{fontstack}/{range}.pbf`;

const KEY_STORE = 'tm.linzKey';
const ULID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// LINZ Basemaps accepts short-lived "developer" keys: 'c' + a ULID (timestamped).
// This is exactly what basemaps.linz.govt.nz does in your browser. For a
// production/commercial site, request a permanent key from LINZ and paste it in Settings.
function makeDevKey() {
  let t = Date.now(), s = '';
  for (let i = 0; i < 10; i++) { s = ULID[t % 32] + s; t = Math.floor(t / 32); }
  const r = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) s += ULID[r[i] % 32];
  return ('c' + s).toLowerCase();
}

function devKeyAgeDays(key) {
  if (!/^c[0-9a-z]{26}$/.test(key)) return 0;
  let t = 0;
  for (const ch of key.slice(1, 11).toUpperCase()) t = t * 32 + ULID.indexOf(ch);
  return (Date.now() - t) / 86400000;
}

export function getKey() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); } catch { /* ignore */ }
  if (saved && saved.custom && saved.key) return saved.key;
  if (saved && saved.key && devKeyAgeDays(saved.key) < 30) return saved.key;
  const key = makeDevKey();
  try { localStorage.setItem(KEY_STORE, JSON.stringify({ key, custom: false })); } catch { /* ignore */ }
  return key;
}

export function setCustomKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORE, JSON.stringify({ key: key.trim(), custom: true }));
    else localStorage.removeItem(KEY_STORE);
  } catch { /* ignore */ }
}

export function isCustomKey() {
  try { return !!JSON.parse(localStorage.getItem(KEY_STORE) || 'null')?.custom; } catch { return false; }
}

export function tileUrl(layerId, key = getKey(), fmt = 'webp') {
  return `${BASEMAPS}/v1/tiles/${layerId}/WebMercatorQuad/{z}/{x}/{y}.${fmt}?api=${key}`;
}

// Non-LINZ imagery. Only sources licensed for commercial use belong here.
// (EOX's 2017+ Sentinel-2 mosaics are CC BY-NC-SA, so they're deliberately left out.)
export const EXTERNAL = {
  'eox-s2-2016': { tiles: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg', maxzoom: 15 },
};

export function baseSource(id, key, tileSize) {
  const ext = EXTERNAL[id];
  return { type: 'raster', tiles: [ext ? ext.tiles : tileUrl(id, key)], tileSize, maxzoom: ext ? ext.maxzoom : 22 };
}

export function demUrl(key = getKey()) {
  return `${BASEMAPS}/v1/tiles/elevation/WebMercatorQuad/{z}/{x}/{y}.png?pipeline=terrain-rgb&api=${key}`;
}

export function topoVectorUrl(key = getKey()) {
  return `${BASEMAPS}/v1/tiles/topographic/WebMercatorQuad/tile.json?api=${key}`;
}

// ---- Catalogue -----------------------------------------------------------

// Built-in bases that are always offered at the top of the list.
export const FIXED_BASES = [
  { id: 'aerial', short: 'Now', title: 'Latest aerial imagery (whole country)', category: 'Basemap', year: null, res: null, bbox: [165, -48, 179, -34], fixed: true },
  { id: 'eox-s2-2016', short: '2016', title: 'Sentinel-2 cloudless, worldwide (Copernicus / EOX)', category: 'Satellite Imagery', year: 2016, res: 10, bbox: [-180, -85, 180, 85], fixed: true, licence: 'eox' },
  { id: 'nz-topo50-new-zealand-mainland-gridless', short: 'Topo', title: 'NZ Topo50 map (no grid)', category: 'Topographic', year: null, res: null, bbox: [165, -48, 179, -34], fixed: true },
  { id: 'nz-topo250-new-zealand-mainland-gridless', short: 'Topo', title: 'NZ Topo250 map (no grid)', category: 'Topographic', year: null, res: null, bbox: [165, -48, 179, -34], fixed: true },
];

function parseYears(title) {
  const paren = title.match(/\(([^)]*\d{4}[^)]*)\)/g);
  const txt = paren ? paren[paren.length - 1] : title;
  const ys = [...txt.matchAll(/(1[89]\d{2}|20\d{2})/g)].map(m => +m[1]);
  if (!ys.length) return { year: null, yearEnd: null };
  return { year: Math.min(...ys), yearEnd: Math.max(...ys) };
}

function parseRes(id, title) {
  const m = id.match(/-(\d+(?:\.\d+)?)m$/) || title.match(/(\d+(?:\.\d+)?)m\b/);
  return m ? parseFloat(m[1]) : null;
}

const decode = s => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

let catalogPromise = null;
export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const res = await fetch(`${BASEMAPS}/v1/tiles/all/WMTSCapabilities.xml?api=${getKey()}`);
    if (!res.ok) throw new Error(`LINZ catalogue failed (${res.status})`);
    const xml = await res.text();
    const out = [];
    const layerRe = /<Layer>([\s\S]*?)<\/Layer>/g;
    let m;
    while ((m = layerRe.exec(xml))) {
      const body = m[1];
      const id = (body.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/) || [])[1];
      if (!id || id === 'all') continue;
      const title = decode((body.match(/<ows:Title>([^<]*)<\/ows:Title>/) || [])[1] || id);
      const category = decode((body.match(/<ows:Keyword>([^<]*)<\/ows:Keyword>/) || [])[1] || '');
      const bb = body.match(/<ows:WGS84BoundingBox[^>]*>\s*<ows:LowerCorner>([^<]+)<\/ows:LowerCorner>\s*<ows:UpperCorner>([^<]+)<\/ows:UpperCorner>/);
      if (!bb) continue;
      const [w, s] = bb[1].trim().split(/\s+/).map(Number);
      const [e, n] = bb[2].trim().split(/\s+/).map(Number);
      if (category === 'Bathymetry' || category === 'Elevation') continue;
      const { year, yearEnd } = parseYears(title);
      out.push({ id, title, category, year, yearEnd, res: parseRes(id, title), bbox: [w, s, e, n], draft: /draft/i.test(title) });
    }
    out.sort((a, b) => (b.yearEnd || 0) - (a.yearEnd || 0) || (a.res || 99) - (b.res || 99));
    return out;
  })();
  catalogPromise.catch(() => { catalogPromise = null; });
  return catalogPromise;
}

export function findBase(catalog, id) {
  return FIXED_BASES.find(b => b.id === id) || (catalog || []).find(b => b.id === id) || { id, title: id, category: '', bbox: null };
}

export function intersects(bbox, b) {
  return !(bbox[2] < b[0] || bbox[0] > b[2] || bbox[3] < b[1] || bbox[1] > b[3]);
}

// Coverage of view by an imagery bbox (0..1), used to rank sets that fill the screen.
export function coverage(view, b) {
  const w = Math.max(0, Math.min(view[2], b[2]) - Math.max(view[0], b[0]));
  const h = Math.max(0, Math.min(view[3], b[3]) - Math.max(view[1], b[1]));
  const a = (view[2] - view[0]) * (view[3] - view[1]);
  return a > 0 ? (w * h) / a : 0;
}

let topoStylePromise = null;
// Fetch LINZ's own topographic style so we can reuse its contour and place-name layers.
export function loadTopoStyle() {
  if (!topoStylePromise) {
    topoStylePromise = fetch(`${BASEMAPS}/v1/styles/topographic.json?api=${getKey()}`)
      .then(r => { if (!r.ok) throw new Error('LINZ style failed'); return r.json(); });
    topoStylePromise.catch(() => { topoStylePromise = null; });
  }
  return topoStylePromise;
}
