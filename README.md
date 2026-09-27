# AskKendal

What Westmorland and Furness Council and Kendal Town Council are deciding about Kendal, on a voxel model of the town.

AskKendal gathers public council information, has an AI model sort it, and places it on a SimCity-style voxel Kendal built from OpenStreetMap, with live River Kent levels from the Environment Agency. It has two doors:

- **Public site** (no login): the voxel map, a searchable list of decisions, and an about page.
- **Council area** (email magic link): every document with its AI scores, items held back from the public, source status and AI spend.

The question-and-answer chat is deliberately **not built yet**. Everything here works without a chat model.

## Run it locally

Requires Node 22 or newer and pnpm 10.

```bash
pnpm install
cp .env.example .env            # then fill in SESSION_SECRET (see the comment in the file)
pnpm db:start                   # embedded Postgres on port 5433 (leave running in its own terminal)
pnpm db:migrate
pnpm ingest                     # council news, town council news, river levels; Jev sorts each item
pnpm dev                        # http://localhost:3000
```

`TYPESAFE_API_KEY` can live in `.env` or in your system environment. Without it, ingestion still works and files items with simple keyword rules. Run `pnpm ingest --rejudge` later to have Jev sort them.

For the council area, put your address in `ADMIN_EMAILS`, open `/council`, and ask for a link. Without `SMTP_URL` set, the link is printed in the `pnpm dev` terminal.

### Database options

- **Embedded (default):** `pnpm db:start` runs [PGlite](https://pglite.dev), real Postgres compiled to WebAssembly, with data in `.data/`. It handles one query at a time, so `.env` sets `DATABASE_POOL_MAX=1`. Good for development and demos.
- **Docker:** `docker compose up -d`, then use the commented Docker `DATABASE_URL` in `.env.example` and remove `DATABASE_POOL_MAX`. The image includes pgvector for the future chat feature.
- **Hosted:** any Postgres 14+ (Neon, Supabase, RDS). Set `DATABASE_URL` and run `pnpm db:migrate`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web app on port 3000 |
| `pnpm ingest` | All sources. `--source council-news,town-council` for some, `--limit 20` to cap downloads |
| `pnpm ingest --rejudge` | Send items filed by keyword rules to Jev (e.g. after adding a key, or the next day after hitting the cap) |
| `pnpm ingest --rejudge-all` | Re-judge everything, e.g. after rebuilding the gazetteer. Cached answers cost nothing |
| `pnpm voxel:build` | Rebuild the voxel town from cached OpenStreetMap data. `--refresh` downloads fresh data |
| `pnpm voxel:stats` | Check the town against the performance budget. Fails if over |
| `pnpm test` / `pnpm typecheck` | Unit tests and type checks for every package |

## How it fits together

```
apps/web          Next.js 16 site: voxel map, decisions, about, council area, API routes
packages/voxel    OpenStreetMap -> compact grid of Kendal; shared greedy mesher; performance stats
packages/ingest   Source adapters, gazetteer geocoder, ingestion pipeline and CLI
packages/ai       Provider-agnostic judgments; TypeSafe Jev client; the civic questions; cache
packages/db       Drizzle schema and migrations (Postgres)
```

### Sources and their status (27 September 2026)

| Source | Status |
| --- | --- |
| Westmorland and Furness Council news | Working. About 80 recent articles |
| Kendal Town Council news | Working, via the site's WordPress API |
| Environment Agency river levels and flood warnings | Working. Live on the map, snapshots stored on each ingest |
| Committee papers: agendas, minutes, reports (ModernGov) | **Blocked.** A Cloudflare bot check refuses automated access |
| Forward Plan of Key Decisions (ModernGov) | **Blocked**, same reason |
| Planning applications | Not built. Will stay in the council area because it names applicants |

**First thing to raise with the council:** the committee papers and the Forward Plan are the most valuable sources and are the ones that are blocked. Ask Westmorland and Furness Council to allow the AskKendal crawler, enable the ModernGov web service (`mgWebService.asmx`), or share a regular export. The adapter records the block on every run, so the council area shows the current status.

### How Jev is used

[Jev](https://docs.typesafe.ai) returns typed judgments, not prose. For each document, one request asks independent questions over the same text:

- **theme**: a choice among nine service areas;
- **Kendal relevance**: a score from 0, not about Kendal, to 3, mainly about Kendal;
- **decision**: the probability it reports a council decision;
- **names private individuals**: the probability it does. At 0.3 or above, the item stays off the public site;
- **impact**: a score from 0, background, to 3, major or time-critical;
- **location**: code finds candidate places from the OpenStreetMap gazetteer, and Jev picks the main one or "none".

Every request is cached in Postgres by a hash of model, state and questions, so repeat questions cost nothing. `JUDGE_DAILY_TOKEN_CAP` stops Jev calls for the day. Items after the cap are filed by rules and can be re-judged later. The council settings page shows spend per day. Set `TYPESAFE_PRICE_PER_MTOK` to see an estimated cost.

### The voxel map and performance

The town is 2,603 by 2,616 cells of 2 m, in five classes: ground, grass, road, water and building. Buildings share one height on purpose.

- **Ship the grid, not the geometry.** The build writes run-length-encoded, gzipped grids of about 330 KB for the whole town. The browser meshes them in a Web Worker at about 0.5 ms per 128 m chunk. Pre-built geometry would have been tens of megabytes.
- **Greedy meshing** merges same-class cells into large rectangles, and walls only where a neighbour is lower. The whole town is about 745,000 triangles, and the worst square kilometre about 85,000.
- **Streaming.** Only chunks inside the visible ground area load; far chunks are freed. Zoomed out, a low-detail town of about 146,000 triangles is drawn instead.
- **Render on demand.** Nothing is drawn unless the camera, a layer or the data changes, so a still map leaves the GPU idle.
- **Cheap shading.** Colours and lighting are baked into vertices. Voxel edges and per-cell texture are drawn in the fragment shader. No lights, shadows, textures or post-processing. Pixel ratio is capped at 1.5, and antialiasing is off on touch devices.
- **Picking** walks the grid in the worker, a few cells per click, instead of ray-testing triangles.
- **Fallbacks.** Without WebGL 2, on low-power devices, or with reduced motion, the site shows a flat MapLibre map instead. There is also a list view of everything on the map. Add `?debug` to the URL to see draw calls and triangles.

`pnpm voxel:stats` enforces the budget in CI: payload 1.5 MB, 300,000 low-detail triangles, and 250,000 triangles and 16 MB in the worst square kilometre.

## Licences and credits

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. The voxel files and gazetteer are derived from it and keep the attribution.
- River data: Environment Agency real-time flood monitoring API, Open Government Licence.
- Flat map tiles: [OpenFreeMap](https://openfreemap.org).
- Council text belongs to the councils. AskKendal stores it to index and link to it. The public site shows only titles, first paragraphs and links.

## Not done yet

- The ask feature: chat plus embeddings. The provider layer and the pgvector image leave room for it.
- Committee papers and the Forward Plan, pending council access.
- Planning applications, for the council area only.
- Traffic, roadworks and resident-concerns layers, and the Storm Desmond flood extent.
- Sponsorship: set `NEXT_PUBLIC_CONTACT_URL` to show a "Get in touch" button on `/about`.
