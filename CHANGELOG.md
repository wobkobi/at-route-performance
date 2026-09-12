# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org/);
pre-1.0, new capabilities bump the minor and fixes/chores bump the patch. Merge commits and
local-only exploratory scripts are omitted.

## [1.12.1] - 2026-09-12

### Fixed

- A completed day's boards were held for a week from the moment the day ended, about twenty hours
  before the nightly aggregate classified its ghost readings, so whichever visitor first opened a
  board for yesterday pinned the unclassified version for the week. Every date-scoped aggregation
  (the worst route, trip and stop boards, route, stop and trip stats, the rankings' live days, the
  shame streaks) now holds for a week only once every service day in its window has a
  `DailyRouteSummary`, which the aggregate writes after the ghost pass; until then the caller's
  short TTL applies. The Data Cache judges staleness by the calling TTL, so the state is part of the
  cache key as well: once the summary lands the key changes and the earlier entry is abandoned
  rather than kept fresh under the long TTL. The summary check is one indexed point read cached for
  five minutes.

## [1.12.0] - 2026-09-12

### Added

- Rankings now cover every day in the window, including today. The week and month boards read
  `DailyRouteSummary` for the days the nightly aggregate has covered and scan `ArrivalEvent` live
  for the rest (today, and any earlier day whose aggregate has not run), merging the two by event
  weight. Before, a window fell back to the live scan only when it held no summaries at all, so as
  soon as the first nightly aggregate landed the newest one or two days vanished from `/rankings`:
  on 12 September the week view listed ten routes from a 79-event sliver of 10 September and none of
  the 240,000 arrivals recorded since. Each live day is cached on its own, so every window that
  covers it shares one aggregation, and a summary written for the current service day is ignored in
  favour of the live scan.
- The route page's week view fills the same way: completed days come from the summaries and the rest
  from one live aggregation grouped by service date, using the same real-reading filter and per-mode
  on-time window as the day view, so today appears in the table as it happens. Two versions of a
  route summarised for the same day merge into one row. When the window holds no arrivals the table
  says so instead of leaving a bare heading over `0` and dashes.

### Fixed

- Live-day boards counted AT's predictions for stops not yet due. The ingest stores the predicted
  arrival for every remaining stop of a running trip and revises it each poll, so a window reaching
  past the present ranked guesses alongside observations. Every stats aggregation over a live window
  (rankings, the worst route, trip and stop boards, route and stop stats, the shame boards) now
  clips its end to the present; completed days are unchanged, and the trip timeline still shows a
  run's upcoming stops.

## [1.11.8] - 2026-09-12

### Changed

- Dependencies advanced: Next.js, `@next/bundle-analyzer` and `eslint-config-next` to 16.3.5, zod to
  4.6.2, `eslint-plugin-jsdoc` to 64, and vitest to 5 (which now needs `vite` installed alongside
  it). Three majors were tried and held back: Prisma 7 has no MongoDB connector; TypeScript 7.0
  builds and typechecks but typescript-eslint refuses to load under it, so lint and the pre-commit
  hook fail; ESLint 10 breaks `eslint-plugin-react` 7.37.5, which `eslint-config-next` depends on
  and which supports ESLint 9 at most. TypeScript stays at 6.0.3 and ESLint at 9.39.5.

## [1.11.7] - 2026-09-12

### Fixed

- Every Mongo pipeline that buckets runs by service day (the shame-of-the-week route, trip and stop
  boards and the route streak heatmap) derived the day by subtracting five absolute hours and then
  truncating to the Auckland calendar date. On a DST-switch Sunday the five-hour shift crosses the
  transition: 27 September 2026 05:30 NZDT minus five hours is 26 September 23:30 NZST, so the first
  hour of the new service day filed under the day before and the week boards showed two rows
  labelled 26 September; on 5 April the same shift files 04:30 NZST under 5 April instead of 4
  April. One shared expression, `serviceDateExpr`, now decides from the Auckland hour exactly as
  `nzServiceDayString` does and yields the date string itself, so the pipelines no longer hand back
  an instant for a second helper to reformat.
- `scripts/check-data-gaps.ts` labelled every day one short: it took the UTC date of the Auckland
  midnight instant, which is the previous date. It now buckets events and ingest runs by the same
  service-date expression, so its tables line up with each other and with the site.
- `scripts/backfill-aggregate.ts --days=N` stepped back in 24-hour blocks from the wall clock, which
  can skip or repeat a day across a DST switch; it now steps by service date from the current
  service day.

### Added

- `npm run test:int` runs integration tests (`src/**/*.int.test.ts`) against the database in
  `.env.local`. The first proves MongoDB evaluates the service-date expression as the TypeScript
  helper does at fifteen boundary instants across both DST switches, through a collectionless
  `$documents` pipeline that touches no collection. The unit run excludes these files.

## [1.11.6] - 2026-09-12

### Added

- Regression tests for the City Rail Link station names as AT publishes them. The platforms are
  `Te Waihorotiu Train Station 1` and `Waitemata Train Station 3` under their station's parent id
  and collapse onto it; `Stop C Te Waihorotiu Station` is a bus pole under the bus-station parent
  and keeps its own id; a stale platform row the feed left without a parent goes to the name-keyed
  legacy id. Pins the behaviour before the 13 September cutover puts real arrivals through it.

## [1.11.5] - 2026-09-12

### Fixed

- A retired City Rail Link line redirected to its successor as soon as the successor's route row
  existed. AT published `S-C-201`, `E-W-201` and `O-W-201` in static GTFS on 10 September, three
  days before the first train, so `/route/STH`, `/route/EAST`, `/route/WEST` and `/route/ONE` were
  already bouncing to lines with nothing to show (the redirect streams inside the page shell, so
  browsers followed it while a plain HTTP probe saw a 200). The redirect now waits until the
  successor has recorded an arrival in the last seven days, checked with one indexed point read that
  is cached for ten minutes, so a retired line's page stands until its replacement is actually
  running and then moves within ten minutes of the first train.
- The route directory listed a successor line beside the line it replaces. It now lists exactly one
  of the two: the retired line until the successor is running, then the successor, so the 404 page
  and `GET /api/routes` never offer an empty line or a link that bounces.
- Cross-route rankings listed one line twice when the window spanned a change of route id: a feed
  republish that bumps the version suffix (`501-217` and `501-218` both run in a week with a
  schedule change), and the CRL cutover, where the retired line and its successor each earn a row in
  the same week or month. `/rankings`, the home page boards and `GET /api/routes/top` now fold such
  rows into one per line, summing events and event-weighting the averages and percentages, and the
  merged row carries the successor's (or newest version's) name and colour. A retired line with no
  successor row in the window is left alone, so nothing changes before the cutover.
- The lineage map now carries the published ids only; the flattened `SC`/`EW`/`OW` fallbacks that
  covered the unknown spelling are gone.

## [1.11.4] - 2026-09-12

### Fixed

- Auckland local midnight on a DST-switch day resolved an hour off. `nzLocalToUtc` sampled the
  offset once, at UTC midnight, which is local noon and already on the far side of the 02:00/03:00
  switch, then applied that offset to local midnight on the near side. The offset is now resolved in
  two passes (estimate, then re-sample at the estimate), so 27 September 2026 starts at NZST
  midnight and runs 23 hours, 5 April 2026 starts at NZDT midnight and runs 25 hours, and the week
  and month ranges built on it end on the right instant. Only a range whose start date is itself a
  switch Sunday was affected: no week (they start on Mondays) and no month before April 2029.
- The rankings page's previous-week comparison window stepped back by a fixed seven days of
  milliseconds, which lands an hour off the 5am service-day boundary when the two windows straddle a
  DST switch; it now steps by service date.

## [1.11.3] - 2026-09-12

### Fixed

- The summary rankings pipelines divided by a stored `events` total with no guard, unlike the live
  path beside them. Both writers count events with `$sum: 1`, so a zero cannot be stored today, but
  Mongo throws on a zero divisor rather than returning NaN, and a single such row would take the
  whole rankings page down. The divisors now go through the same `$max: [1, ...]` guard the live
  path uses.

## [1.11.2] - 2026-09-12

### Fixed

- `Route.lastSeenAt` was being stored as an ISO string. The routes sync handed a JS `Date` to
  `$runCommandRaw`, which JSON-serialises its arguments, so every stamp landed as text: Prisma then
  refused to read the field as `DateTime` (P2023), `GET /api/routes` answered 500, and the 404 page
  silently dropped its route directory. The stamp now goes through extended JSON (`{ $date }`) like
  every other raw write, a unit test pins that shape, and `scripts/migrate-last-seen-at.ts` converts
  the stored strings in place.
- The route directory no longer lists rows that carry no `lastSeenAt` once any stamp exists. A row
  the last sync did not touch is one AT no longer publishes; treating it as current kept nine
  superseded route versions beside their replacements and six retired routes in the directory.

## [1.11.1] - 2026-09-12

### Changed

- `noUncheckedIndexedAccess` is on. Every array and object-key index now reads as possibly
  undefined, and the 198 places that relied on the old assumption are made explicit: real narrowing
  where a missing element is a genuine case, a `??` fallback where a sensible default exists,
  `.at()` for last-element reads, and small parse helpers (`parseYmd` / `parseYm` in `time.ts`)
  where the same `split("-")` destructure had been repeated. No non-null assertions and no `as`
  casts were added, and no exported function signature changed. `DirectionFilter`'s `hrefs` prop now
  requires `both`, which its only caller already passed.
- `DayNav` drops its private `shiftDate` and weekday table in favour of `shiftWeek` and
  `weekdayShort` from `time.ts`, which it had duplicated byte for byte.
- `scripts/tsconfig.json` no longer overrides `moduleResolution` to `node`, which TypeScript 6
  deprecates; it inherits `bundler` from the root config. The root `include` drops a `tests`
  directory that never existed.
- File-level `@description` JSDoc blocks in the files this change touched are demoted to plain `//`
  lines: a top-of-file block attaches to no declaration, so the tag was dead ceremony.

## [1.11.0] - 2026-09-11

### Added

- Ghost re-reports are classified out of the stats. AT reuses a `trip_id` against a later vehicle
  block, so a vehicle running about an hour off its slot reports that same offset at every stop of
  the trip, and a couple of those float a quiet stop to the top of the worst-stops board. A nightly
  pass over each completed service day tells a ghost apart by its shape rather than its size: it
  sits at a near-constant offset from the run's own level, while a real delay accumulates along the
  trip. A magnitude cap cannot make that distinction, and would throw away the genuinely
  catastrophic delays this site exists to show. Rows are flagged, never deleted, and re-running a
  day clears its flags first, so the pass is idempotent.
- A cancelled-trips board. Cancellations sit outside every other board here: a cancelled trip
  records no arrival, so it cannot be ranked by lateness and it cannot drag an on-time rate down -
  it silently improves one. This is where that shows.
- Route brand colours are checked for legibility instead of trusted. AT publishes `route_color` for
  its own maps and printed material: the Eastern Line's yellow sits at about 1.7:1 against the page
  surface, well under the 3:1 minimum for a meaningful non-text graphic, and Te Huia ships pure
  black. The contrast is measured rather than kept as an exception list, since the City Rail Link
  brings new lines and new colours in September 2026.
- The route directory can list only what currently runs, off the new `lastSeenAt` stamp. Rows are
  still never deleted, so a retired route keeps its retained summaries and its URL keeps resolving.

### Changed

- A station's identity is now AT's own `parent_station` id wherever the feed supplies it, falling
  back to the name only when it does not. AT renames stations (Britomart became Waitemata, Mount
  Eden became Maungawhau, with more to come from the City Rail Link), and a name-keyed id changes
  with them, forking a station's history and breaking every shared link.
- Service alerts are graded by effect. The feed mixes line closures with routine notices, and
  rendering both in the same alarm styling is what teaches people to ignore the bar, so only a
  service-stopping effect gets the loud treatment.
- Loading skeletons honour `prefers-reduced-motion`.
- The README describes the project instead of `create-next-app`.

## [1.10.1] - 2026-09-11

### Fixed

- The self-hosted database could not build indexes at all. mongod presents one certificate for both
  client traffic and its own replication connections, and a replication connection is a client
  connection, so the certificate needs the `clientAuth` extended key usage. Let's Encrypt stopped
  issuing that usage, so from the 8 July renewal onward mongod rejected its own replication
  connections with `unsuitable certificate purpose` and every `createIndex` hung forever. Reads,
  writes and index drops stayed fast throughout, which is why nothing looked wrong. A separate
  self-signed cluster certificate (`--tlsClusterFile` / `--tlsClusterCAFile`) now carries
  member-to-member TLS, so an ACME renewal cannot break replication again.
- `npm run smoke` never ran from a clean install: `scripts/smoke-test.ts` imports puppeteer, which
  was not a dependency. It only worked while a stray copy sat in `node_modules`, so `pre-push` was
  failing for anyone starting fresh.
- `npm run analyze` was dead for the same class of reason. The `dotenv` package ships no CLI, so
  `dotenv -v ANALYZE=true -- next build` had no binary to run; `dotenv-cli` supplies it.
- The runbook claimed `mongorestore` rebuilds every index. It does not reliably: the builds are a
  per-collection final phase, and an interrupted restore leaves the documents in place with some
  collections holding only `_id_`. Nothing reports the gap, so the verification checklist now starts
  with an explicit index check.

### Changed

- Dependencies advanced 17 packages. Five majors are held back deliberately: Prisma 7 has no MongoDB
  connector (Prisma's own docs recommend 6.19 for MongoDB), ESLint 10 conflicts with the
  `eslint-plugin-react` peer that `eslint-config-next` pins, and TypeScript 7, Vitest 5 and
  `eslint-plugin-jsdoc` 64 are untested majors.
- CI now builds Dependabot pull requests instead of skipping them, because auto-merge treats a green
  run as the signal that a bump still compiles; skipping the build while auto-merging meant merging
  bumps nothing had built. Auto-merge parses the version pair in the title and holds back majors,
  and pre-1.0 minors, for a person to judge. Push runs are limited to `main`, since the
  `pull_request` event already covers every branch with an open pull request.
- `tsconfig.json` gains `noImplicitOverride` and `noFallthroughCasesInSwitch`, both clean at zero
  errors. `noUncheckedIndexedAccess` is not adopted: it reports 198. `ignoreDeprecations` and
  `baseUrl` are dropped as vestigial.
- `lint` and `lint:fix` cache to `.eslintcache`, and the pre-commit hook refreshes the lockfile at
  most once a day rather than on every commit.

## [1.10.0] - 2026-08-07

### Added

- Train lines now read as their published names. AT sets every train route's `route_long_name` to
  the bare code, so the header showed only "STH"; it now shows "Southern Line" beside the code, and
  covers the City Rail Link codes that replace them on 13 September 2026 ("S-C" > "South City Line",
  "E-W" > "East West Line", "O-W" > "Onehunga West Line") plus "HUIA" > "Te Huia".
- Route history survives the CRL rename. The cutover retires `STH`, `EAST`, `WEST` and `ONE` and
  introduces `S-C`, `E-W` and `O-W` (Eastern and Western merge into one line), which would strand
  every retained `DailyRouteSummary` under a slug that never receives another event and restart the
  replacement from zero. Route reads now aggregate a line together with the lines it replaced, and a
  retired line's URL redirects to its successor once that appears in the feed. Both hyphenated and
  flattened forms of the new codes are recognised, since AT has not yet published the ids.

### Fixed

- The fleet KPI strip labelled its headline count "Trips" when it counts stop arrivals - one trip
  contributes one row per stop it serves, so the number read 20-40x higher than the trips it
  claimed, and contradicted the "Of all arrivals" popover directly beneath it. Now "Arrivals".
- The GTFS static sync read `version` from AT's `/versions` payload, which only carries
  `feed_version` - so the version always came back `undefined`, the sync's version gate never
  engaged, and `gtfs_version` was never stored. The version is now read correctly and selected by
  the `feed_start_date`/`feed_end_date` window covering the service day, since AT sends no
  `is_current` flag. This is the gate that pulls in the renamed routes at the cutover.
- The stop sync no longer stores AT's ~140 `location_type: 1` parent stations. Nothing departs from
  one, so they could never gain an arrival event, and each duplicates the name of the platforms
  beneath it in the stop directory.

### Changed

- Stops keep their GTFS `parent_station` and `platform_code`, so station collapsing can key off AT's
  own grouping rather than off stop names, which AT renames (Britomart > Waitemata, Mount Eden
  > Maungawhau).

## [1.9.5] - 2026-07-23

### Fixed

- Service-alert ids arriving as non-strings from the GTFS-RT feed no longer stringify objects into
  `"[object Object]"` (caught by the new `no-base-to-string` rule): numeric ids still convert,
  anything else falls back to an empty id.
- The acknowledge-then-run cron handlers (aggregate, cleanup, shapes) are plain synchronous
  functions now; they never awaited anything before their 202 response.

## [1.9.4] - 2026-07-23

### Changed

- Dropped the type assertions the new type-aware lint pass proved redundant (ingest debug stats,
  mem-cache inflight promise, rankings test rows, route-view pattern fallback). The triangle
  layout's mid-node map keeps its `labelDir` type via an annotated callback return instead - the
  literal widened to `string` without one, which the removed cast had been masking.

## [1.9.3] - 2026-07-23

### Changed

- Lint/format toolchain overhaul: core ESLint recommended rules now apply (the Next presets never
  enabled them), type-aware `typescript-eslint` rules run over `src/` (async-correctness checks on;
  the `no-unsafe-*` family stays off until the SDK/JSON boundaries are typed), and the new
  `tailwind-canonical-classes` rule collapses arbitrary values that have a scale equivalent.
  Prettier now sorts Tailwind classes inside `cn()`/`clsx()`/`twMerge()` calls, not just `className`
  attributes.
- Hooks tightened: pre-commit re-stages `package.json`, auto-fixes staged files
  (`eslint --fix --no-warn-ignored`) and runs a full typecheck; pre-push reuses the fresh build for
  the smoke test via `--skip-build`.
- Dependency refresh: Next 16.2.11, React 19.2.8, TypeScript pinned at 6.0.3, ESLint pinned at
  9.39.5, `sharp` added with a version override, and `cross-env` swapped for `dotenv-cli` (the
  `analyze` script now goes through it).

## [1.9.2] - 2026-07-09

### Fixed

- Runbook connection-string section pointed at a stale example storage allowance; it now defers to
  the retention section for `STORAGE_LIMIT_MB` and `RETENTION_DAYS`.

## [1.9.1] - 2026-07-09

### Changed

- Retention policy raised to ten years (`RETENTION_DAYS=3650`, `STORAGE_LIMIT_MB=262144`) for the
  self-hosted database. The runbook gains a sizing section (~23 GB/year, ~230 GB steady state from
  measured per-document costs), WiredTiger cache guidance, and a backup-strategy shift: nightly
  logical dumps retire in favour of ZFS snapshots + replication once the archive outgrows them. The
  day-marker walk-limit comment no longer assumes 14-day retention.

## [1.9.0] - 2026-07-09

### Added

- `GET /api/freshness`: public read-only endpoint returning the footer's last-updated/next-update
  instants, backed by the same 60s-cached lookup the server render uses.

### Fixed

- The footer freshness line went permanently red ("update due now") on any tab left open longer than
  the 2-minute ingest cadence: the instants were rendered once on the server and only the relative
  label ticked client-side. An open tab now re-polls `/api/freshness` every 60s (skipping hidden
  tabs, catching up on return), and the newest instant wins between the server render and the poll.

## [1.8.1] - 2026-07-09

### Fixed

- Self-host runbook corrected against the real TrueNAS install: the catalogue MongoDB app is
  unusable (no extra-args field, forced user creation) so the Custom App YAML is the only path;
  MongoDB 8.2.x needs `--setParameter tlsUseSystemCA=true` (chain-of-trust startup failure) plus
  `--tlsAllowConnectionsWithoutCertificates` (else it demands client certs); the combined PEM needs
  a newline between cert and key ("PEM routines::bad end line"); TrueNAS ACME issues
  `<name>-acme.crt`/`-acme.key` (the plain `.key` is the CSR's); added the `vm.max_map_count` sysctl
  prerequisite.

## [1.8.0] - 2026-07-08

### Added

- Self-hosted MongoDB support: the database can now run as a MongoDB 8 app on TrueNAS SCALE
  (single-node replica set for Prisma, TLS + SCRAM auth, non-default port) instead of Atlas, for
  $0/mo hosting with room to grow retention. `docs/self-host-mongodb.md` is the full runbook -
  setup, cert renewal, ZFS-snapshot and nightly-dump backups, Atlas dump/restore migration with a
  crons-paused cutover, and rollback. No code changes required; `DATABASE_URL` and the existing
  `STORAGE_LIMIT_MB` / `RETENTION_DAYS` env vars carry the switch.

### Changed

- Comments in `src/lib/db.ts` and `src/lib/data.ts` no longer describe the idle-reset retry and the
  in-memory sort limit as Atlas-specific, and `docs/cron-setup.md` points at the new runbook for the
  connection string.

## [1.7.8] - 2026-07-08

### Fixed

- Dropped the single-field `scheduledAt` index on ArrivalEvent (64.6MB at 3.2M events): the
  `[scheduledAt, routeId]` compound serves every plain scheduledAt range and sort via its prefix,
  confirmed with explain plans after the drop (no in-memory sort). Applied directly to the
  production cluster; the schema change keeps `db:push` consistent.
- The cleanup storage warning now reports real on-disk sizes from `dbStats` (compressed data +
  indexes, with the allowance overridable via `STORAGE_LIMIT_MB`) instead of a 250-bytes/event
  estimate that overstated usage by ~2x, and no longer asserts the cluster is an Atlas M0.

## [1.7.7] - 2026-07-08

### Fixed

- Vercel functions now run in `syd1` (Sydney) beside the Atlas cluster instead of the default `iad1`
  (US East). Every DB round trip was paying ~210 ms iad1 > Sydney; uncached renders issue several
  sequential round trips, and NZ visitors also reach Sydney faster than US East.

## [1.7.6] - 2026-07-08

### Fixed

- The earliest/most-recent data-day markers and the latest-event lookup no longer scan the whole
  ArrivalEvent collection (~17 s each at 3.2M events on the shared cluster). They now read the
  collection's endpoint event via the `scheduledAt` index and, when a qualifying threshold is set,
  count candidate service days with indexed range counts (~30-200 ms). `getEarliestDataDay` sits on
  every page's critical path, so cache misses were the 17-27 s page loads.

## [1.7.5] - 2026-07-08

### Fixed

- The slow cron jobs (gtfs sync, shapes, aggregate, cleanup) now acknowledge with 202 and run after
  the response: cron-job.org drops requests at 30 s, so a ~40 s cleanup reported "Failed (timeout)"
  even though it completed. Outcomes are recorded in IngestRun and the function logs.

## [1.7.4] - 2026-07-08

### Fixed

- Dedupe script gains `--since=<hours>` so a recent-only rescan can win the race against the
  2-minute ingest cadence when rebuilding the unique index.

## [1.7.3] - 2026-07-08

### Fixed

- `db:push` now runs only on production builds. It sat in the shared Vercel `buildCommand`, so any
  preview build of a stale branch (e.g. a Dependabot PR based on main) synced its old schema against
  the production database - dropping the new ArrivalEvent unique index and letting duplicates
  accumulate unchecked.

## [1.7.2] - 2026-07-07

### Fixed

- Shame week boards showed eight day-rows ("Monday to Monday"): the day list now clamps to service
  days starting inside the window, and the rolling week no longer gains or loses a day across DST.
- Weekday labels on the week boards were one day ahead of the dates beside them.
- The hourly shame boards went nearly empty between midnight and 5am NZ (the live-hours filter
  dropped the whole daytime instead of the not-yet-started hours).
- Route service alerts never matched: the feed's versioned route ids ("NX1-202409") are now
  normalised before comparing, restoring the route alert banner, detour dashing and stop disruption
  rings.
- The trip timeline page returned a 500 for a malformed `?d=`; impossible calendar dates like
  `2026-02-31` no longer silently normalise onto a different day; a raw `%` in a stop URL no longer
  throws.
- Worst-route week rows drilled down to the rolling "Last 7 days" instead of the week being viewed.
- Routes with no measurable delay data showed "on time" instead of a dash in the tables and boards.
- Streak counts bridged missing days as consecutive and skipped a day across the spring DST change.
- The daily aggregate silently dropped events for routes not yet in the static GTFS sync.
- The realtime ingest stored duplicate rows per stop visit as predictions were revised (~5% of all
  events); arrival events now upsert on the stop visit and existing duplicates were removed.
- The backfill script parsed dates with a fixed +12:00 offset (wrong during NZDT).

### Security

- Removed the unauthenticated `POST /api/routes` and `POST /api/stops` write endpoints.

### Added

- Month view for the three shame boards (`?window=month`), with month stepping; the rankings month
  cards now land on it, and the rankings page gained prev/next month navigation.
- `/api/warm` cron endpoint that pre-computes yesterday's boards after the nightly ingest.

### Performance

- Completed service days now cache for a week across the data layer (they are immutable), so week
  and month views are warm after their first computation.
- The shame boards, rankings, home cards and stop departures stream in behind an instant header
  shell instead of blocking the whole page on cold aggregations.
- The rankings stepper bound is fetched alongside the anchor query instead of after the batch, and
  the earliest-day marker's cache lifetime reflects how rarely it moves.

## [1.0.0] - 2026-06-25

### New pages

- `/shame` - worst trip and worst stops of the selected day, week, or month. Supports `?window=week`
  and `?window=month` with week/month navigation and a direct link to the offending trip timeline.
- `/shame/stop` - stop-level shame board: ranks stops by off-schedule arrival count for the selected
  period, with a worst-stop card and drill-down to the stop detail page.
- `/stop/[id]` - per-stop schedule page showing today's planned arrivals, live delay badges, and
  links to each trip's stop-by-stop timeline.
- Custom 404 page.

### Route page

- Route week summary: a two-week calendar of per-day on-time rate and event count, with prev/next
  week navigation and a boundary check so the back button disappears at the earliest available data.
- Period-aware week and month views: the route page accepts `?window=week&period=YYYY-MM-DD` and
  shows aggregate punctuality stats and the worst-trips board for that period.
- Direction chips let riders toggle between inbound and outbound on the line diagram.

### Rankings and shame links

- Rankings links to route, shame, and worst-stop pages now carry the active `window` and `period`
  params so clicking through from a weekly or monthly view preserves the context.
- `ShameOfDay` copy adapts to the selected period: "Shame of the week", "No shame this month", etc.
  instead of always reading "day".

### Alerts and data freshness

- AT service alerts banner: active disruptions from the AT API appear on the home page and on
  affected route pages. Alerts are fetched on each revalidation and dismissed per-session.
- Data freshness indicator on the home page shows when the last successful ingest ran and how many
  events it inserted.

### Ingest and data fixes

- Fix aggregate cursor truncation: daily aggregate runs were silently capped at 101 routes
  (MongoDB's default first-batch limit). Changed to `cursor: { batchSize: 100_000 }` so all routes
  are captured; rebuilding historical summaries raised per-day route counts from ~101 to 460-512.
- Cleanup endpoint gains an optional `?summaryDays=N` param to prune `DailyRouteSummary` records
  older than N NZ service days.

### Maintenance

- Remove one-off diagnostic and spike scripts. Keep `backfill-aggregate.ts`, `check-data-gaps.ts`,
  `check-routes.ts`, `rebuild-daily-summaries.ts`, and `smoke-test.ts`.

## [0.21.0] - 2026-06-19

- Restyle the site to feel like Auckland Transport's own: a solid Shore-blue header bar with the
  white AT logo and nav, a dark Ocean footer with links and an "independent project" note, unified
  AT pill controls (mode/school/delay filters, day stepper, window + trip sort chips) via shared
  `.chip` classes, and a hairline border on every card.

## [0.20.1] - 2026-06-19

- Make the route trip board heading match the mode: "Ferries of the day" / "Trains of the day"
  instead of always "Buses of the day".

## [0.20.0] - 2026-06-19

- Sort the route page's "buses of the day" board: by most off-schedule (default), latest, earliest,
  or departure time, via sort chips that keep the selected day.

## [0.19.1] - 2026-06-19

- Show ferries when the Ferry filter is selected. The boards required >=10 events, which a ferry
  rarely reaches in a day (they run a handful of times), so picking Ferry came up empty. A
  single-mode view now uses a lower event threshold so low-frequency modes appear.

## [0.19.0] - 2026-06-19

- Make the route map follow the actual road. Each direction's path now uses its GTFS shape geometry
  (from the new `Shape` collection) instead of straight stop-to-stop lines, drawn as two parallel
  offset lines so the two directions read separately. Routes without a stored shape fall back to the
  straight stop-to-stop line.

## [0.18.0] - 2026-06-18

- Ingest GTFS route geometry: a new `/api/ingest/gtfs/shapes` endpoint downloads AT's full GTFS zip,
  extracts `shapes.txt`, simplifies each shape, and upserts it into a new `Shape` collection (keyed
  by `shape_id`). This backs the road-following route map. Documented as a weekly cron job.

## [0.17.0] - 2026-06-18

- Polish the line diagram: draw every direction (and disjoint sub-pattern) at one shared scale so it
  fills the card width and dot/label sizes stay consistent; only fork for substantial divergences
  (no tiny 1-2 stop offshoots); reserve space so the angled delay labels no longer clip at the edge;
  show variants that share no origin with the trunk as their own labelled lines instead of dropping
  them; hide stops the route has not served in the past week (origin termini, never-served pattern
  stops) while keeping recently-active stops without today's data as neutral dots; and add a
  hover/focus tooltip showing each stop's name and delay.

## [0.16.0] - 2026-06-18

- Rework the route line diagram in the style of AT's rapid-transit map: one bold, rounded trunk line
  per direction that snake-wraps to stay on-screen, with trip variants that end at different spots
  forking off at 45 degrees, and white stations ringed by their average delay (termini drawn
  larger).
- Base the day-focused views on a transit **service day** (5am to 5am the next day) instead of the
  calendar day, so a route's post-midnight runs count under the day they started; the trip timeline
  and the "most recent day with data" fallback use it too.
- Show the actual service **date** with prev / next day arrows on the home and route pages (a
  `?day=` link) instead of just labelling it "today", so you can step back to earlier days.

## [0.15.1] - 2026-06-18

- Fix the per-trip timeline mixing multiple service days: a GTFS trip id repeats every day it runs,
  so `getTripTimeline` matched every day's run at once, showing stops out of order and duplicated.
  Scope it to the run's day (the worst-buses board now passes it), falling back to the trip's most
  recent day, and collapse a stop that recorded two actuals into one row.

## [0.15.0] - 2026-06-18

- Style the route map's live vehicles as AT-style markers: the route's mode glyph (bus/train/ferry)
  on a white disc, ringed in the punctuality colour, with a same-coloured arrow on the ring pointing
  the direction of travel. Stops stay as the only black-outlined dots.

## [0.14.0] - 2026-06-18

- Replace the home/rankings "Running latest" and "Running earliest" boards with a single "Most
  off-schedule" list ranked by how far off schedule each route ran (largest absolute average
  deviation), with All / Late / Early filter chips that compose with the mode and school filters.
- Fix the school-bus filter hiding almost no school services: the `S###` code lives in the route's
  long name (the short name is the plain number, e.g. `046`), and the code can carry a trailing
  variant letter (e.g. `S046D`, `S001N`). Match the pattern in either name so school services are
  excluded by default as intended.

## [0.13.0] - 2026-06-18

- Refresh the site's look and layout, keeping the AT identity (no dark mode): a real top navigation
  (Today / Rankings) with a metro-line colour accent under the header and on every page masthead, a
  slim footer noting the data source, and a more editorial home headline that names the day.

## [0.12.0] - 2026-06-18

- Add a branching, metro-style line diagram below the route map: each direction's stops in order,
  with forks where trip variants diverge (some runs end early or go via a different segment) and
  each stop node coloured by its average delay. Stop order comes from the AT GTFS schedule; there is
  no schema change.

## [0.11.0] - 2026-06-18

- Add a per-trip timeline page (`/route/[id]/trip/[tripId]`) showing one run's stop-by-stop
  scheduled times and how early or late it was at each stop, reached from the worst-buses ranking.

## [0.10.0] - 2026-06-18

- Revamp the route detail page around a "worst buses of the day" ranking: each run of the route,
  ranked by how far off schedule it ran (average absolute deviation), showing its scheduled start,
  vehicle, and stop count, each linking to that run's stop-by-stop timeline. The page is now
  day-focused (today, falling back to the most recent day with data), like the home page.
- Turn the route map into a proper route map: draw the route path between stops in order, outline
  the stop nodes so they pop, and show live buses as heading arrows pointing the way they are
  travelling. The path uses straight segments between stops - AT's API exposes stop order but no
  road geometry.

## [0.9.0] - 2026-06-18

- Hide school-service routes (short name `S###`) from the home and rankings lists by default, with a
  "School buses" toggle to show them. Composes with the mode filter and table sort.

## [0.8.3] - 2026-06-17

- Allow CARTO tiles in the Content-Security-Policy `img-src`; it still only listed the old OSM tile
  host, so the new basemap was blocked and the map rendered grey.

## [0.8.2] - 2026-06-17

- Label the late and early buses on the route map directly (e.g. `4m late`), so you can see which
  are running late without clicking. On-time buses stay an unlabelled dot to keep the map readable.

## [0.8.1] - 2026-06-17

- Switch the route map's basemap from OpenStreetMap's volunteer tile servers (which block
  app/embedded use with a 403) to CARTO Positron, which permits it and suits the light AT palette.

## [0.8.0] - 2026-06-17

- Add a Bus/Train/Ferry filter on the home and rankings pages that narrows the route lists (boards
  and table) by mode; fleet KPIs stay network-wide.
- Start weeks on Sunday instead of Monday/ISO; the rankings week is now labelled `Week of <date>`.
- Show a single route name in the lists (the short name, falling back to the long name), since for
  buses the two are usually the same.

## [0.7.3] - 2026-06-17

- Fix MongoDB aggregations silently truncating at the cursor's first batch (101 docs): the rankings
  query returned only ~101 routes (dropping whole modes such as Train) and route-detail stops capped
  at 101. All aggregations now request a large `batchSize` so the full result set returns.

## [0.7.2] - 2026-06-17

- Throttle the route map's live vehicle polling to a 60s shared server cache and a 60s refresh
  (paused while the tab is hidden), so AT API usage stays well within the 35,000 calls/week quota
  regardless of how many people are viewing.

## [0.7.1] - 2026-06-17

- Insert realtime arrivals via a single bulk `insert` (`ordered: false`) instead of `createMany`
  with a per-row duplicate fallback, so `/api/ingest/at` skips already-seen rows in one round-trip
  per batch and no longer times out (504) on Vercel. Added a `maxDuration` headroom.

## [0.7.0] - 2026-06-17

- Add live vehicle tracking to the route detail map: each route's buses are plotted from AT's
  GTFS-RT vehicle-locations feed, polled every 20s and coloured by current delay
  (late/early/on-time), joined to the trip-updates delay feed via a cached
  `/api/routes/[id]/vehicles` endpoint.
- Format the route detail page's average delays in minutes/seconds, matching the rest of the app.
- Load Leaflet's stylesheet globally so the map always renders correctly.

## [0.6.4] - 2026-06-17

- Make GTFS sync use bulk Mongo `update` commands (batched, upsert) instead of ~7,500 individual
  `prisma.upsert` calls, so `/api/ingest/gtfs/sync` finishes in seconds instead of timing out on
  Vercel. Bulk updates also avoid the replica-set transaction requirement. Added a `maxDuration`
  headroom on the sync route.

## [0.6.3] - 2026-06-17

- Rename the package to `at-route-performance` and add this changelog.

## [0.6.2] - 2026-06-17

- Add the database wipe ops script.
- Exclude the exploratory `scripts/spike-*.ts` from the repo (kept local only).

## [0.6.1] - 2026-06-17

- Fix a stored XSS: stop names from the AT feed were interpolated into Leaflet popup HTML; the popup
  is now built with DOM + `textContent`.

## [0.6.0] - 2026-06-17

Backend migrated from a SQL/Prisma-migrations setup to MongoDB, committed in focused steps:

- Switch the Prisma datasource to MongoDB and drop the SQL migrations.
- Modernise build tooling: flat ESLint config, TypeScript Prettier/Next config, `simple-git-hooks`.
- Add the AT ingest and data-access libraries (GTFS static + GTFS-RT, auth, validation).
- Add the AT-branded app shell, fonts, and shared UI utilities.
- Add the MongoDB-backed API and ingest routes.
- Add the route detail page with a Leaflet stop map.
- Add AT brand assets (fonts, logos) and reference docs.
- Add CI workflows and refresh Dependabot config + README.

## [0.5.2] - 2026-06-16

- Move scheduled ingest off Vercel Cron to an external scheduler (cron-job.org) and document the
  setup, since the Vercel Hobby plan caps cron jobs.

## [0.5.1] - 2026-06-16

- Remove the unused weekly fallback helper.
- Fix a `postcss` `overrides` conflict that broke `npm install` (now follows the direct dependency).

## [0.5.0] - 2026-06-16

- Add the dashboard presentational components (boards, fleet summary, mode breakdown, route table).
- Rebuild the home page as today's network-performance dashboard.
- Add the weekly/monthly rankings page.

## [0.4.0] - 2026-06-16

Performance-dashboard foundations:

- Add the Vitest test runner.
- Add `formatDelay` for signed minute/second delay strings.
- Add Auckland-local day/week/month range helpers (DST-aware).
- Add `deriveBoards` ranking logic (earliest/latest/most-reliable, minimum-sample gated).
- Add range-based ranking, fleet-summary, and mode-breakdown queries.

## [0.3.1] - 2026-02-17

- Fix React Server Components CVE vulnerabilities.
- Dependency updates.

## [0.3.0] - 2025-08-29

- Refactor the database schema and API for improved arrival-event processing.
- Add the `TripDelay` model with its migration; update dependencies.

## [0.2.1] - 2025-08-13

- Fix the null-delay check and improve date calculations.
- Refactor query ordering and `route.ts` for clarity.
- Add and refine the pre-commit hook.

## [0.2.0] - 2025-08-13

- Fresh start: restructure the project into a single Next.js app and overhaul package settings.

## [0.1.1] - 2025-07-22

- Dependency updates across the original backend/frontend (React 19, react-leaflet 5, Next 15.3.3,
  Express, Axios, ESLint, typescript-eslint, Prettier plugins, and others).

## [0.1.0] - 2025-04-23

- Initial commit: Express backend + React/Leaflet frontend scaffold, Dependabot configuration, and
  README.
