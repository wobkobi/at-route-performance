# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org/);
pre-1.0, new capabilities bump the minor and fixes/chores bump the patch. Merge commits and
local-only exploratory scripts are omitted.

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
