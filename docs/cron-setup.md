# Scheduled ingest (cron-job.org)

The ingest endpoints are triggered by an external scheduler instead of Vercel Cron (the Hobby plan
caps cron jobs at 2/day, and this project needs four — one of them every couple of minutes).
[cron-job.org](https://cron-job.org/) (free) calls the endpoints over HTTPS on a schedule.

## Prerequisites

1. Deploy the app to Vercel and note the production URL (e.g. `https://your-app.vercel.app`).
2. Set these environment variables in the Vercel project (Settings > Environment Variables), since
   the functions read them at runtime:
   - `DATABASE_URL` - the MongoDB Atlas connection string (the `at-buses` cluster).
   - `AT_API_KEY` - Auckland Transport API key (needed by `/api/ingest/at`).
   - `CRON_SECRET` - a long random string; cron-job.org sends it as the bearer token.

## Auth

Every ingest route checks `Authorization: Bearer <CRON_SECRET>` (see `src/lib/auth.ts`). In each
cron-job.org job, add a request header:

```
Authorization: Bearer <CRON_SECRET>
```

(Use the same value as the `CRON_SECRET` env var in Vercel.)

## Jobs

All endpoints are **POST**. Create one cron-job.org job per row.

| Job              | URL path                  | Method | Schedule         | Purpose                         |
| ---------------- | ------------------------- | ------ | ---------------- | ------------------------------- |
| Realtime ingest  | `/api/ingest/at`          | POST   | every 2 minutes  | Capture GTFS-RT arrival events  |
| GTFS static sync | `/api/ingest/gtfs/sync`   | POST   | daily 13:00 UTC  | Refresh routes + stops          |
| GTFS shapes sync | `/api/ingest/gtfs/shapes` | POST   | weekly 13:10 UTC | Refresh route geometry (shapes) |
| Daily aggregate  | `/api/ingest/aggregate`   | POST   | daily 13:30 UTC  | Roll up DailyRouteSummary       |
| Cleanup          | `/api/ingest/cleanup`     | POST   | daily 14:00 UTC  | Apply retention                 |
| Cache pre-warm   | `/api/warm`               | POST   | daily 14:15 UTC  | Pre-compute yesterday's boards  |

Full URL = `https://<your-app>.vercel.app` + the path above.

13:00 UTC is 01:00 NZST (winter) / 02:00 NZDT (summer). cron-job.org lets you pick a timezone per
job if you prefer to schedule in NZ local time.

## Notes

- The realtime job is the one that fills the home page's "today" view. Lower the frequency to every
  5 minutes if you want fewer invocations.
- The shapes job downloads AT's full GTFS zip (~33 MB) and parses `shapes.txt`; it is memory-heavy,
  so run it weekly (the geometry rarely changes) and watch the function's memory headroom.
- `/api/ingest/at` is idempotent: a unique index on `(tripId, stopId, actualAt)` drops duplicate
  arrivals, so overlapping runs are safe.
- cron-job.org's free tier supports down to 1-minute intervals and custom headers.
