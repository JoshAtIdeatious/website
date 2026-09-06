# Ideatious Wall — TV dashboard

A full-screen dashboard for the living-room TV, driven entirely by talking to
Claude. The page is a published Claude Artifact; every view is prebuilt into
it, and all live content streams from the artifact's shared database — so
switching views is instant (~1 s) and never requires regenerating the page.

- **Live page (open this on the TV, signed in to claude.ai, fullscreen):**
  https://claude.ai/code/artifact/41d29550-e634-4459-b7a7-0896140db9d5
- **Source of truth:** `tv/wall.html` in this repo. Edit here, republish to the
  same artifact URL (`Artifact` tool with `url` set). Republishing is only for
  changing the page itself — data changes go through the database.

## How Josh drives it (voice, any Claude session)

| Josh says | Claude does |
|---|---|
| "show the snow cams" / "snow on the TV" | `write_db` update `tv/state` → `{view: "snow"}` |
| "show the weather" | `tv/state` → `{view: "weather"}` |
| "back to home" | `tv/state` → `{view: "home"}` |
| "put a note on the TV: …" | `tv/state` → `{view: "note", note: "…"}` |
| "update the TV weather" | fetch forecast, `set` doc `tv/weather` (schema below) |
| "update the snow cams" | fetch cam stills + snow reports, `set` docs in `cams` |

All via the **Artifact tool** (`read_db` / `write_db`) against the artifact URL
above. The full schema also lives in a comment at the top of `wall.html`, and
the artifact itself is self-documenting: `Artifact read` on the URL returns the
HTML including that protocol comment.

## Database schema

- `tv/state` — `{view: "home"|"weather"|"snow"|"note", note, updatedAt}`
  (use `db_op: update`; the doc exists)
- `tv/weather` — `{location, source, fetchedAt (ISO), current: {temp, icon,
  condition, wind, humidity}, days: [{day, date, icon, high, low, rain, text}]}`
  (up to 7 days; `set` the whole doc; omit unknown values — the page shows an
  em-dash; **never invent numbers**)
- `cams/coronet`, `cams/remarks`, `cams/cardrona` — `{name, fetchedAt, source,
  image: "data:image/jpeg;base64,…", report: {status, base, lifts, note}}`

**Image budget:** each db doc caps at 256 KiB serialized. Downscale cam stills
to ≤1000 px wide JPEG (~quality 55) so the base64 stays under ~200,000 chars.
E.g. `python3 -c "from PIL import Image; …"` or ImageMagick
`convert in.jpg -resize 1000x -quality 55 out.jpg`.

## Data sources

Weather: MetService per the `metservice-weather` skill (Queenstown), or any
reputable source — always fill `source`.

Snow cams (still JPGs, no auth found so far):

- Coronet Peak view: `https://public.aopa.nz/queenstown-coronet.jpg?dt=<unix-ts>`
- Cardrona valley view: `https://public.aopa.nz/wanaka-cardrona.jpg?dt=<unix-ts>`
- Queenstown town cam: `https://www.queenstown.com/cams/aspen.jpg`
- First-party cam pages (scrape the `img src` for on-mountain cams):
  - https://www.coronetpeak.co.nz/weather-report
  - https://www.theremarkables.co.nz/weather-report
  - https://cardrona-treblecone.com/webcams (stills refresh ~10 min)

Snow reports: the same weather-report pages, or OnTheSnow / snow-forecast.com.

## Environment note

Sessions on restricted-egress environments (like the one that built this)
cannot reach these sites — run refreshes from a session with normal network
access (e.g. Cowork on Josh's phone/Mac). GitHub and claude.ai always work, so
view switching works from anywhere.
