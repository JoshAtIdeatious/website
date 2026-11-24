// Print geometry, high-resolution tiled rendering, map furniture and file encoding.
import { buildStyle, attachIcons, DASHES } from './style.js';
import { GRADES } from './sources.js';

const EARTH = 40075016.686;          // equatorial circumference (m)
const CSS_DPI = 96;
const MM_PER_IN = 25.4;

export const PAPERS = {
  A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  Letter: [215.9, 279.4], Tabloid: [279.4, 431.8], 'DL fold': [99, 210],
};

export function paperSize(p) {
  let [w, h] = p.paper === 'custom' ? [p.customW, p.customH] : PAPERS[p.paper];
  if ((p.orientation === 'landscape') !== (w > h)) [w, h] = [h, w];
  return { w, h };
}

const metresPerCssPx = (lat, zoom) => (EARTH * Math.cos(lat * Math.PI / 180)) / (512 * Math.pow(2, zoom));
const zoomFor = (lat, mPerCss) => Math.log2((EARTH * Math.cos(lat * Math.PI / 180)) / (512 * mPerCss));

// Everything the frame overlay and renderer need. Scale is true at the centre latitude.
export function printGeometry(map, p) {
  const { w, h } = paperSize(p);
  const bleed = p.bleed || 0;
  const W = w + bleed * 2, H = h + bleed * 2;          // full sheet incl. bleed (mm)
  const center = map.getCenter();
  const zoom = map.getZoom();
  const el = map.getContainer();
  const vw = el.clientWidth, vh = el.clientHeight;
  const mppScreen = metresPerCssPx(center.lat, zoom);

  let scale;
  if (p.scaleMode === 'fixed') {
    scale = p.scale;
  } else {
    const pad = 56;
    const fit = Math.min((vw - pad * 2) / W, (vh - pad * 2) / H);
    scale = (fit * mppScreen * 1000);                     // ground mm per paper mm
  }
  const groundW = (W / 1000) * scale, groundH = (H / 1000) * scale;  // metres
  const frameW = groundW / mppScreen, frameH = groundH / mppScreen;
  const bleedPx = (bleed / W) * frameW;

  const pr = p.dpi / CSS_DPI;
  const devW = Math.round((W / MM_PER_IN) * p.dpi);
  const devH = Math.round((H / MM_PER_IN) * p.dpi);
  const mPerCss = (scale * MM_PER_IN / 1000) / CSS_DPI;   // metres per CSS px on paper
  const exportZoom = zoomFor(center.lat, mPerCss);

  return {
    paper: { w, h, W, H, bleed }, scale, center, exportZoom, pr, devW, devH,
    groundW, groundH,
    frame: { x: (vw - frameW) / 2, y: (vh - frameH) / 2, w: frameW, h: frameH, bleedPx },
  };
}

export function niceScale(s) {
  const steps = [1000, 2000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];
  return steps.reduce((a, b) => Math.abs(b - s) < Math.abs(a - s) ? b : a);
}

export function boundsOf(map, geo) {
  const f = geo.frame;
  const a = map.unproject([f.x, f.y]), b = map.unproject([f.x + f.w, f.y + f.h]);
  return [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
}

function glLimit() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const r = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const v = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    return Math.min(r, v[0], v[1]);
  } catch { return 4096; }
}

function waitIdle(map, ms = 120000) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    map.once('idle', () => { if (!done) { done = true; clearTimeout(t); resolve(true); } });
    map.triggerRepaint();
  });
}

// Renders the sheet in chunks (GPUs cap canvas size) and stitches them into one big canvas.
export async function renderPrint({ state, key, topo, geo, onProgress, signal }) {
  const { devW, devH, pr, exportZoom, center } = geo;
  if (devW > 32000 || devH > 32000 || devW * devH > 250e6) {
    throw new Error(`That’s ${devW}×${devH} px — too big for a browser. Lower the DPI or paper size.`);
  }
  const out = document.createElement('canvas');
  out.width = devW; out.height = devH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not allocate the output image (out of memory?)');

  const tileScale = Math.max(0, Math.min(3, Math.round(Math.log2(pr))));
  const style = buildStyle(state, { key, topo, tileScale });

  // One pass whenever the GPU allows it (perfectly seamless). Otherwise split into
  // equal-sized parts with overlap, and make label placement deterministic so text is
  // identical in neighbouring parts (MapLibre's collision pass is per-viewport).
  const limit = Math.min(8192, glLimit());
  const single = devW <= limit && devH <= limit;
  const pad = single ? 0 : 512;
  const inner = single ? Math.max(devW, devH) : limit - pad * 2;
  const cols = Math.ceil(devW / inner), rows = Math.ceil(devH / inner);
  if (!single) {
    for (const l of style.layers) {
      if (l.type !== 'symbol') continue;
      l.layout = { ...l.layout, 'text-allow-overlap': true, 'icon-allow-overlap': true, 'text-ignore-placement': true, 'icon-ignore-placement': true, 'text-optional': false };
    }
  }
  // Every part uses the same size so the renderer (and its tile cache) is reused.
  const partW = Math.min(inner, devW) + pad * 2, partH = Math.min(inner, devH) + pad * 2;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const holder = document.createElement('div');
  host.appendChild(holder);

  // World pixel coordinates (in CSS px) at export zoom.
  const worldSize = 512 * Math.pow(2, exportZoom);
  const cx = (center.lng + 180) / 360 * worldSize;
  const sinLat = Math.sin(center.lat * Math.PI / 180);
  const cy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  const left = cx - (devW / pr) / 2, top = cy - (devH / pr) / 2;
  const unproj = (x, y) => {
    const lng = x / worldSize * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / worldSize;
    return [lng, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
  };

  let map;
  try {
    let n = 0;
    let warned = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        n++;
        onProgress?.(`Rendering part ${n} of ${rows * cols}…`, (n - 1) / (rows * cols));
        const x0 = c * inner, y0 = r * inner;
        const cw = Math.min(inner, devW - x0), ch = Math.min(inner, devH - y0);
        const sx = x0 - pad, sy = y0 - pad, sw = partW, sh = partH;
        const cssW = sw / pr, cssH = sh / pr;
        const ctr = unproj(left + (sx + sw / 2) / pr, top + (sy + sh / 2) / pr);

        if (!map || holder.dataset.size !== `${sw}x${sh}`) {
          if (map) map.remove();
          holder.style.width = `${cssW}px`;
          holder.style.height = `${cssH}px`;
          holder.dataset.size = `${sw}x${sh}`;
          map = new maplibregl.Map({
            container: holder, style, center: ctr, zoom: exportZoom, pixelRatio: pr,
            interactive: false, attributionControl: false, preserveDrawingBuffer: true,
            fadeDuration: 0, maxZoom: 24, renderWorldCopies: false, maxTileCacheSize: 2000,
          });
          attachIcons(map);
          await new Promise((res, rej) => { map.once('load', res); map.once('error', e => console.warn('render error', e?.error)); setTimeout(() => rej(new Error('Map failed to load')), 60000); });
        } else {
          map.jumpTo({ center: ctr, zoom: exportZoom });
        }
        const ok = await waitIdle(map);
        if (!ok && !warned) { warned = true; console.warn('Some tiles timed out; continuing.'); }
        const src = map.getCanvas();
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, y0, cw, ch); ctx.clip();
        ctx.drawImage(src, 0, 0, src.width, src.height, sx, sy, sw, sh);
        ctx.restore();
      }
    }
  } finally {
    if (map) map.remove();
    host.remove();
  }
  onProgress?.('Adding title, legend and scale bar…', 1);
  await drawFurniture(ctx, state, geo);
  return out;
}

// ---- Map furniture ---------------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const t = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = word; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function niceLength(maxMetres) {
  const p = Math.pow(10, Math.floor(Math.log10(maxMetres)));
  for (const m of [5, 4, 2.5, 2, 1]) if (m * p <= maxMetres) return m * p;
  return p;
}

export async function drawFurniture(ctx, state, geo) {
  const p = state.print;
  const mm = v => v / MM_PER_IN * p.dpi;
  const bleed = mm(geo.paper.bleed);
  const tw = mm(geo.paper.w), th = mm(geo.paper.h);
  const short = Math.min(geo.paper.w, geo.paper.h);
  const margin = mm(Math.max(6, short * 0.03));
  const unit = mm(short / 100);                     // 1% of the short side, in px
  const titleFont = p.titleFont || 'Barlow Condensed';
  try { await document.fonts.load(`700 40px "${titleFont}"`); await document.fonts.load(`500 20px "Barlow"`); } catch { /* fallback fonts */ }
  const X = bleed, Y = bleed;
  const ink = '#1b1b1b';
  const panel = 'rgba(255,255,255,0.9)';

  if (p.showTitle && p.title) {
    const ts = unit * 6, ss = unit * 2.6;
    ctx.font = `700 ${ts}px "${titleFont}", sans-serif`;
    const tW = ctx.measureText(p.title).width;
    ctx.font = `500 ${ss}px "Barlow", sans-serif`;
    const sW = p.subtitle ? ctx.measureText(p.subtitle).width : 0;
    const padX = unit * 2.4, padY = unit * 1.8;
    const bw = Math.max(tW, sW) + padX * 2;
    const bh = ts + (p.subtitle ? ss * 1.5 : 0) + padY * 2;
    ctx.fillStyle = panel; roundRect(ctx, X + margin, Y + margin, bw, bh, unit * 0.8); ctx.fill();
    ctx.fillStyle = ink; ctx.textBaseline = 'top';
    ctx.font = `700 ${ts}px "${titleFont}", sans-serif`;
    ctx.fillText(p.title, X + margin + padX, Y + margin + padY);
    if (p.subtitle) {
      ctx.font = `500 ${ss}px "Barlow", sans-serif`; ctx.fillStyle = '#444';
      ctx.fillText(p.subtitle, X + margin + padX, Y + margin + padY + ts * 1.08);
    }
  }

  // Bottom stack (left): legend above scale bar.
  let bottom = Y + th - margin;
  const attrSize = unit * 1.25;
  if (p.showAttribution && p.credits) {
    ctx.font = `500 ${attrSize}px "Barlow", sans-serif`;
    bottom -= wrap(ctx, p.credits, tw - margin * 2 - unit * 2).length * attrSize * 1.35 + attrSize * 0.6 + unit;
  }

  if (p.showScale) {
    const mPerPx = (geo.scale * MM_PER_IN / 1000) / p.dpi;
    const len = niceLength(Math.min(tw * 0.28, mm(120)) * mPerPx);
    const px = len / mPerPx;
    const fs = unit * 1.7, barH = unit * 0.9;
    const padX = unit * 1.6;
    const label = len >= 1000 ? `${len / 1000} km` : `${len} m`;
    const bw = px + padX * 2 + fs * 2.5, bh = barH + fs * 3.2;
    const bx = X + margin, by = bottom - bh;
    ctx.fillStyle = panel; roundRect(ctx, bx, by, bw, bh, unit * 0.6); ctx.fill();
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : ink;
      ctx.fillRect(bx + padX + (px / segs) * i, by + fs * 1.6, px / segs, barH);
    }
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, unit * 0.12);
    ctx.strokeRect(bx + padX, by + fs * 1.6, px, barH);
    ctx.fillStyle = ink; ctx.font = `600 ${fs}px "Barlow", sans-serif`; ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', bx + padX - fs * 0.25, by + fs * 1.3);
    ctx.fillText(label, bx + padX + px - fs * 0.3, by + fs * 1.3);
    ctx.font = `500 ${fs * 0.85}px "Barlow", sans-serif`; ctx.fillStyle = '#444';
    ctx.fillText(`Scale 1:${Math.round(geo.scale).toLocaleString('en-NZ')}`, bx + padX, by + fs * 1.6 + barH + fs * 1.15);
    bottom = by - unit;
  }

  if (p.showLegend) {
    const items = [];
    for (const L of state.layers.filter(l => l.visible)) {
      if (L.style.colorBy === 'grade' && L.kind !== 'point') {
        items.push({ head: L.name });
        for (const g of GRADES.filter(g => g.id !== 'other')) items.push({ label: g.label, L, color: g.color, indent: true });
      } else items.push({ label: L.name, L, color: L.style.color });
      const bm = (L.source === 'osm' || L.source === 'file') && L.kind !== 'point' ? L.style.bike : 'none';
      if (bm && bm !== 'none' && L.style.show !== 'walk') items.push({ label: 'Bike-friendly', L, color: bm === 'side' ? L.style.color : L.style.bikeColor, stripe: bm === 'side', indent: true });
    }
    if (items.length) {
      const fs = unit * 1.8, row = fs * 1.75, sw = unit * 6, padX = unit * 1.6, padY = unit * 1.2;
      ctx.font = `600 ${fs}px "Barlow", sans-serif`;
      const maxW = Math.max(...items.map(i => ctx.measureText(i.head || i.label).width + (i.indent ? unit * 1.5 : 0)));
      const bw = padX * 3 + sw + maxW, bh = padY * 2 + items.length * row;
      const bx = X + margin, by = bottom - bh;
      ctx.fillStyle = panel; roundRect(ctx, bx, by, bw, bh, unit * 0.6); ctx.fill();
      items.forEach((it, i) => {
        const cy = by + padY + row * i + row / 2;
        ctx.textBaseline = 'middle';
        if (it.head) { ctx.fillStyle = ink; ctx.font = `700 ${fs}px "Barlow", sans-serif`; ctx.fillText(it.head, bx + padX, cy); return; }
        const s = it.L.style;
        const sx = bx + padX + (it.indent ? unit * 1.5 : 0);
        const wpx = mm((s.width || 2) * MM_PER_IN / CSS_DPI);
        if (it.L.kind === 'point') {
          const r = mm((s.size || 5) * MM_PER_IN / CSS_DPI) * (s.icon && s.icon !== 'circle' ? 0.9 : 1);
          ctx.beginPath(); ctx.arc(sx + sw / 2, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = it.color; ctx.fill();
          if (s.casing) { ctx.strokeStyle = s.casingColor; ctx.lineWidth = r * 0.3; ctx.stroke(); }
        } else {
          ctx.lineCap = s.dash === 'dot' || s.dash === 'dashdot' ? 'round' : 'butt';
          if (s.casing) {
            ctx.setLineDash([]); ctx.strokeStyle = s.casingColor;
            ctx.lineWidth = wpx + mm(s.casingWidth * 2 * MM_PER_IN / CSS_DPI);
            ctx.beginPath(); ctx.moveTo(sx, cy); ctx.lineTo(sx + sw, cy); ctx.stroke();
          }
          ctx.setLineDash((DASHES[s.dash] || []).map(v => Math.max(0.01, v) * wpx));
          ctx.strokeStyle = it.color; ctx.lineWidth = wpx;
          ctx.beginPath(); ctx.moveTo(sx, cy); ctx.lineTo(sx + sw, cy); ctx.stroke();
          ctx.setLineDash([]);
          if (it.stripe) {
            const bw = mm(Math.max(1.2, s.width * 0.65) * MM_PER_IN / CSS_DPI);
            const off = wpx / 2 + mm((s.casing ? s.casingWidth : 0.6) * MM_PER_IN / CSS_DPI) + bw / 2;
            ctx.lineCap = 'round'; ctx.strokeStyle = s.bikeColor; ctx.lineWidth = bw;
            ctx.beginPath(); ctx.moveTo(sx, cy + off); ctx.lineTo(sx + sw, cy + off); ctx.stroke();
          }
        }
        ctx.fillStyle = ink; ctx.font = `600 ${fs}px "Barlow", sans-serif`;
        ctx.fillText(it.label, sx + sw + padX, cy);
      });
      bottom = by - unit;
    }
  }

  if (p.showNorth) {
    const s = unit * 4.2;
    const nx = X + tw - margin - s, ny = Y + margin;
    ctx.fillStyle = panel; roundRect(ctx, nx - s * 0.15, ny, s * 1.3, s * 1.75, unit * 0.6); ctx.fill();
    const cx = nx + s * 0.5, top = ny + s * 0.55, base = ny + s * 1.55;
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + s * 0.32, base); ctx.lineTo(cx, base - s * 0.25); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = unit * 0.15;
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx - s * 0.32, base); ctx.lineTo(cx, base - s * 0.25); ctx.closePath(); ctx.stroke();
    ctx.font = `700 ${s * 0.42}px "Barlow", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('N', cx, ny + s * 0.08); ctx.textAlign = 'left';
  }

  if (p.showAttribution && p.credits) {
    ctx.font = `500 ${attrSize}px "Barlow", sans-serif`;
    ctx.textBaseline = 'middle';
    const maxW = tw - margin * 2 - unit * 2;
    const lines = wrap(ctx, p.credits, maxW);
    const lh = attrSize * 1.35;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + unit * 2;
    const h = lines.length * lh + attrSize * 0.6;
    const bx = X + tw - margin - w, by = Y + th - margin - h;
    ctx.fillStyle = panel; roundRect(ctx, bx, by, w, h, unit * 0.4); ctx.fill();
    ctx.fillStyle = '#333';
    lines.forEach((l, i) => ctx.fillText(l, bx + unit, by + attrSize * 0.3 + lh * (i + 0.5)));
  }

  if (p.showCropMarks && geo.paper.bleed > 0) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, mm(0.15));
    const L = Math.min(bleed * 0.8, mm(5));
    for (const [x, y] of [[X, Y], [X + tw, Y], [X, Y + th], [X + tw, Y + th]]) {
      const dx = x === X ? -1 : 1, dy = y === Y ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x + dx * (bleed - L), y); ctx.lineTo(x + dx * bleed, y);
      ctx.moveTo(x, y + dy * (bleed - L)); ctx.lineTo(x, y + dy * bleed);
      ctx.stroke();
    }
  }
}

// ---- Encoding ----------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Insert a pHYs chunk so print software opens the PNG at the right physical size.
function pngWithDpi(buf, dpi) {
  const src = new Uint8Array(buf);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);           // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 8 + 25;                                // after signature + IHDR
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, at)); out.set(chunk, at); out.set(src.subarray(at), at + 21);
  return out;
}

function jpegWithDpi(buf, dpi) {
  const b = new Uint8Array(buf);
  if (b[2] === 0xff && b[3] === 0xe0 && String.fromCharCode(b[6], b[7], b[8], b[9]) === 'JFIF') {
    b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255;
  }
  return b;
}

const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Encoding failed — image too large for this browser')), type, q));

let jsPDFPromise = null;
function loadJsPDF() {
  if (!jsPDFPromise) jsPDFPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => rej(new Error('Could not load PDF library'));
    document.head.appendChild(s);
  });
  return jsPDFPromise;
}

export async function encode(canvas, state, geo) {
  const p = state.print;
  if (p.format === 'png') {
    const blob = await toBlob(canvas, 'image/png');
    return { blob: new Blob([pngWithDpi(await blob.arrayBuffer(), p.dpi)], { type: 'image/png' }), ext: 'png' };
  }
  const jpg = jpegWithDpi(await (await toBlob(canvas, 'image/jpeg', 0.93)).arrayBuffer(), p.dpi);
  if (p.format === 'jpg') return { blob: new Blob([jpg], { type: 'image/jpeg' }), ext: 'jpg' };
  const JsPDF = await loadJsPDF();
  const { W, H } = geo.paper;
  const doc = new JsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
  doc.setProperties({ title: p.title || 'Map', creator: 'Trail Map Studio' });
  doc.addImage(jpg, 'JPEG', 0, 0, W, H, undefined, 'NONE');
  return { blob: doc.output('blob'), ext: 'pdf' };
}

// ESRI world file (EPSG:3857) so the export drops straight back into QGIS.
export function worldFile(geo) {
  const R = 6378137;
  const mpp = (2 * Math.PI * R) / (512 * Math.pow(2, geo.exportZoom)) / geo.pr;
  const x = geo.center.lng * Math.PI / 180 * R;
  const y = Math.log(Math.tan(Math.PI / 4 + geo.center.lat * Math.PI / 360)) * R;
  const x0 = x - (geo.devW / 2) * mpp + mpp / 2, y0 = y + (geo.devH / 2) * mpp - mpp / 2;
  return [mpp, 0, 0, -mpp, x0, y0].map(v => v.toFixed(6)).join('\n') + '\n';
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
