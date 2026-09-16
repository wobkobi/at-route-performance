# AT Route Performance

How far Auckland Transport runs from its own published schedule, measured continuously from AT's own
feeds.

The site polls AT's GTFS-RT trip updates every couple of minutes, stores one row per observed stop
arrival with its signed deviation from schedule, and rolls each completed service day into per-route
summaries that are kept indefinitely. Everything on the front end - the daily boards, the rankings,
the Routes list, the per-route and per-stop pages - is built from those two collections.

## What it measures

- **On time** means 1 minute early to 5 minutes late for buses and trains, 5 minutes either side for
  ferries. That window is a project choice, not AT's.
- **Arrivals** counts stop visits, not trips: one run of a 30-stop route contributes 30.
- **Cancellations** count as the wait a rider had. A cancelled trip records no arrival, so on
  arrivals alone cancelling a service would improve a route's figures. Instead every stop it failed
  to serve counts as late by the gap to the next trip that ran in the same direction, capped at an
  hour: all its stops for a trip that never ran, the stops after the cut for one cut short, none for
  one AT reinstated (see [`src/lib/rider-wait.ts`](src/lib/rider-wait.ts)). This flows into the
  route rows behind the boards, the Routes page and the route pages; the Shame boards and stop pages
  stay on measured arrivals. Cancellations are also counted as trips, on the Cancellations page.
- **Areas** on the Routes page (Central, North Shore, West, East, South, Hibiscus Coast & Rodney,
  Waiheke & islands) come from where each route stopped over the last week, placed against
  approximate boundaries in [`src/lib/areas.ts`](src/lib/areas.ts). AT publishes no fare zone for a
  stop.
- **Detours** come from GPS, not alerts. Each ingest poll measures every bus and train part-way
  through a trip against that trip's road shape, and a trip counts as having left its route when two
  readings more than 200 m off it fall between arrivals it recorded before and after (see
  [`src/lib/off-route.ts`](src/lib/off-route.ts)). AT's detour alert is shown alongside when one was
  active. Ferries are left out, since a sailing's shape is a rough line between wharves.
- **Ghost readings** are excluded. AT reuses a `trip_id` against a later vehicle block, so one run
  can report a near-constant hour-off offset at every stop. A nightly pass classifies those by shape
  rather than by size, so genuinely catastrophic delays survive into the stats (see
  [`src/lib/deviation.ts`](src/lib/deviation.ts)).

## Running it

```bash
npm install
npm run dev
```

Environment (`.env.local`):

| Variable                    | Purpose                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | MongoDB connection string (see `docs/self-host-mongodb.md`)                                                            |
| `AT_API_KEY`                | Auckland Transport API subscription key                                                                                |
| `CRON_SECRET`               | Bearer token the ingest endpoints require                                                                              |
| `RETENTION_DAYS`            | How long raw arrival events are kept, in days. No default - the cleanup refuses a run without it. Production: `3652`   |
| `STORAGE_LIMIT_MB`          | Storage budget the cleanup job works against. Production: `262144` (256 GB)                                            |
| `NEXT_PUBLIC_CARTO_API_KEY` | CARTO basemap key ([free](https://carto.com/basemaps/apikey)); tiles are watermarked without it. Inlined at build time |

```bash
npm run db:push      # apply the Prisma schema
npm run test         # unit tests
npm run test:int     # integration tests against the database in .env.local
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (type-aware)
npm run smoke        # build, start, and visit every public page
```

CI (`.github/workflows/ci.yml`) lints, unit-tests, typechecks and builds every pull request. Its
`smoke` job also builds, starts and visits every page against the real database, and runs only when
the repository has a `DATABASE_URL` secret (`AT_API_KEY` is optional); Dependabot pull requests and
forks get no secrets and skip it. The same check runs against a deployment with
`npx tsx scripts/smoke-test.ts --base-url=https://<your-app>.vercel.app`: every page is read for
leaked values and empty sections, so it is the first thing to run after a deploy.

`.github/workflows/post-deploy-smoke.yml` runs that check automatically: Vercel reports each
finished deployment to GitHub, the workflow probes `/api/health` for the deployed version and then
smokes the deployment URL. Deployment Protection is on, so the workflow needs the project's
"Protection Bypass for Automation" secret as the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`
(Vercel: Settings > Deployment Protection); until it exists the workflow skips with a message. The
smoke script sends the same secret from that environment variable when run by hand. The workflow
also runs on demand ("Run workflow" in the Actions tab, or
`gh workflow run post-deploy-smoke.yml --ref <branch> -f deploy_url=<url>`) against any deployment
that runs the chosen branch's commit.

## Ingest

Data collection runs on scheduled POSTs to `/api/ingest/*`, driven by an external scheduler rather
than Vercel Cron. [`docs/cron-setup.md`](docs/cron-setup.md) lists every job and its cadence;
[`docs/self-host-mongodb.md`](docs/self-host-mongodb.md) is the database runbook.

## City Rail Link

AT renames the train lines when the CRL opens on **13 September 2026**: `STH` becomes `S-C`, `ONE`
becomes `O-W`, and `EAST` and `WEST` merge into `E-W`. Route reads aggregate each new line together
with the lines it replaced, so the archive survives the rename, and retired slugs redirect to their
successor - see [`src/lib/route-lineage.ts`](src/lib/route-lineage.ts). AT publishes the new ids as
`S-C-201`, `E-W-201` and `O-W-201`, and they land in static GTFS days before the first train, so a
retired slug redirects (and the directory swaps the old line for the new) only once the successor
has recorded an arrival.
