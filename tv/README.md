# Ideatious Wall — TV dashboard

A full-screen dashboard for the living-room TV, driven by talking to Claude.
All views are prebuilt into the page; live content arrives as data, so nothing
is regenerated to change what the TV shows.

There are two editions sharing one design:

## 1. Website edition — PRIMARY — `ideatious.com/tv`

`tv/index.html`, served by GitHub Pages from `main`. Simple URL, PIN gate
(default **8642**), no claude.ai login — right for the TV.

- **Weather:** auto-fetched client-side from Open-Meteo every 15 min (no
  Claude needed). A pushed `tv/data/weather.json` (MetService numbers, same
  schema as below) overrides it while `fetchedAt` is under 24 h old.
- **Snow cams:** hot-linked live stills, cache-busted every 10 min.
- **Control (two lanes):** the page polls `tv/data/state.json` on `main` via
  raw.githubusercontent.com every 5 s (snow/weather JSON every 5 min), AND
  listens on a push channel for instant flips. To switch views, commit the
  JSON to main **and** POST the same state JSON to
  `https://ntfy.sh/ideatious-wall-knw73kq3skxg` (curl -d) — the push lands in
  ~1 s, the commit is the durable truth the poll confirms. Egress-blocked
  session? Just commit; the poll catches up in ≤5 s after the CDN sees it.
  Always set a fresh `updatedAt`; the page ignores stale state.
- **Security honesty:** the PIN is a client-side deterrent, not real auth —
  fine for weather/cams/notes; don't put secrets on the wall. The PIN's
  SHA-256 (`sha256("ideatious-wall|" + pin)`) is embedded in `index.html`.
- The page is `noindex` and unlinked from the homepage.

### How Claude drives it (any session with GitHub access to this repo)

Commit JSON to **`main`** — `tv/data/` only; no page rebuild is involved:

| Josh says | Claude commits |
|---|---|
| "show the snow cams" | `tv/data/state.json` → `{"view": "snow", ...}` |
| "show the weather" | `{"view": "weather"}` |
| "back to home" | `{"view": "home"}` |
| "put a note on the TV: …" | `{"view": "note", "note": "…"}` |
| "update the snow report" | `tv/data/snow.json` (schema below) |
| "update the TV weather" (optional) | `tv/data/weather.json` |

Schemas (omit unknown values — the page shows an em-dash; **never invent
numbers**):

```json
// tv/data/state.json
{ "view": "home|weather|snow|note", "note": "", "updatedAt": "<ISO>" }

// tv/data/snow.json
{ "fetchedAt": "<ISO>", "resorts": [
  { "id": "coronet", "name": "Coronet Peak",
    "cam": "<https still-image url>", "camLabel": "aviation cam",
    "report": { "status": "Open", "base": "85 cm", "lifts": "6/7",
                "note": "≤12 words" },
    "source": "where the report came from" } ] }

// tv/data/weather.json (optional override; otherwise Open-Meteo auto)
{ "location": "Queenstown", "source": "MetService", "fetchedAt": "<ISO>",
  "current": { "temp": 12, "icon": "🌦", "condition": "Showers",
               "wind": "NW 25 km/h", "humidity": "68%" },
  "days": [ { "day": "Mon", "date": "2026-09-07", "icon": "🌧",
              "high": 11, "low": 3, "rain": "80%",
              "text": "Rain developing" } ] }
```

### Cam sources (still JPGs, no auth found so far)

- Coronet Peak view: `https://public.aopa.nz/queenstown-coronet.jpg`
- Cardrona valley view: `https://public.aopa.nz/wanaka-cardrona.jpg`
- Queenstown town: `https://www.queenstown.com/cams/aspen.jpg`
- First-party on-mountain cams (scrape the `img src`, then set `cam` in
  snow.json): coronetpeak.co.nz/weather-report ·
  theremarkables.co.nz/weather-report · cardrona-treblecone.com/webcams

Snow reports: those weather-report pages, or OnTheSnow / snow-forecast.com.

## 2. Artifact edition — fast path (~1 s switching, needs claude.ai login)

https://claude.ai/code/artifact/41d29550-e634-4459-b7a7-0896140db9d5

`tv/wall.html`, published as a Claude Artifact with the `db` capability.
Driven via the Artifact tool's `read_db`/`write_db`: doc `tv/state` switches
views instantly; `tv/weather` and `cams/{coronet,remarks,cardrona}` hold data
(cam images as base64 data-URIs ≤200k chars; db doc cap 256 KiB). Protocol
comment lives at the top of `wall.html`.

## Notes for future sessions

- Sessions on restricted-egress environments can't reach the weather/cam
  sites; run data refreshes from a normally-networked session. GitHub and
  claude.ai are reachable from anywhere, so **view switching always works**.
- To change the PIN: hash the new one and update `PIN_HASH` in `index.html`.
- TV setup (Samsung): open the built-in browser → `ideatious.com/tv` → enter
  PIN → set as browser homepage for one-press access.
