# Trail Map Studio

Make print-ready trail maps from aerial imagery plus trail data. It's a static page that runs entirely in the browser (MapLibre GL, no build step). Open `trail-maps/index.html` through any web server.

## Sources (all OK for selling maps, with credit)

| Source | What | Licence |
|---|---|---|
| LINZ Basemaps | Latest aerial, ~800 regional/historic sets (1950s–2026), yearly Sentinel-2 10 m mosaics, Topo50/250, contours, hillshade, place names, Topo50 tracks | CC BY 4.0 |
| EOX Sentinel-2 cloudless 2016 | Worldwide 10 m satellite (Copernicus) | CC BY 4.0 (EOX's 2017+ years are non-commercial, so they're left out) |
| OpenStreetMap (Overpass) | Paths, MTB, cycleways, 4WD, huts, peaks, custom queries, plus **All trails (combined)** | ODbL: credit "© OpenStreetMap contributors" |
| DOC (ArcGIS open data) | Tracks, huts | CC BY 4.0 |
| Your files | GPX / KML / GeoJSON | yours |

The Print tab builds the credits line for you. Keep it switched on.

## All trails (combined)

This runs one OSM query for paths, footways, bridleways, cycleways, steps, tracks and every way in an MTB/cycle/hiking route relation. Each trail comes out once, tagged:

- `_bike`: cycleway, `bicycle=yes/designated/permissive`, has an MTB grade, or is in an MTB/cycle route (`bicycle=no` always wins)
- `_walk`: a path-type way, `foot=yes/...`, or is in a hiking route
- `_road`: a road section that's only included because it's part of a cycle route

Style options: show everything / bike-friendly only / walkable only. Bike-friendly trails can get a **stripe alongside** or be **recoloured**.

## Pre-built NZ trail data (instant loading)

`.github/workflows/trail-data.yml` runs weekly, or on demand from the Actions tab. It downloads the Geofabrik NZ extract, filters it to trails, routes, huts, peaks and small places, then classifies each feature with the same code the app uses (`tools/build-data.mjs` imports `js/sources.js`). It also adds DOC tracks and huts and packs everything into one PMTiles file. The output is force-pushed to the `trail-data` branch as a single commit, so the repo doesn't keep growing. The app loads it from raw.githubusercontent.com with HTTP range requests.

When the data exists, new OSM and DOC layers default to **Pre-built NZ (instant)**. Any layer can be switched to **Live** to pull the latest edits for the current area from Overpass. The data branch carries its own ODbL notice.

## Export

- Paper A5–A0, Letter, Tabloid, DL or custom size. 150–600 dpi, bleed and crop marks.
- Fit-to-screen or a fixed scale (1:N, true at the centre of the sheet).
- PNG (DPI embedded), JPEG, or PDF at the exact page size. Optional world file (EPSG:3857) to take the image back into QGIS.
- Renders in a single GPU pass up to 8192 px a side, so the result is seamless. Bigger sheets render in overlapping equal-sized parts with deterministic label placement, so nothing is cut at the joins.

## LINZ API key

On first load the app makes a temporary developer key, the same way basemaps.linz.govt.nz does. For a site you sell from, request a free permanent key from LINZ and paste it into Settings.

Shortcuts: `[` / `]` step through older/newer imagery for the area, `F` toggles the print frame.
