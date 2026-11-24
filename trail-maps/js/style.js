// Builds a MapLibre style from app state. Used for both the live map and the print renderer.
import { GLYPHS, tileUrl, demUrl, topoVectorUrl, baseSource } from './linz.js';
import { GRADES, PRESETS } from './sources.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

export const DASHES = {
  solid: null,
  dash: [3, 2],
  longdash: [6, 3],
  dot: [0.01, 2],
  dashdot: [4, 2, 0.01, 2],
};

export const FONTS = ['Open Sans Bold', 'Open Sans Regular', 'Open Sans Italic', 'Roboto Bold', 'Roboto Regular', 'Roboto Light', 'Roboto Black', 'Roboto Italic'];

function gradeColor(fallback) {
  const m = ['match', ['get', '_grade']];
  for (const g of GRADES) m.push(g.id, g.color);
  m.push(fallback);
  return m;
}

function lineLayers(L, srcProps) {
  const s = L.style;
  const id = `u-${L.id}`;
  const osm = L.source === 'osm' || L.source === 'file';
  const bikeMode = osm ? (s.bike || 'none') : 'none';
  let color = s.colorBy === 'grade' ? gradeColor(s.color) : s.color;
  if (bikeMode === 'color') color = ['case', ['==', ['get', '_bike'], true], s.bikeColor, color];
  const geomFilter = srcProps['source-layer'] ? null : ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false];
  const parts = [srcProps.filter, geomFilter].filter(Boolean);
  if (osm && s.show === 'bike') parts.push(['==', ['get', '_bike'], true]);
  if (osm && s.show === 'walk') parts.push(['==', ['get', '_walk'], true]);
  if (osm && s.hideRoads) parts.push(['!=', ['get', '_road'], true]);
  const filter = parts.length > 1 ? ['all', ...parts] : parts[0];
  const base = { source: srcProps.source, ...(srcProps['source-layer'] ? { 'source-layer': srcProps['source-layer'] } : {}), ...(filter ? { filter } : {}) };
  const round = s.dash === 'dot' || s.dash === 'dashdot';
  const out = [];
  if (s.casing) {
    out.push({
      id: `${id}-casing`, type: 'line', ...base,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': s.casingColor, 'line-width': s.width + s.casingWidth * 2, 'line-opacity': s.opacity * 0.9 },
    });
  }
  const paint = { 'line-color': color, 'line-width': s.width, 'line-opacity': s.opacity };
  if (DASHES[s.dash]) paint['line-dasharray'] = DASHES[s.dash];
  out.push({ id: `${id}-line`, type: 'line', ...base, layout: { 'line-cap': round ? 'round' : 'butt', 'line-join': 'round' }, paint });
  if (bikeMode === 'side') {
    // A parallel stripe beside bike-friendly trails (sits just outside the halo).
    const bw = Math.max(1.2, s.width * 0.65);
    const off = s.width / 2 + (s.casing ? s.casingWidth : 0.6) + bw / 2;
    const bf = ['all', ...(filter ? [filter] : []), ['==', ['get', '_bike'], true]];
    if (s.casing) {
      out.push({ id: `${id}-bike-casing`, type: 'line', ...base, filter: bf, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': s.casingColor, 'line-width': bw + 1.6, 'line-offset': off, 'line-opacity': s.opacity * 0.9 } });
    }
    out.push({ id: `${id}-bike`, type: 'line', ...base, filter: bf, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': s.bikeColor, 'line-width': bw, 'line-offset': off, 'line-opacity': s.opacity } });
  }
  if (s.labels) {
    out.push({
      id: `${id}-label`, type: 'symbol', ...base,
      layout: {
        'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': [s.labelFont || 'Open Sans Bold'],
        'text-size': s.labelSize, 'symbol-spacing': 350, 'text-max-angle': 35, 'text-padding': 4, 'text-offset': [0, -0.9],
      },
      paint: { 'text-color': s.labelColor, 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6, 'text-opacity': s.opacity },
    });
  }
  return out;
}

function pointLayers(L, srcProps) {
  const s = L.style;
  const id = `u-${L.id}`;
  const base = { source: srcProps.source, filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false] };
  const out = [];
  if (s.icon === 'circle' || !s.icon) {
    out.push({
      id: `${id}-pt`, type: 'circle', ...base,
      paint: {
        'circle-radius': s.size, 'circle-color': s.color, 'circle-opacity': s.opacity,
        'circle-stroke-color': s.casingColor, 'circle-stroke-width': s.casing ? 1.5 : 0, 'circle-stroke-opacity': s.opacity,
      },
    });
  } else {
    out.push({
      id: `${id}-pt`, type: 'symbol', ...base,
      layout: {
        'icon-image': `tm|${s.icon}|${s.color}|${s.casing ? s.casingColor : 'none'}`, 'icon-size': s.size / 8,
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': s.opacity },
    });
  }
  if (s.labels) {
    out.push({
      id: `${id}-label`, type: 'symbol', ...base,
      layout: {
        'text-field': ['coalesce', ['get', s.labelField || 'name'], ['get', 'name'], ''], 'text-font': [s.labelFont || 'Open Sans Bold'],
        'text-size': s.labelSize, 'text-anchor': 'top', 'text-offset': [0, Math.max(0.8, s.size / 8)], 'text-optional': true,
        'text-max-width': 9,
      },
      paint: { 'text-color': s.labelColor, 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6, 'text-opacity': s.opacity },
    });
  }
  return out;
}

// ---- Roads (LINZ topographic vector tiles) -------------------------------------------
const GRAVEL = ['in', ['coalesce', ['get', 'surface'], ''], ['literal', ['metalled', 'unmetalled']]];
export const ROAD_CLASSES = [
  { k: 'rail', label: 'Railway', filter: ['==', ['get', 'class'], 'rail'], w: 0.7 },
  { k: 'gravel', label: 'Gravel roads', filter: ['all', ['==', ['get', 'class'], 'secondary'], GRAVEL], w: 0.85 },
  { k: 'local', label: 'Local roads', filter: ['all', ['==', ['get', 'class'], 'secondary'], ['!', GRAVEL]], w: 1 },
  { k: 'main', label: 'Main roads', filter: ['==', ['get', 'class'], 'primary'], w: 1.35 },
  { k: 'highway', label: 'State highways', filter: ['==', ['get', 'class'], 'motorway'], w: 1.75 },
];

export function roadLook(s, c) {
  if (c.k === 'rail') return { color: '#3a3a3a', dash: [2.5, 2], width: Math.max(1, s.width * c.w), casing: false };
  return {
    color: c.k === 'highway' ? s.hwyColor : c.k === 'gravel' ? s.gravelColor : s.color,
    dash: c.k === 'gravel' && s.gravelDash ? [3, 1.5] : null,
    width: s.width * c.w, casing: s.casing,
  };
}

function roadLayers(L) {
  const s = L.style;
  const id = `u-${L.id}`;
  const base = { source: 'linz', 'source-layer': 'transportation' };
  const on = ROAD_CLASSES.filter(c => s.classes?.[c.k]);
  const lines = [], labels = [];
  // All casings first, then fills, so junctions merge cleanly.
  for (const c of on) {
    const look = roadLook(s, c);
    if (look.casing) lines.push({ id: `${id}-${c.k}-casing`, type: 'line', ...base, filter: c.filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': s.casingColor, 'line-width': look.width + s.casingWidth * 2, 'line-opacity': s.opacity } });
  }
  for (const c of on) {
    const look = roadLook(s, c);
    const paint = { 'line-color': look.color, 'line-width': look.width, 'line-opacity': s.opacity };
    if (look.dash) paint['line-dasharray'] = look.dash;
    lines.push({ id: `${id}-${c.k}`, type: 'line', ...base, filter: c.filter, layout: { 'line-cap': look.dash ? 'butt' : 'round', 'line-join': 'round' }, paint });
  }
  if (s.labels && on.length) {
    labels.push({ id: `${id}-label`, type: 'symbol', ...base, filter: ['all', ['has', 'name'], ['any', ...on.map(c => c.filter)]],
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': [s.labelFont || 'Open Sans Regular'],
        'text-size': s.labelSize, 'symbol-spacing': 400, 'text-max-angle': 30, 'text-padding': 4 },
      paint: { 'text-color': s.labelColor, 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4, 'text-opacity': s.opacity } });
  }
  return { lines, labels };
}

// ---- Place labels (LINZ gazetteer names in the topographic tiles) ----------------------
const has = (k, v) => ['all', ['has', k], ['!=', ['get', k], '0'], ...(v ? [['in', ['get', k], ['literal', v]]] : [])];
export const PLACE_CATS = [
  { k: 'city', label: 'Cities & large towns', filter: ['all', ['==', ['get', 'class'], 'city'], ['!', has('natural')]] },
  { k: 'town', label: 'Towns', filter: ['==', ['get', 'class'], 'town'] },
  { k: 'suburb', label: 'Suburbs & villages', filter: ['in', ['get', 'place'], ['literal', ['suburb', 'village', 'hamlet', 'locality']]] },
  { k: 'water', label: 'Lakes, bays & sounds', filter: ['any', ['==', ['get', 'place'], 'lake'], has('water')] },
  { k: 'peak', label: 'Peaks & landforms', filter: has('natural') },
  { k: 'island', label: 'Islands', filter: ['in', ['get', 'place'], ['literal', ['island', 'archipelago']]] },
];

function placeLabels(P) {
  return PLACE_CATS.filter(c => P.cats[c.k]?.on).map(c => {
    const st = P.cats[c.k];
    return {
      id: `place-${c.k}`, type: 'symbol', source: 'linz', 'source-layer': 'place', filter: c.filter,
      layout: {
        'text-field': st.caps ? ['upcase', ['get', 'name']] : ['get', 'name'], 'text-font': [st.font],
        'text-size': st.size, 'text-letter-spacing': st.caps ? 0.1 : 0.02, 'text-max-width': 8, 'text-padding': 3,
      },
      paint: { 'text-color': st.color, 'text-halo-color': P.halo, 'text-halo-width': P.haloWidth, 'text-halo-blur': 0.4 },
    };
  });
}

function brightness(b) {
  return b >= 0 ? { 'raster-brightness-min': b, 'raster-brightness-max': 1 } : { 'raster-brightness-min': 0, 'raster-brightness-max': 1 + b };
}

// opts.tileScale: render raster tiles at 2^k higher zoom (for high-DPI print rendering).
export function buildStyle(state, { key, topo = null, tileScale = 0 } = {}) {
  const ts = 256 / Math.pow(2, tileScale);
  const img = state.imagery;
  const sources = {
    base: baseSource(img.base, key, ts),
  };
  const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e4da' } }];

  if (img.fillGaps && img.base !== 'aerial' && !img.base.startsWith('eox')) {
    sources.fill = { type: 'raster', tiles: [tileUrl('aerial', key)], tileSize: ts, maxzoom: 22 };
    layers.push({ id: 'fill', type: 'raster', source: 'fill', paint: { 'raster-opacity': img.opacity, 'raster-saturation': img.saturation, 'raster-contrast': img.contrast, ...brightness(img.brightness), 'raster-fade-duration': 0 } });
  }
  layers.push({
    id: 'base', type: 'raster', source: 'base',
    paint: { 'raster-opacity': img.opacity, 'raster-saturation': img.saturation, 'raster-contrast': img.contrast, ...brightness(img.brightness), 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
  });

  const t = state.terrain;
  if (t.hillshade) {
    sources.dem = { type: 'raster-dem', tiles: [demUrl(key)], tileSize: ts, maxzoom: 18, encoding: 'mapbox' };
    layers.push({
      id: 'hillshade', type: 'hillshade', source: 'dem',
      paint: {
        'hillshade-exaggeration': t.hillshadeStrength, 'hillshade-shadow-color': '#1d1a14',
        'hillshade-highlight-color': 'rgba(255,255,255,0.25)', 'hillshade-accent-color': '#1d1a14',
        'hillshade-illumination-direction': 315,
      },
    });
  }

  const needVector = t.contours || t.labels || state.layers.some(l => l.source === 'linz' && l.visible);
  if (needVector) sources.linz = { type: 'vector', url: topoVectorUrl(key) };

  if (t.contours && topo) {
    for (const l of topo.layers.filter(l => l.id.startsWith('Contours'))) {
      const c = { ...l, source: 'linz', paint: { ...l.paint }, layout: { ...(l.layout || {}), visibility: 'visible' } };
      if (c.type === 'line') { c.paint['line-color'] = t.contourColor; c.paint['line-opacity'] = t.contourOpacity; }
      else { c.paint['text-color'] = t.contourColor; c.paint['text-opacity'] = Math.min(1, t.contourOpacity + 0.2); }
      layers.push(c);
    }
  }

  // User layers: first in the list draws on top, so iterate backwards. Lines under points.
  const visible = state.layers.filter(l => l.visible).slice().reverse();
  const pointLs = [];
  for (const L of visible) {
    let src;
    if (L.kind === 'roads') {
      if (!sources.linz) continue;
      const r = roadLayers(L);
      layers.push(...r.lines); pointLs.push(...r.labels);
      continue;
    }
    if (L.source === 'linz') {
      if (!sources.linz) continue;
      src = { source: 'linz', 'source-layer': 'transportation', filter: PRESETS[L.preset]?.filter };
    } else {
      sources[`u-${L.id}`] = { type: 'geojson', data: L.data || EMPTY };
      src = { source: `u-${L.id}` };
    }
    if (L.kind === 'point') pointLs.push(...pointLayers(L, src));
    else {
      const ls = lineLayers(L, src);
      layers.push(...ls.filter(x => x.type === 'line'));
      pointLs.push(...ls.filter(x => x.type !== 'line'));
      // Uploaded files can mix tracks and waypoints: show the waypoints too.
      if (L.source === 'file') pointLs.unshift(...pointLayers({ ...L, id: `${L.id}-wp`, style: { ...L.style, size: 4, icon: 'circle' } }, src));
    }
  }

  if (t.labels && state.places) layers.push(...placeLabels(state.places));
  layers.push(...pointLs);

  return { version: 8, glyphs: GLYPHS, sources, layers };
}

// ---- Icons -------------------------------------------------------------------------
// Point icons are drawn on demand (any colour, crisp at any pixel ratio).
export function attachIcons(map) {
  map.on('styleimagemissing', e => {
    const id = e.id;
    if (!id.startsWith('tm|') || map.hasImage(id)) return;
    const [, shape, fill, stroke] = id.split('|');
    const pr = Math.max(1, Math.ceil(map.getPixelRatio ? map.getPixelRatio() : window.devicePixelRatio || 1));
    const S = 32 * pr;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.beginPath();
    if (shape === 'peak') {
      g.moveTo(S * 0.5, S * 0.12); g.lineTo(S * 0.9, S * 0.84); g.lineTo(S * 0.1, S * 0.84); g.closePath();
    } else if (shape === 'hut') {
      g.moveTo(S * 0.5, S * 0.1); g.lineTo(S * 0.9, S * 0.46); g.lineTo(S * 0.78, S * 0.46); g.lineTo(S * 0.78, S * 0.88);
      g.lineTo(S * 0.22, S * 0.88); g.lineTo(S * 0.22, S * 0.46); g.lineTo(S * 0.1, S * 0.46); g.closePath();
    } else {
      g.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2);
    }
    if (stroke !== 'none') { g.strokeStyle = stroke; g.lineWidth = S * 0.12; g.stroke(); }
    g.fillStyle = fill; g.fill();
    map.addImage(id, g.getImageData(0, 0, S, S), { pixelRatio: pr });
  });
}
