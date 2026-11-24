#!/usr/bin/env bash
# Gets the NZ OpenStreetMap extract as nz.osm.pbf.
# Geofabrik sometimes refuses connections from GitHub's runners, so we retry both
# extract mirrors for up to ~30 minutes. If they all fail, the build fails and the
# site keeps last week's published data (the twice-weekly schedule catches up).
# (Querying all of NZ via the shared Overpass servers takes hours and isn't fair use.)
set -uo pipefail
OUT=${1:-nz.osm.pbf}
UA="trail-map-studio-data-build/1.0"
# Abort a transfer that stalls (<50 KB/s for 60 s) or runs past 20 minutes.
CURL=(curl -L --fail --connect-timeout 30 --speed-limit 50000 --speed-time 60 --max-time 1200 -A "$UA")

fr_url() {
  local listing
  listing=$(curl -sL --fail --connect-timeout 30 --max-time 60 -A "$UA" https://download.openstreetmap.fr/extracts/oceania/) || { echo "  (OSM France listing unreachable)" >&2; return 1; }
  local f
  f=$(grep -oE 'href="new[-_]zealand[^"]*\.osm\.pbf"' <<<"$listing" | grep -v latest -m1 | sed 's/href="//;s/"$//')
  [ -z "$f" ] && f=$(grep -oE 'href="new[-_]zealand[^"]*\.osm\.pbf"' <<<"$listing" | head -1 | sed 's/href="//;s/"$//')
  [ -n "$f" ] && echo "https://download.openstreetmap.fr/extracts/oceania/$f"
}

for attempt in 1 2 3 4 5 6; do
  for url in https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf "$(fr_url)"; do
    [ -z "$url" ] && continue
    echo "Attempt $attempt: $url"
    if "${CURL[@]}" -o "$OUT" "$url" && osmium fileinfo "$OUT" >/dev/null 2>&1; then
      osmium fileinfo "$OUT" | grep -E 'Size|Timestamp|osmosis_replication_timestamp' || true
      exit 0
    fi
    rm -f "$OUT"
  done
  [ $attempt -lt 6 ] && { echo "Both sources failed; waiting 5 minutes"; sleep 300; }
done
echo "Could not download the NZ extract; keeping the previously published data."
exit 1
