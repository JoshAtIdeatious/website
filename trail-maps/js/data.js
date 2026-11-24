// Pre-built NZ trail tiles (see .github/workflows/trail-data.yml).
export const DATA_BASE = 'https://raw.githubusercontent.com/JoshAtIdeatious/website/trail-data';
export const TILES_URL = `pmtiles://${DATA_BASE}/nz-trails.pmtiles`;

let registered = false;
function register() {
  if (registered || !window.pmtiles) return;
  maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
  registered = true;
}

// Resolves to the build info, or null if the data hasn't been built yet.
export async function checkData() {
  try {
    const r = await fetch(`${DATA_BASE}/meta.json`, { cache: 'no-cache' });
    if (!r.ok) return null;
    const meta = await r.json();
    register();
    return meta;
  } catch { return null; }
}
