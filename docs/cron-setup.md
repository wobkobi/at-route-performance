# Scheduled ingest (cron-job.org)

The ingest endpoints are triggered by an external scheduler instead of Vercel Cron (the Hobby plan
caps cron jobs at 2/day, and this project needs four — one of them every couple of minutes).
[cron-job.org](https://cron-job.org/) (free) calls the endpoints over HTTPS on a schedule.

## Prerequisites

1. Deploy the app to Vercel and note the production URL (e.g. `https://your-app.vercel.app`).
2. Set these environment variables in the Vercel project (Settings > Environment Variables), since
   the functions read them at runtime:
   - `DATABASE_URL` - the MongoDB connection string (see `docs/self-host-mongodb.md`).
   - `AT_API_KEY` - Auckland Transport API key (needed by `/api/ingest/at`).
   - `CRON_SECRET` - a long random string; cron-job.org sends it as the bearer token.

## Auth

Every ingest route checks `Authorization: Bearer <CRON_SECRET>` (see `src/lib/auth.ts`). In each
cron-job.org job, add a request header:

```
Authorization: Bearer <CRON_SECRET>
```

(Use the same value as the `CRON_SECRET` env var in Vercel.)

## Deployment protection blocks the scheduler

`CRON_SECRET` is checked inside the app, which the request only reaches if Vercel lets it through
first. With Vercel Authentication (SSO) enabled, every `*.vercel.app` URL answers `302` to
`vercel.com/sso-api` and no route ever runs; cron-job.org records the 302 as a result, so the jobs
look scheduled while nothing ingests.

Check Settings > Deployment Protection. The common setting is "all except custom domains", which
protects nothing only once a custom domain exists - on a project with no custom domain it covers
every URL, including production. Either attach a custom domain and point the jobs at it, disable SSO
protection, or append a protection-bypass secret to each job URL. The same "Protection Bypass for
Automation" secret, stored as the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`, lets the
post-deploy smoke workflow reach a protected deployment.

## Jobs

All endpoints are **POST**. Create one cron-job.org job per row.

| Job              | URL path                  | Method | Schedule (NZ local) | Purpose                         |
| ---------------- | ------------------------- | ------ | ------------------- | ------------------------------- |
| Realtime ingest  | `/api/ingest/at`          | POST   | every 2 minutes     | Capture GTFS-RT arrival events  |
| GTFS static sync | `/api/ingest/gtfs/sync`   | POST   | daily 02:00         | Refresh routes + stops          |
| GTFS shapes sync | `/api/ingest/gtfs/shapes` | POST   | weekly 02:10        | Refresh route geometry (shapes) |
| Daily aggregate  | `/api/ingest/aggregate`   | POST   | daily 02:30         | Roll up DailyRouteSummary       |
| Cleanup          | `/api/ingest/cleanup`     | POST   | daily 03:00         | Apply retention                 |
| Cache pre-warm   | `/api/warm`               | POST   | daily 03:15         | Pre-compute yesterday's boards  |

Full URL = `https://<your-app>.vercel.app` + the path above.

The jobs are scheduled in **NZ local time**, so the UTC hour they fire at moves with daylight
saving: 02:00 NZ is 14:00 UTC in winter (NZST, UTC+12) and 13:00 UTC in summer (NZDT, UTC+13).
Recorded `IngestRun` rows for 11-15 September 2026 agree - sync at 14:00, shapes at 14:10, aggregate
at 14:30 and cleanup at 15:00 UTC, every one of them NZST. An earlier version of this table gave the
summer UTC hours as if they were fixed, which read as an hour of drift for half the year. Document
the local time, which does not move.

What matters is the order, not the hour: cleanup must run after the aggregate, because deletion is
irreversible and the rollup reads the events the cleanup then removes.

## Notes

- The realtime job is the one that fills the home page's "today" view. Lower the frequency to every
  5 minutes if you want fewer invocations.
- The slow jobs (gtfs sync, shapes, aggregate, cleanup) respond `202 { started: true }` immediately
  and finish after the response - cron-job.org drops requests at 30 s, and these can run for
  minutes. A cron-job.org "success" therefore means the job was accepted; check the footer freshness
  indicator (IngestRun) or the Vercel function logs for the actual outcome.
- The aggregate job catches up on its own: without `?date=` it rolls up yesterday plus any of the
  two days before it that have events but no summary yet (a night the cron missed, or a day whose
  ghost pass failed). Each day records its own IngestRun row. A longer gap closes over successive
  nights; to close one at once, POST `?date=YYYY-MM-DD` per day or run
  `scripts/rebuild-daily-summaries.ts` (which skips the ghost pass).
- The shapes job downloads AT's full GTFS zip (~33 MB) and parses `shapes.txt`; it is memory-heavy,
  so run it weekly (the geometry rarely changes) and watch the function's memory headroom. It also
  stores each trip's `shapeId`, which the realtime job measures vehicles against to spot detours;
  until it has run, the realtime job matches a trip to its shape by id prefix instead, which is
  close but can pick between up to three variants.
- `/api/ingest/at` is idempotent: a unique index on `(tripId, stopId, scheduledAt)` upserts revised
  predictions onto the same stop visit, so overlapping runs are safe.
- `/api/ingest/gtfs/routes` and `/api/ingest/gtfs/stops` no longer exist; a scheduler entry for
  either should point at `/api/ingest/gtfs/sync?force=1`, which runs both halves.
- After a deploy, `npx tsx scripts/smoke-test.ts --base-url=https://<your-app>.vercel.app` visits
  every page and endpoint against production and fails on a leaked value or an empty section.
- cron-job.org's free tier supports down to 1-minute intervals and custom headers.
