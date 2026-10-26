# Denmark in Motion

An interactive atlas of domestic migration between Denmark’s municipalities. It connects questions to verifiable numbers: where movers go, which places gain or lose, and which municipalities exchange many movers with one another.

## What is included

- All published FLY66 years, **2006–2025**: 98 municipalities and Christiansø.
- Every source age, grouped into eight disjoint bands, and both recorded sex categories.
- Directional flow maps, ranked origins/destinations, route comparisons and twenty-year route histories.
- Domestic net-migration maps by count or per 1,000 residents; comparable population denominators from 2008 onward.
- NetworkX Louvain communities for all **540 year × age × sex selections**.
- Local age profiles, historical charts, accessible tables, saved URL filters and CSV exports.
- A source-and-methods dialog with definitions, dates, validation and limitations.

The initial view is Aarhus in 2025. The Copenhagen/thirties and young-adult questions open real filtered views. Stories and numbers are calculated from the selected data, not written examples.

## Run locally

No API key, Node package installation or server-side database is needed to run the published snapshot.

```sh
python3 -m http.server 4320 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:4320`.

## Refresh the data

Python 3.9+ is required for the data pipeline. The application itself has no Python dependency.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_data.py --refresh
.venv/bin/python scripts/build_data.py
.venv/bin/python tests/validate_snapshot.py
node tests/model.test.mjs
```

The importer uses the public `tableinfo` and `data` endpoints at `https://api.statbank.dk/v1/`. Complete single-age data is downloaded in BULK format. Ordinary CSV is used for independent all-age route checks. Only two requests run concurrently, and responses are cached under `.cache/`. Re-running without `--refresh` resumes from the cache. Present-but-missing values are rejected. Absent BULK combinations are zero, as specified by StatBank; `suppressedDataValue` is explicitly checked.

The builder downloads GISCO LAU 2024 geometry once if absent, keeps Denmark’s 99 features and simplifies them for display. Geometry is fixed rather than refreshed annually. Review the visible coverage copy and tests when a new FLY66 year is published. Refreshing the local data does not publish it automatically.

## Validation

```sh
node tests/model.test.mjs
.venv/bin/python tests/validate_snapshot.py
# With the local server running and Python Playwright + Chromium installed:
python3 tests/browser_check.py
```

The builder checks unique source rows, non-negative integer cells, no within-municipality moves, age coverage, population totals and all Copenhagen-origin routes against separately requested source-calculated CSV aggregates for every year and sex (3,960 checks).

The shipped-snapshot check independently recomputes all 540 filtered networks, arrival/departure summaries, conservation of national flows, community totals and all 99 municipality route histories. Browser checks cover desktop/mobile, every control category, route history, URL restoration, CSV contents, population-rate availability, no-population groups and keyboard tab navigation. The browser script saves screenshots under ignored `test-results/`.

## Architecture and hosting

`dist/` is a portable static site. It can be hosted as static files, including on GitHub Pages or Cloudflare Pages, without an application backend. There is no runtime StatBank dependency and no user account or API key needed by the app itself. Hosting access controls may require sign-in.

The initial request loads metadata, the municipality history summaries and one year’s flow network. Other years load on demand. Route histories are stored per origin, so inspecting a connection fetches only the two relevant files. All files are below 1 MB; the complete snapshot is approximately 22 MB before HTTP compression. NetworkX runs during the build, not in the browser. Google Fonts is optional; system fonts are the fallback.

The Sites identity is retained in `.openai/hosting.json`. Publish the exact checked source and `dist/` artifact through the Sites workflow. The new Site is private; the source checkout does not alter its audience.

## Definitions and interpretation

- **Moves are events, not unique people.** Someone can be counted more than once in a year.
- Domestic moves **between municipalities** are included. Moves within a municipality, immigration/emigration, births and deaths are not.
- Net domestic moves are arrivals minus departures. They are **not total population growth**.
- Rates divide net moves by the same age/sex population on **1 January of that year**, then multiply by 1,000. They are not probabilities. FOLK1A starts in 2008; earlier denominators remain null. Zero populations do not produce rates.
- Eight bands cover ages 0–17, 18–24, 25–29, 30–39, 40–49, 50–64, 65–79 and 80–125. “Everyone” sums men and women as recorded by the source. The overall FOLK1A total is never added to its age components.
- Age profiles compare different groups. They cannot track individuals or establish reasons for moving.
- The 2006 migration figures were restated to the municipality structure introduced in 2007; the map is a simplified fixed 2024 reference.
- Communities use the sum of both directional flows as undirected weights. Louvain has resolution 1 and seed 42; results are deterministic for the pinned NetworkX version. Communities are exploratory, not official regions. Their labels and colours are not stable identifiers across filters or years.
- A group’s internal share is moves originating in that group and ending in it, divided by all moves originating in that group. National internal share is stored separately.

## Sources and licences

Statistical data: **© Statistics Denmark, CC BY 4.0**.

- [FLY66 — Internal migration between municipalities](https://www.statbank.dk/FLY66)
- [FOLK1A — Population at the first day of the quarter](https://www.statbank.dk/FOLK1A)
- [StatBank API and reuse terms](https://www.dst.dk/en/Statistik/hjaelp-til-statistikbanken/api)
- [Population movements in 2006; municipality-boundary restatement](https://www.dst.dk/pubfile/11131/hele_bef_udv_2006)

Geometry: **© EuroGeographics for the administrative boundaries**, distributed by Eurostat GISCO, LAU 2024. This geometry has **separate non-commercial use conditions**, not the statistical data’s CC BY licence. Obtain suitable rights or replace the geometry before commercial reuse. Attribution is visible on every map and in the methods dialog.

- [GISCO LAU data](https://gisco-services.ec.europa.eu/distribution/v2/lau/)
- [Specific geometry download and reuse conditions](https://ec.europa.eu/eurostat/en/web/gisco/geodata/statistical-units)

This is an independent atlas, not an official Statistics Denmark product. Source revisions become visible only after a new snapshot is built and published. Exact source-update/import dates and the validation record are embedded in `dist/data/manifest.json` and `dist/data/audit.json`.
