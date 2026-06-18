# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org/);
pre-1.0, new capabilities bump the minor and fixes/chores bump the patch. Merge commits and
local-only exploratory scripts are omitted.

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
