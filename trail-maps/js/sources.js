// Trail data sources. Every source here allows commercial use with attribution.

export const LICENCES = {
  linz: {
    name: 'Toitū Te Whenua LINZ',
    licence: 'CC BY 4.0',
    url: 'https://www.linz.govt.nz/products-services/data/licensing-and-using-data/attributing-linz-data',
    credit: 'Imagery & topographic data: Toitū Te Whenua LINZ and partners, CC BY 4.0',
    note: 'Commercial use allowed. Credit LINZ (and the imagery’s council/partner) on the map.',
  },
  osm: {
    name: 'OpenStreetMap',
    licence: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    credit: 'Trail data © OpenStreetMap contributors (ODbL)',
    note: 'Commercial use allowed. A printed map is a “Produced Work”: credit “© OpenStreetMap contributors”. If you ever sell/share the trail data itself (not just the map) it must stay ODbL.',
  },
  doc: {
    name: 'Department of Conservation',
    licence: 'CC BY 4.0',
    url: 'https://doc-deptconservation.opendata.arcgis.com/',
    credit: 'Track & hut data: Department of Conservation, CC BY 4.0',
    note: 'Commercial use allowed with attribution. Track info changes — check closures before printing.',
  },
  eox: {
    name: 'Copernicus Sentinel-2 (EOX)',
    licence: 'CC BY 4.0',
    url: 'https://cloudless.eox.at',
    credit: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
    note: 'The 2016 mosaic is CC BY 4.0 — commercial use OK with credit. EOX’s newer yearly mosaics are non-commercial unless you buy a licence, so they’re not offered. For NZ, LINZ’s yearly Sentinel-2 mosaics (in the imagery list) are newer and also CC BY 4.0.',
  },
  file: {
    name: 'Your own data',
    licence: 'Yours',
    url: '',
    credit: '',
    note: 'Only upload data you own or have the right to sell (e.g. your own GPS recordings). Strava, Trailforks, AllTrails and Google data are NOT licensed for this.',
  },
};

export const GRADES = [
  { id: 'easy', label: 'Easy', color: '#2fb344' },
  { id: 'intermediate', label: 'Intermediate', color: '#1c6fe0' },
  { id: 'advanced', label: 'Advanced', color: '#1b1b1b' },
  { id: 'expert', label: 'Expert', color: '#d62b2b' },
  { id: 'other', label: 'Ungraded', color: '#9aa0a6' },
];

const LINE = (color, extra = {}) => ({
  color, width: 2.2, opacity: 1, dash: 'solid', casing: true, casingColor: '#ffffff', casingWidth: 1.5,
  labels: false, labelSize: 11, labelColor: '#1b1b1b', colorBy: 'single',
  bike: 'none', bikeColor: '#ffd400', show: 'all', hideRoads: false, ...extra,
});
const POINT = (color, extra = {}) => ({
  color, size: 5, opacity: 1, casing: true, casingColor: '#ffffff', labels: true, labelSize: 11,
  labelColor: '#1b1b1b', icon: 'circle', colorBy: 'single', ...extra,
});

const B = '{{bbox}}';
export const PRESETS = {
  'osm-all': {
    group: 'OpenStreetMap', source: 'osm', kind: 'line', name: 'All trails (combined)',
    desc: 'Paths, tracks, cycleways & route relations merged — each trail once, tagged bike/walk', grades: true, combined: true,
    query: `(way["highway"~"^(path|footway|bridleway|cycleway|steps|track)$"]["access"!~"^(private|no)$"](${B});rel["route"~"^(mtb|bicycle|hiking|foot|walking)$"](${B});way(r)(${B});)->.a;way.a;out tags geom;rel.a;out body;`,
    style: LINE('#ff4d2e', { bike: 'side', width: 2.2 }),
  },
  'osm-hiking': {
    group: 'OpenStreetMap', source: 'osm', kind: 'line', name: 'Walking & tramping tracks',
    desc: 'Paths, footways and bridleways', grades: true,
    query: `(way["highway"~"^(path|footway|bridleway|steps)$"]["access"!~"^(private|no)$"](${B}););out tags geom;`,
    style: LINE('#ff4d2e', { dash: 'dash' }),
  },
  'osm-mtb': {
    group: 'OpenStreetMap', source: 'osm', kind: 'line', name: 'Mountain bike trails',
    desc: 'Anything with an MTB grade, designated bike paths and MTB routes', grades: true,
    query: `(way["mtb:scale"](${B});way["mtb:scale:imba"](${B});way["highway"~"^(path|track|bridleway)$"]["bicycle"="designated"](${B}););out tags geom;rel["route"="mtb"](${B});way(r)(${B});out tags geom;`,
    style: LINE('#ffd400', { colorBy: 'grade', width: 2.6 }),
  },
  'osm-cycle': {
    group: 'OpenStreetMap', source: 'osm', kind: 'line', name: 'Cycleways & cycle trails',
    desc: 'Cycleways plus cycle routes (incl. NZ Cycle Trail Great Rides)',
    query: `(way["highway"="cycleway"](${B}););out tags geom;rel["route"="bicycle"](${B});way(r)(${B});out tags geom;`,
    style: LINE('#00c2d1', { width: 2.6 }),
  },
  'osm-4wd': {
    group: 'OpenStreetMap', source: 'osm', kind: 'line', name: 'Farm & 4WD tracks',
    desc: 'highway=track', query: `(way["highway"="track"](${B}););out tags geom;`,
    style: LINE('#f5f5f5', { width: 1.6, dash: 'dot', casing: false }),
  },
  'osm-huts': {
    group: 'OpenStreetMap', source: 'osm', kind: 'point', name: 'Huts & shelters',
    desc: 'Alpine/wilderness huts and shelters',
    query: `(nwr["tourism"~"^(alpine_hut|wilderness_hut)$"](${B});nwr["amenity"="shelter"](${B}););out tags center;`,
    style: POINT('#b5651d', { icon: 'hut' }),
  },
  'osm-peaks': {
    group: 'OpenStreetMap', source: 'osm', kind: 'point', name: 'Named peaks',
    desc: 'natural=peak with names and heights',
    query: `(node["natural"~"^(peak|volcano)$"]["name"](${B}););out tags;`,
    style: POINT('#5b3a1a', { icon: 'peak', labelField: 'name_ele' }),
  },
  'osm-custom': {
    group: 'OpenStreetMap', source: 'osm', kind: 'line', name: 'Custom OSM query',
    desc: 'Write your own Overpass filter', custom: true,
    query: `(way["highway"="path"]["name"](${B}););out tags geom;`,
    style: LINE('#ff00aa'),
  },
  'doc-tracks': {
    group: 'Department of Conservation', source: 'doc', kind: 'line', name: 'DOC tracks',
    desc: 'Official DOC walking/tramping/MTB tracks', grades: true,
    service: 'DOC_Tracks_Open_Data', style: LINE('#ff8a00', { dash: 'dash' }),
  },
  'doc-huts': {
    group: 'Department of Conservation', source: 'doc', kind: 'point', name: 'DOC huts',
    desc: 'Huts, bivvies and campsites managed by DOC', service: 'DOC_Huts_Open_Data',
    style: POINT('#d9480f', { icon: 'hut' }),
  },
  'linz-foot': {
    group: 'LINZ Topo', source: 'linz', kind: 'vector', name: 'Topo50 foot tracks',
    desc: 'LINZ topographic foot tracks (whole country, no loading)',
    filter: ['all', ['==', 'class', 'track'], ['==', 'track_use', 'foot']],
    style: LINE('#e8402a', { dash: 'dash', width: 1.8 }),
  },
  'linz-cycle': {
    group: 'LINZ Topo', source: 'linz', kind: 'vector', name: 'Topo50 cycle tracks',
    desc: 'LINZ topographic cycle-only tracks',
    filter: ['all', ['==', 'class', 'track'], ['==', 'track_use', 'cycle only']],
    style: LINE('#1c9be0', { width: 2 }),
  },
  'linz-vehicle': {
    group: 'LINZ Topo', source: 'linz', kind: 'vector', name: 'Topo50 vehicle tracks',
    desc: 'LINZ topographic 4WD/vehicle tracks',
    filter: ['all', ['==', 'class', 'track'], ['==', 'track_use', 'vehicle']],
    style: LINE('#ffffff', { dash: 'dot', width: 1.4, casing: false }),
  },
  'linz-roads': {
    group: 'Roads', source: 'linz', kind: 'roads', name: 'Roads',
    desc: 'LINZ roads: highways, main, local, gravel, rail — whole country, no loading',
    style: {
      color: '#ffffff', hwyColor: '#f2b134', gravelColor: '#e3cf9c', gravelDash: true, width: 1.6, opacity: 0.95,
      casing: true, casingColor: '#2b2b2b', casingWidth: 0.7, labels: false, labelSize: 10, labelColor: '#1b1b1b',
      classes: { highway: true, main: true, local: true, gravel: true, rail: false },
    },
  },
  'osm-places': {
    group: 'Roads', source: 'osm', kind: 'point', name: 'Villages & localities',
    desc: 'Small settlements and named localities from OSM (LINZ only labels bigger places)',
    query: `(node["place"~"^(village|hamlet|locality|isolated_dwelling)$"]["name"](${B}););out tags;`,
    style: POINT('#ffffff', { size: 2.5, casing: true, casingColor: '#333333', labelSize: 11, labelColor: '#1b1b1b' }),
  },
  file: {
    group: 'Upload', source: 'file', kind: 'line', name: 'Uploaded file',
    desc: 'GPX, KML or GeoJSON', style: LINE('#a020f0'),
  },
};

// ---- Grading -----------------------------------------------------------------

function osmGrade(t) {
  const imba = t['mtb:scale:imba'];
  if (imba != null && imba !== '') {
    const n = parseInt(imba, 10);
    return n <= 1 ? 'easy' : n === 2 ? 'intermediate' : n === 3 ? 'advanced' : 'expert';
  }
  const mtb = t['mtb:scale'];
  if (mtb != null && mtb !== '') {
    const n = parseInt(mtb, 10);
    return n <= 1 ? 'easy' : n === 2 ? 'intermediate' : n === 3 ? 'advanced' : 'expert';
  }
  const sac = t.sac_scale;
  if (sac) {
    if (sac === 'hiking') return 'easy';
    if (sac === 'mountain_hiking') return 'intermediate';
    if (sac === 'demanding_mountain_hiking') return 'advanced';
    return 'expert';
  }
  return 'other';
}

function docGrade(p) {
  const c = (p.WEB_CATEGORY_TRACK || p.WEB_MTB_CATEGORY || '').toLowerCase();
  if (!c) return 'other';
  if (c.includes('easy access') || c.includes('short walk') || c.includes('easiest')) return 'easy';
  if (c.includes('walking track') || c.includes('great walk') || c.includes('easier') || c === 'easy') return 'intermediate';
  if (c.includes('tramping') || c.includes('advanced')) return 'advanced';
  if (c.includes('route') || c.includes('expert')) return 'expert';
  return 'other';
}

// ---- OpenStreetMap (Overpass API) -------------------------------------------

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const YES = /^(yes|designated|permissive|official)$/;
const TRAIL = /^(path|footway|bridleway|cycleway|steps|track)$/;

// Work out what a way is good for, from its own tags plus any route relations it's in.
function classify(t, routes) {
  const rt = routes.map(r => r.route);
  const bikeRoute = rt.some(r => r === 'mtb' || r === 'bicycle');
  const walkRoute = rt.some(r => r === 'hiking' || r === 'foot' || r === 'walking');
  const bike = t.bicycle !== 'no' && t.bicycle !== 'dismount' && (
    t.highway === 'cycleway' || YES.test(t.bicycle || '') || t['mtb:scale'] != null || t['mtb:scale:imba'] != null || bikeRoute);
  const walk = t.foot !== 'no' && t.highway !== 'cycleway' && (
    TRAIL.test(t.highway || '') || YES.test(t.foot || '') || walkRoute) || (t.highway === 'cycleway' && YES.test(t.foot || ''));
  return { _bike: !!bike, _walk: !!walk, _road: !TRAIL.test(t.highway || '') };
}

export function osmToGeoJSON(json) {
  const seen = new Set();
  const features = [];
  // Route relations (mtb/bicycle/hiking) tell us which ways belong to named trails.
  const routesOf = new Map();
  for (const el of json.elements || []) {
    if (el.type !== 'relation' || !el.members || !el.tags?.route) continue;
    for (const m of el.members) {
      if (m.type !== 'way') continue;
      if (!routesOf.has(m.ref)) routesOf.set(m.ref, []);
      routesOf.get(m.ref).push({ route: el.tags.route, name: el.tags.name || '' });
    }
  }
  for (const el of json.elements || []) {
    const key = el.type + el.id;
    if (seen.has(key)) continue;
    let geometry = null;
    if (el.type === 'node' && el.lat != null) geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
    else if (el.center) geometry = { type: 'Point', coordinates: [el.center.lon, el.center.lat] };
    else if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.filter(Boolean).map(p => [p.lon, p.lat]);
      if (coords.length >= 2) geometry = { type: 'LineString', coordinates: coords };
    }
    if (!geometry) continue;
    seen.add(key);
    const tags = el.tags || {};
    const routes = el.type === 'way' ? (routesOf.get(el.id) || []) : [];
    const props = { ...tags, _id: key, _grade: osmGrade(tags), ...classify(tags, routes) };
    if (routes.length) props._routes = [...new Set(routes.map(r => r.name).filter(Boolean))].join(', ');
    if (!props.name && props._routes) props.name = props._routes;
    if (tags.name && tags.ele) props.name_ele = `${tags.name} ${Math.round(parseFloat(tags.ele))} m`;
    else props.name_ele = tags.name || '';
    features.push({ type: 'Feature', geometry, properties: props });
  }
  return { type: 'FeatureCollection', features };
}

export async function fetchOSM(query, bbox, signal) {
  const [w, s, e, n] = bbox;
  const q = `[out:json][timeout:120];${query.replaceAll('{{bbox}}', `${s},${w},${n},${e}`)}`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Overpass busy (${res.status})`); continue; }
      if (!res.ok) throw new Error(`Overpass error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return osmToGeoJSON(await res.json());
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass unavailable');
}

// ---- Department of Conservation (ArcGIS Online) -----------------------------

const DOC_BASE = 'https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services';

function docProps(p) {
  const out = { name: p.TechObjectName || p.name || '', type: p.SubObjectType || p.ObjectType || '' };
  for (let i = 1; i <= 20; i++) {
    const k = p[`CharName${i}`];
    if (k) out[k] = p[`CharValue${i}`];
  }
  out._grade = docGrade(out);
  out.name_ele = out.name;
  return out;
}

export async function fetchDOC(service, bbox, signal) {
  const features = [];
  const page = 2000;
  for (let offset = 0; offset < 50000; offset += page) {
    const params = new URLSearchParams({
      where: '1=1', geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: '*', outSR: '4326', f: 'geojson',
      resultOffset: String(offset), resultRecordCount: String(page),
    });
    const res = await fetch(`${DOC_BASE}/${service}/FeatureServer/0/query?${params}`, { signal });
    if (!res.ok) throw new Error(`DOC error ${res.status}`);
    const fc = await res.json();
    if (fc.error) throw new Error(fc.error.message || 'DOC query failed');
    for (const f of fc.features || []) {
      if (!f.geometry) continue;
      const props = docProps(f.properties || {});
      if ((props.USER_STATUS || '').toUpperCase().includes('REMOVED')) continue;
      features.push({ type: 'Feature', geometry: f.geometry, properties: props });
    }
    if (!(fc.features || []).length || (fc.features.length < page && !fc.properties?.exceededTransferLimit)) break;
  }
  return { type: 'FeatureCollection', features };
}

// ---- Uploaded files -------------------------------------------------------------

const txt = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

function parseGPX(doc) {
  const features = [];
  const pts = list => [...list].map(p => [parseFloat(p.getAttribute('lon')), parseFloat(p.getAttribute('lat'))]).filter(c => !isNaN(c[0]));
  for (const trk of doc.getElementsByTagName('trk')) {
    const name = txt(trk, 'name');
    const lines = [...trk.getElementsByTagName('trkseg')].map(seg => pts(seg.getElementsByTagName('trkpt'))).filter(l => l.length > 1);
    if (lines.length) features.push({ type: 'Feature', properties: { name }, geometry: { type: 'MultiLineString', coordinates: lines } });
  }
  for (const rte of doc.getElementsByTagName('rte')) {
    const line = pts(rte.getElementsByTagName('rtept'));
    if (line.length > 1) features.push({ type: 'Feature', properties: { name: txt(rte, 'name') }, geometry: { type: 'LineString', coordinates: line } });
  }
  for (const w of doc.getElementsByTagName('wpt')) {
    const c = [parseFloat(w.getAttribute('lon')), parseFloat(w.getAttribute('lat'))];
    if (!isNaN(c[0])) features.push({ type: 'Feature', properties: { name: txt(w, 'name') }, geometry: { type: 'Point', coordinates: c } });
  }
  return features;
}

function parseKML(doc) {
  const features = [];
  const coords = s => s.trim().split(/\s+/).map(t => t.split(',').slice(0, 2).map(Number)).filter(c => c.length === 2 && !isNaN(c[0]));
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const name = txt(pm, 'name');
    for (const ls of pm.getElementsByTagName('LineString')) {
      const c = coords(txt(ls, 'coordinates'));
      if (c.length > 1) features.push({ type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates: c } });
    }
    for (const pt of pm.getElementsByTagName('Point')) {
      const c = coords(txt(pt, 'coordinates'));
      if (c.length) features.push({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: c[0] } });
    }
    for (const poly of pm.getElementsByTagName('Polygon')) {
      const c = coords(txt(poly, 'coordinates'));
      if (c.length > 2) features.push({ type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates: c } });
    }
  }
  return features;
}

export async function parseFile(file) {
  const text = await file.text();
  const ext = file.name.split('.').pop().toLowerCase();
  let features;
  if (ext === 'geojson' || ext === 'json') {
    const j = JSON.parse(text);
    if (j.type === 'FeatureCollection') features = j.features;
    else if (j.type === 'Feature') features = [j];
    else if (j.type) features = [{ type: 'Feature', properties: {}, geometry: j }];
    else throw new Error('Not GeoJSON');
  } else {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read file');
    features = ext === 'kml' ? parseKML(doc) : parseGPX(doc);
  }
  features = features.filter(f => f && f.geometry).map(f => {
    const p = f.properties || {};
    return { ...f, properties: { ...p, name: p.name || p.Name || p.title || '', name_ele: p.name || p.Name || '', _grade: osmGrade(p) } };
  });
  if (!features.length) throw new Error('No features found in file');
  const hasLines = features.some(f => /Line|Polygon/.test(f.geometry.type));
  return { data: { type: 'FeatureCollection', features }, kind: hasLines ? 'line' : 'point' };
}

export function bboxOf(fc) {
  let w = 180, s = 90, e = -180, n = -90;
  const visit = c => {
    if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
    else c.forEach(visit);
  };
  fc.features.forEach(f => f.geometry && visit(f.geometry.coordinates));
  return w <= e ? [w, s, e, n] : null;
}
