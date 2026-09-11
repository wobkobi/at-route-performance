# AT Route Performance

How far Auckland Transport runs from its own published schedule, measured continuously from AT's own
feeds.

The site polls AT's GTFS-RT trip updates every couple of minutes, stores one row per observed stop
arrival with its signed deviation from schedule, and rolls each completed service day into per-route
summaries that are kept indefinitely. Everything on the front end - the daily boards, the rankings,
the per-route and per-stop pages - is built from those two collections.

## What it measures

- **On time** means 1 minute early to 5 minutes late for buses and trains, 5 minutes either side for
  ferries. That window is a project choice, not AT's.
- **Arrivals** counts stop visits, not trips: one run of a 30-stop route contributes 30.
- **Cancellations** are counted separately. A cancelled trip records no arrival, so it can never
  appear as "late" - without a separate count, cancelling a service silently improves a route's
  on-time rate.
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

| Variable               | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`         | MongoDB connection string (see `docs/self-host-mongodb.md`) |
| `AT_API_KEY`           | Auckland Transport API subscription key                     |
| `CRON_SECRET`          | Bearer token the ingest endpoints require                   |
| `NEXT_PUBLIC_SITE_URL` | Public origin, for absolute links                           |
| `RETENTION_DAYS`       | How long raw arrival events are kept                        |
| `STORAGE_LIMIT_MB`     | Storage budget the cleanup job works against                |

```bash
npm run db:push      # apply the Prisma schema
npm run test         # unit tests
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (type-aware)
npm run smoke        # build, start, and visit every public page
```

## Ingest

Data collection runs on scheduled POSTs to `/api/ingest/*`, driven by an external scheduler rather
than Vercel Cron. [`docs/cron-setup.md`](docs/cron-setup.md) lists every job and its cadence;
[`docs/self-host-mongodb.md`](docs/self-host-mongodb.md) is the database runbook.

## City Rail Link

AT renames the train lines when the CRL opens on **13 September 2026**: `STH` becomes `S-C`, `ONE`
becomes `O-W`, and `EAST` and `WEST` merge into `E-W`. Route reads aggregate each new line together
with the lines it replaced, so the archive survives the rename, and retired slugs redirect to their
successor - see [`src/lib/route-lineage.ts`](src/lib/route-lineage.ts). The GTFS route ids AT will
publish are not known yet; both the hyphenated and flattened forms are recognised until they are.
