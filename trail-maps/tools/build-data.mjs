// Builds the NZ-wide trail datasets that Trail Map Studio loads instantly.
// Usage: node build-data.mjs <filtered.osm.pbf> <outDir>
// Needs osmium-tool on PATH. Uses the app's own classification code so the
// pre-built data matches what live Overpass loading produces.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, osmGrade, fetchDOC } from '../js/sources.js';

const [pbf, outDir] = process.argv.slice(2);
if (!pbf || !outDir) { console.error('usage: build-data.mjs <pbf> <outDir>'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

const TRAIL = /^(path|footway|bridleway|cycleway|steps|track)$/;
const KEEP = ['name', 'ref', 'highway', 'surface', 'sac_scale', 'mtb:scale', 'mtb:scale:imba', 'bicycle', 'foot',
  'trail_visibility', 'ele', 'tourism', 'amenity', 'natural', 'place', 'operator', 'network', 'access'];

// ---- 1. Route relations: which ways belong to MTB / cycle / hiking routes ----
const decodeOpl = s => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const routesOf = new Map();
const opl = execFileSync('osmium', ['cat', '-t', 'relation', '-f', 'opl', pbf], { maxBuffer: 1 << 30 }).toString();
for (const line of opl.split('\n')) {
  if (!line.startsWith('r')) continue;
  const fields = line.split(' ');
  const T = fields.find(f => f.startsWith('T'))?.slice(1) || '';
  const M = fields.find(f => f.startsWith('M'))?.slice(1) || '';
  const tags = Object.fromEntries(T.split(',').filter(Boolean).map(kv => { const i = kv.indexOf('='); return [decodeOpl(kv.slice(0, i)), decodeOpl(kv.slice(i + 1))]; }));
  if (!/^(mtb|bicycle|hiking|foot|walking)$/.test(tags.route || '')) continue;
  for (const m of M.split(',')) {
    if (!m.startsWith('w')) continue;
    const id = +m.slice(1, m.indexOf('@'));
    if (!routesOf.has(id)) routesOf.set(id, []);
    routesOf.get(id).push({ route: tags.route, name: tags.name || '' });
  }
}
console.log(`route relations: ${routesOf.size} member ways`);

// ---- 2. Ways and nodes -> classified features ----
const out = name => { const s = createWriteStream(join(outDir, `${name}.geojsonl`)); return { s, n: 0 }; };
const files = { trails: out('trails'), pois: out('pois') };
const write = (f, feature) => { f.s.write(JSON.stringify(feature) + '\n'); f.n++; };

function poiKind(t) {
  if (/^(alpine_hut|wilderness_hut)$/.test(t.tourism || '')) return 'hut';
  if (t.amenity === 'shelter') return 'shelter';
  if (/^(peak|volcano)$/.test(t.natural || '') && t.name) return 'peak';
  if (/^(village|hamlet|locality|isolated_dwelling)$/.test(t.place || '') && t.name) return 'place';
  return null;
}

function centroid(geom) {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null;
  if (!ring) return null;
  const n = ring.length;
  return [ring.reduce((a, c) => a + c[0], 0) / n, ring.reduce((a, c) => a + c[1], 0) / n];
}

function pick(t) {
  const p = {};
  for (const k of KEEP) if (t[k] != null) p[k] = t[k];
  return p;
}

const exp = spawn('osmium', ['export', pbf, '-f', 'geojsonseq', '-a', 'type,id', '-x', 'print_record_separator=false', '--geometry-types', 'point,linestring,polygon', '-o', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
const rl = createInterface({ input: exp.stdout, crlfDelay: Infinity });
for await (const raw of rl) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  const f = JSON.parse(line);
  const t = f.properties;
  const type = t['@type'], id = t['@id'];
  const g = f.geometry;

  const poi = poiKind(t);
  if (poi) {
    const c = g.type === 'Point' ? g.coordinates : centroid(g);
    if (c) {
      const p = { ...pick(t), poi, _id: `${type[0]}${id}` };
      p.name_ele = t.name && t.ele ? `${t.name} ${Math.round(parseFloat(t.ele))} m` : (t.name || '');
      write(files.pois, { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: p });
    }
    continue;
  }
  if (type !== 'way' || !/LineString/.test(g.type)) continue;
  const routes = routesOf.get(id) || [];
  if (!TRAIL.test(t.highway || '') && !routes.length) continue;
  if (/^(private|no)$/.test(t.access || '')) continue;
  if (!t.highway || /^(proposed|construction|platform)$/.test(t.highway)) continue;   // ferries, gondolas etc. in routes
  if (/^(sidewalk|crossing)$/.test(t.footway || '') || t.cycleway === 'crossing' || t.path === 'sidewalk') continue;
  const p = { ...pick(t), _id: `w${id}`, _grade: osmGrade(t), ...classify(t, routes) };
  if (routes.length) {
    p._routes = [...new Set(routes.map(r => r.name).filter(Boolean))].join(', ');
    p._rtypes = [...new Set(routes.map(r => r.route))].join(',');
    if (!p.name && p._routes) p.name = p._routes;
  }
  write(files.trails, { type: 'Feature', geometry: g, properties: p });
}
await new Promise(r => exp.on('close', r));
for (const f of Object.values(files)) await new Promise(r => f.s.end(r));
console.log(`trails: ${files.trails.n}, pois: ${files.pois.n}`);

// ---- 3. DOC tracks and huts (whole country) ----
const NZ = [165, -48, 179, -34];
const counts = { trails: files.trails.n, pois: files.pois.n };
for (const [name, service] of [['doc_tracks', 'DOC_Tracks_Open_Data'], ['doc_huts', 'DOC_Huts_Open_Data']]) {
  let feats = [];
  if (!process.env.SKIP_DOC) {
    try { feats = (await fetchDOC(service, NZ)).features; }
    catch (err) { console.warn(`${name} failed, publishing without it: ${err.message}`); }
  }
  writeFileSync(join(outDir, `${name}.geojsonl`), feats.map(f => JSON.stringify(f)).join('\n') + (feats.length ? '\n' : ''));
  counts[name] = feats.length;
  console.log(`${name}: ${feats.length}`);
}

writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ built: new Date().toISOString(), counts, sources: ['OpenStreetMap NZ data, © OpenStreetMap contributors, ODbL 1.0', 'Department of Conservation, CC BY 4.0'] }, null, 2));
