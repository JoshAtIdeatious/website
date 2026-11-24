#!/usr/bin/env bash
# Gets NZ OpenStreetMap data as nz.osm.pbf. Tries full extracts first, then
# falls back to fetching just the features we need from Overpass in tiles.
set -uo pipefail
OUT=${1:-nz.osm.pbf}
# Every request is time-boxed: abort if a transfer stalls (<50 KB/s for 60 s) or runs too long,
# so one slow server can't hang the whole build.
CURL=(curl -L --fail --retry 3 --retry-all-errors --retry-delay 15 --connect-timeout 30
      --speed-limit 50000 --speed-time 60 -A "trail-map-studio-data-build/1.0")
EXTRACT_MAX=(--max-time 1200)     # ~400 MB extract
QUERY_MAX=(--max-time 700)        # one Overpass tile (server timeout is 600 s)

try_extract() {
  echo "::group::Trying $1"
  if "${CURL[@]}" "${EXTRACT_MAX[@]}" -o "$OUT" "$1" && osmium fileinfo "$OUT" >/dev/null; then echo "::endgroup::"; return 0; fi
  echo "::endgroup::"; rm -f "$OUT"; return 1
}

try_extract https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf && exit 0

# OSM France mirror: read the directory listing rather than guessing the file name.
listing=$("${CURL[@]}" --max-time 60 -s https://download.openstreetmap.fr/extracts/oceania/ || true)
fr=$(grep -oE 'href="new[-_]zealand[^"]*\.osm\.pbf"' <<<"$listing" | head -1 | sed 's/href="//;s/"$//')
[ -n "$fr" ] && try_extract "https://download.openstreetmap.fr/extracts/oceania/$fr" && exit 0

echo "Extract mirrors unavailable; fetching from Overpass in tiles."
mkdir -p tiles
i=0
for lat in -48 -46 -44 -42 -40 -38 -36; do
  for lon in 166 168 170 172 174 176 178; do
    s=$lat; n=$((lat + 2)); w=$lon; e=$((lon + 2)); b="$s,$w,$n,$e"
    q="[out:xml][timeout:600];(way[\"highway\"~\"^(path|footway|bridleway|cycleway|steps|track)$\"]($b);rel[\"route\"~\"^(mtb|bicycle|hiking|foot|walking)$\"]($b);nwr[\"tourism\"~\"^(alpine_hut|wilderness_hut)$\"]($b);nwr[\"amenity\"=\"shelter\"]($b);node[\"natural\"~\"^(peak|volcano)$\"]($b);node[\"place\"~\"^(village|hamlet|locality|isolated_dwelling)$\"][\"name\"]($b););(._;>;);out body;"
    ok=0
    for ep in https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://overpass.kumi.systems/api/interpreter; do
      # Overpass can be silent while it computes, so no stall check here: only the overall time cap.
      if curl -L --fail --retry 2 --retry-delay 15 --connect-timeout 30 "${QUERY_MAX[@]}" -A "trail-map-studio-data-build/1.0" -s -X POST --data-urlencode "data=$q" -o "tiles/t$i.osm" "$ep" && grep -q '<osm' "tiles/t$i.osm" && ! grep -q 'runtime error' "tiles/t$i.osm"; then ok=1; break; fi
      sleep 20
    done
    [ $ok = 1 ] || { echo "Tile $b failed on every Overpass server"; exit 1; }
    osmium sort "tiles/t$i.osm" -o "tiles/t$i.osm.pbf" -O
    echo "tile $b: $(osmium fileinfo -e -g data.count.ways "tiles/t$i.osm.pbf") ways"
    i=$((i + 1))
    sleep 5   # be polite to the shared servers
  done
done
osmium merge tiles/*.osm.pbf -o "$OUT" -O && osmium fileinfo "$OUT" | head -20
