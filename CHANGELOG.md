# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org/);
pre-1.0, new capabilities bump the minor and fixes/chores bump the patch. Merge commits and
local-only exploratory scripts are omitted.

## [1.31.3] - 2026-09-21

### Fixed

- The whole of a trips-board or cancelled-trips row is now the link, not just the name, and a badge
  that will not fit drops under the name instead of truncating it.

## [1.31.2] - 2026-09-21

### Fixed

- A route whose stopping pattern fails to load now says so instead of showing no directions and no
  diagram, and a trip whose schedule fails to load says so instead of reading as a run with no
  stops.

## [1.31.1] - 2026-09-21

### Fixed

- The trips board and the cancellations list carry a key naming each badge they show and what it
  means, instead of hiding it in a hover a phone cannot reach.

## [1.31.0] - 2026-09-21

### Added

- Every control, link and diagram stop draws a focus ring when reached by keyboard; the footer uses
  the brand yellow, which reads on its dark band.

## [1.30.21] - 2026-09-21

### Fixed

- The punctuality breakdown opens as a sheet on a phone instead of running off the side of the
  screen, sits above the sticky header, and dismisses on a tap.

## [1.30.20] - 2026-09-21

### Fixed

- The Routes list keeps how many rows it was showing in the URL, so Back returns to the same list
  rather than the first page.

## [1.30.19] - 2026-09-21

### Fixed

- Shame pages carry mode and school chips, and /shame honours the filter its links were already
  carrying.

## [1.30.18] - 2026-09-21

### Fixed

- The route page's worst-trips board waited behind AT's live-vehicle call, so every sort or page
  click - both server navigations - replaced the chips and pager that triggered it with a skeleton
  until AT answered. The board now renders from rows that are already in hand and only the LIVE
  badges stream in.

## [1.30.17] - 2026-09-21

### Fixed

- The on-time window was explained under the off-schedule board and nowhere under the reliable
  board, whose column is that share. Both boards now carry a caption, so their rows start level, and
  the off-schedule board gains a key for its value colours - ten green rows under a heading reading
  "Most off-schedule" otherwise look like good news.

## [1.30.16] - 2026-09-21

### Changed

- One word for a stop visit across the site. The route, stop and shame boards said "Events" or
  "events" for the same thing the home strip and the cards already called Arrivals; all of them now
  read Arrivals. The underlying data field keeps its name.

## [1.30.15] - 2026-09-21

### Fixed

- The home strip called it "Cancelled" and the cancellations page called the same figure "Flagged
  cancelled". Both now use the second name and both say that reinstated trips are counted in it,
  since the number is of AT's flags rather than of trips that failed to run.

## [1.30.14] - 2026-09-21

### Fixed

- The worst-route card's figures are one hour's, not the whole day's - the row is the max over
  per-hour rows. The card now names that hour and says how many arrivals fell in it, so it no longer
  looks like it disagrees with the whole-day averages on the home boards.

## [1.30.13] - 2026-09-21

### Fixed

- Service alerts come from a live feed with no history, so on a past day or week they describe right
  now. The banner now says so and dates every active period instead of leaving a bare time that
  reads as the day being shown, and the route diagram no longer rings stops or dashes the line from
  an alert that has nothing to do with the archived day.

## [1.30.12] - 2026-09-21

### Fixed

- The worst-trip card no longer shows a green "No shame today" when the day recorded no runs at all;
  a day with nothing to rank now gets the same quiet card the worst-route and worst-stop cards
  beside it already use.

## [1.30.11] - 2026-09-21

### Fixed

- The on-time split now says the same true thing everywhere: a cancelled trip's missed stops count
  by the wait for the next trip, on time under five minutes and late beyond it.

## [1.30.10] - 2026-09-20

### Fixed

- The basemap key is no longer sent from loopback hosts, where CARTO always rejects it; a local
  production run now draws watermarked tiles instead of eight blank maps.

## [1.30.9] - 2026-09-20

### Changed

- Corrected the cron doc: the GTFS shapes sync runs daily, not weekly, with the IngestRun evidence
  for why, plus where its memory figure can and cannot be read.

## [1.30.8] - 2026-09-20

### Fixed

- The worst-trip, worst-route and worst-stop cards now open that run, route or stop. The board each
  one came from is on the section heading above them, so a card and its heading no longer lead to
  different places.

## [1.30.7] - 2026-09-20

### Fixed

- A cancelled run whose scheduled start was never captured now opens on the day whose board it was
  clicked from, instead of the run's most recent day.

## [1.30.6] - 2026-09-20

### Fixed

- The nav tab for the page you are already on no longer wipes that page's own filters, and nav and
  footer links from a trip page now keep the run's day instead of jumping to today.

## [1.30.5] - 2026-09-20

### Fixed

- The day stepper and direction chips now keep the delay threshold and trip sort, the step onto
  today keeps the filters instead of dropping the whole query, and the next-day arrow after an
  empty-day fallback goes to a real day instead of back to the same one.

## [1.30.4] - 2026-09-20

### Fixed

- Route links from a month view now open the week that month hands off to, instead of silently
  showing today. Every board and the Routes list build that link from one helper.

## [1.30.3] - 2026-09-20

### Fixed

- The Day, Week and Month tabs now carry the date being read across, so switching window stays on
  that day, week or month instead of resetting to the present.

## [1.30.2] - 2026-09-20

### Changed

- Dropped four dev dependencies other packages already install: @typescript-eslint/eslint-plugin and
  @typescript-eslint/parser (via typescript-eslint), sharp (via Next) and postcss. The postcss and
  sharp overrides go too: Next now pins a postcss past the XSS fix the override was added for. A
  stray install-script entry for canvas, which is not installed, is removed.

## [1.30.1] - 2026-09-19

### Changed

- Each server function leaves out Prisma's unused runtimes, which cuts its traced size from about 95
  MB to 39 MB.

## [1.30.0] - 2026-09-19

### Added

- The nightly pass now hides a run whose every reading was reported under another run's trip, a
  whole vehicle cycle off its own schedule, and records why it hid each one.

## [1.29.2] - 2026-09-18

### Fixed

- A single-trip cancellation alert now sits on its route's page, headed with the route's short name
  ("Route 195", not "Route 195-203") and linking to the route, instead of on the home page's
  network-wide banner.

## [1.29.1] - 2026-09-18

### Changed

- The nightly pre-warm now renders every day page (home, the four shame boards, rankings and
  cancellations) for each of the last seven completed days, so the first reader to step onto a past
  day no longer waits while it is computed.

## [1.29.0] - 2026-09-18

### Added

- Stepping to the previous or next day, week or month is now instant: the neighbouring pages load in
  the background while you read, and a page seen in the last two minutes is shown again without a
  round trip. A step that still has to wait pulses its arrow until the new page arrives, instead of
  looking like a click that did nothing.

## [1.28.0] - 2026-09-18

### Added

- Live pages now update their figures in place when a new ingest run lands, with no reload. The live
  day's cache turns over with each run instead of on a five-minute clock, and a page showing a past
  day is left alone.

## [1.27.3] - 2026-09-18

### Fixed

- A second vehicle reporting a stop visit on a reused trip id can no longer overwrite the real
  arrival: the nearer reading to the stop's own schedule stays, and the visit is marked.

## [1.27.2] - 2026-09-18

### Added

- A one-off backfill that stamps every archived arrival with the service date of the run it belongs
  to, folding the readings of a run that crossed the boundary hour back onto the day it departed.

## [1.27.1] - 2026-09-17

### Fixed

- A cancellation flagged more than twelve hours before its run no longer lands on the previous
  service day, which had put two real cancelled runs in the restamp's delete list.

## [1.27.0] - 2026-09-17

### Changed

- The transit service day now runs 4am to 4am instead of 5am to 5am, so a run that crosses the
  boundary is no longer split across two days, and the 4am hour is no longer hidden from the live
  day's hourly rows. Cancelled trips now record the run's own service date.

## [1.26.1] - 2026-09-17

### Added

- The one-off service-day restamp migration is in the repo, ready to run after the 4am boundary
  change deploys. It moves stored summary stamps onto the new boundary instant, rewrites
  cancelled-trip service dates to the run's own day, and clears the unused off-route stamp.

## [1.26.0] - 2026-09-16

### Added

- Every arrival now records the service date of the run it belongs to, derived once per run at
  ingest, so a run crossing the service-day boundary is no longer split across two days.

## [1.25.3] - 2026-09-16

### Changed

- AGENTS.md and CLAUDE.md are now tracked. Next.js regenerates both on every dev-server start, so
  leaving them untracked left the working tree permanently dirty.

## [1.25.2] - 2026-09-16

### Fixed

- Summary lookups match the stored service-day stamp by range instead of by an exact instant, so a
  past day still reads as summarised and final if the service-day boundary hour moves.

## [1.25.1] - 2026-09-16

### Changed

- The ingest peek endpoint now echoes each sampled trip's trip_id, start_date and start_time, so
  whether the feed populates a run's own service date can be settled before it is relied on.

## [1.25.0] - 2026-09-16

### Added

- Four surfaces now say when the archive starts: a footer line, a 'first day' hint on the day
  stepper at 11 September 2026, a '(from 11 Sep)' suffix on a period that starts before the archive,
  and a line under the home heading on the first day.

## [1.24.0] - 2026-09-16

### Added

- A ?day outside the archive now redirects onto the nearest real day instead of rendering an empty
  board, the week and month windows clamp to the archive floor and mark a short first period as
  partial, and the rank-movement query is skipped when the previous window is empty.

## [1.23.0] - 2026-09-16

### Added

- Added DATA_START_DAY (2026-09-11) as a hard archive floor: the day stepper, the data-day walk and
  the range clamps all stop there, and serviceDayNoon now reads the wall clock instead of adding a
  fixed seven hours to the service day's start.

## [1.22.2] - 2026-09-16

### Changed

- Cleaned up .gitignore: dropped Yarn/PnP/pnpm, Turborepo and SQLite-era rules this repo never
  produces, collapsed the env rules onto the wider .env* glob the Vercel CLI needs, and added
  coverage/ and scripts/route-shots/.

## [1.22.1] - 2026-09-16

### Changed

- The cron schedule is documented in NZ local time, since the jobs are scheduled there and the UTC
  hour moves with daylight saving; the old table read as an hour of drift for half the year. Adds a
  runbook for each way the cleanup can refuse.

## [1.22.0] - 2026-09-16

### Added

- GET /api/health now reports the retention window the last cleanup run actually used, including
  whether it was refused or a dry run, so production's retention is readable without a mongosh
  session. An integration test fails if a recorded window ever drops below the safe floor.

## [1.21.4] - 2026-09-16

### Fixed

- The retention cleanup now refuses when RETENTION_DAYS is unset instead of falling back to 14 days,
  refuses a retention under a year, refuses a run that would delete more than 2% of the archive or
  jump its cutoff more than two days, and records what every run decided on IngestRun.detail. Adds
  ?dryRun=1.

## [1.21.3] - 2026-09-16

### Fixed

- The lint script is read-only again and fails on warnings; lint:fix is back for the rewriting
  variant. Folding --fix into lint made the pre-push hook edit files after the commit was made, and
  let eslint insert empty JSDoc stubs mid-check.

## [1.21.2] - 2026-09-16

### Changed

- Updated eslint-plugin-jsdoc and vitest, pinned prisma to an exact 6.19.3 so a stray range bump
  cannot reach Prisma 7, and folded lint:fix into lint.

## [1.21.0] - 2026-09-14

### Changed

- The home page and the rankings page were the same dashboard split by window: Today held the day
  and Rankings the week or month, so changing the window meant changing tabs. The home page now has
  the Day / Week / Month controls the Routes and Cancellations pages use, with the week and month
  views (rank movement, Shame of the week or month) that Rankings showed. `/rankings` redirects to
  them with its window, period and filters. The top bar reads Overview, Routes, Cancellations.
- Moving between sections keeps the period being looked at: each top-bar link carries the current
  day, window, period, mode and school bus choice, so a past week on the Overview opens the same
  week on Routes or Cancellations. The late or early filter stays behind, since `dir` means a sort
  or travel direction elsewhere.
- The top bar highlights Routes on route, trip and stop pages, and Overview on the Shame boards,
  where before nothing was highlighted.
- "Shame of the day" (and of the week or month) on the Overview links to its boards: the Shame
  dashboard for a day, which nothing linked to, and the Trips board for a week or month, now with
  the mode and school bus filters.

### Fixed

- On a route's week view, the direction chips dropped back to the day view. They now stay on the
  week being shown.
- A route's Day / Week toggle dropped the day, the week and the direction. Week on a past day opens
  that day's calendar week, Day on a stepped-back week opens its Monday, and the week stepper keeps
  the direction.
- A trip page's "Back to" link opened the route on today, not the day the run was on.
- The Shame boards' Week toggle opened the last 7 days whatever day was showing, and Day opened
  today; they now keep the day's week, or the week's Monday.

## [1.20.1] - 2026-09-14

### Fixed

- Shame of the Day boards showed the wrong hours. The Data Cache answers an expired entry with its
  stale value and refreshes it in the background, and the cache key only told a summarised window
  from an unsummarised one. So at 9:14pm on production the Trips tab stopped at 7pm, Routes at 8pm
  and Stops at 9pm (each as old as its last visit), and a finished day could open cut off at the
  hour it was last viewed while live (Sunday 13 September loaded to 4pm on its first visit the next
  evening). The key now carries three states: `final` (summarised), `ended` (over but not yet
  summarised, so nothing computed while the day ran is reused) and `live-<n>`, which moves to a new
  key every TTL so a live day is never more than one TTL behind (`cacheState` in
  `lib/data/cache.ts`). Every date-scoped aggregation goes through it, and the ranking rows and the
  cancellation counts behind the home, rankings, Routes and Shame pages now do too.
- The Shame day boards put ten hours in the left column and the rest in the right, so a full day ran
  5am to 2pm beside 3pm to 4am with a gap under the left. The rows now split evenly (12 and 12 for a
  full day).

## [1.20.0] - 2026-09-14

### Added

- Routes page presets: "All routes", "Most off-schedule" and "Most reliable" chips set the sort and
  the enough-data filter the boards use, and every other filter (mode, area, late or early,
  cancellations, school buses) still applies on top. Sorted by a measure, each route shows its rank.
  On-time % ties go to the route less off schedule, and a route with no absolute average ranks by
  its signed one on off-by, as on the boards, so a board's top ten matches the page's.

### Changed

- The Most off-schedule and Most reliable boards on the home and rankings pages show their top ten
  and a "See all N" link to the Routes page on that preset, carrying the day or week, mode, school
  bus and late or early choices, instead of expanding in place. The separate "Every route" link
  under the boards is gone.

## [1.19.1] - 2026-09-14

### Fixed

- Post-deploy smoke on production failed every page with a map: the CARTO key is restricted to the
  site's host, and the smoke visits the deployment's own URL, where every keyed tile answered 403
  and the map stayed blank. The key now goes out only from the project's production domain
  (`NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL`); any other Vercel URL loads the watermarked keyless
  tiles, as previews already did. Off Vercel the key always goes out (`lib/map-tiles.ts`).

## [1.19.0] - 2026-09-14

### Changed

- Cancellations count against a route's punctuality as the wait a rider had. On arrivals alone a
  cancelled trip can never be late, so cancelling runs improved a route's figures. Every stop a
  flagged trip failed to serve now counts as late by the gap to the next trip that ran on the same
  route and direction, capped at an hour: all the usual stops (the median of that day's runs) for a
  trip that never ran, the stops after the cut for one cut short, nothing for one reinstated
  (`lib/rider-wait.ts`). Applied at read time, per service day, so it reaches the Most off-schedule
  and Most reliable boards, the KPI strips, the Routes page, and the route page's summary and week
  table; the Shame boards and stop pages stay on measured arrivals, and the cancellation counts are
  unchanged. Only routes with a flagged trip are rescanned, and each day is cached.
- Route trip board: on Most off, Latest and Earliest a cancellation ranks among the runs by its wait
  ("10m wait"), and a run cut short averages its unserved stops in at the wait, so it can move up. A
  cancellation whose wait cannot be told stays unranked below the runs.

## [1.18.0] - 2026-09-14

### Added

- Detours: the realtime ingest measures every bus and train part-way through a trip against that
  trip's GTFS road shape and stores each reading more than 200 m off it (`OffRouteSighting`, pruned
  with the arrival events). Most such readings are not detours - AT keeps a vehicle signed onto the
  trip it finished while it drives to its next run or parks at a depot (9% of in-progress vehicles
  read over 150 m off at one midday snapshot) - so a trip counts as off its route only when two
  readings fall between arrivals it recorded before and after. Ferries are left out.
- Trip page: a "Went off its route" note with how far, when, the stop nearest the furthest reading,
  and AT's detour alert when one was active on the route; the readings are drawn on the trip map as
  orange dots on a dashed line.
- Route trip board: an OFF ROUTE badge on runs that left their route.
- The GTFS shapes sync stores each trip's `shape_id`. Until it has run, a trip is matched to its
  shape by the `{block}-{service}` prefix its id shares with the shape's (12 of 12 sampled).

### Changed

- The realtime ingest reads the vehicle-locations feed once for both the vehicle names on arrival
  rows and the off-route check; the check is best-effort and never fails a poll.

## [1.17.0] - 2026-09-14

### Added

- Cancellations page (`/cancellations`, in the top bar) for a day, week or month: a KPI strip of
  every trip AT flagged, split into never ran, cut short and reinstated, and how many routes had
  one; the Most cancelled board (top 15, linking to the rest on the Routes page); and every flagged
  trip with its route, destination and stage badge, filterable by stage and linking to its trip
  page. The mode and school-bus chips filter all three alike, and the Day/Week/Month controls keep
  them. The trips are read a service day at a time and cached under the day, so a week or month
  reuses each day.

## [1.16.0] - 2026-09-14

### Added

- Routes page (`/routes`, in the top bar): every route for a day, week or month, with a KPI strip
  over exactly the routes that pass the filters and a "More details" link to each route's page
  (opening on the same day or week). Filters: search, mode, area, running late or early, enough data
  to rank, had cancellations, and school buses. Sorts: route number, on-time %, average off by,
  average delay, late %, early %, arrivals and cancellations, either direction. Filtering runs in
  the browser and is written to the URL, so a filtered view reloads and shares as it is, and the
  Day/Week/Month controls carry the filters along.
- Areas (Central, North Shore, West, East, South, Hibiscus Coast & Rodney, Waiheke & islands). AT's
  feed gives stops no zone, so each stop is placed by its coordinates against approximate boundaries
  (`lib/areas.ts`), checked against stop names across 80 suburbs. A route belongs to every area
  holding at least two of the stops it served over the last seven completed days, or a quarter of
  them.
- Routes with cancellations but no recorded arrivals (Te Huia, the Pine Harbour ferry) are listed
  without punctuality figures, so the page's cancellation total matches the rankings page.

### Changed

- The All routes table left the home and rankings pages for the Routes page; both link to it with
  their filters. The mode, school-bus and late/early chips share one row above the boards.
- On a phone the header drops the "Transport Tracker" wordmark beside the logo so the nav fits.

## [1.15.1] - 2026-09-14

### Fixed

- Maps on past days showed where the route's vehicles are right now. The route map polls live
  vehicles only on today's day view or the rolling week ending today, not on a past day or a
  stepped-back week, and a trip page only for a run on today's service day. The route trip board
  only looks up LIVE badges for today: AT reuses trip ids every day, so a past day's run could be
  marked LIVE because the same trip id was running now.

## [1.15.0] - 2026-09-14

### Added

- Trip page: a trip AT flagged as cancelled now says so, and how it played out. "Cancelled" when it
  recorded no arrivals; "Cancelled mid-trip" with its last recorded stop, when the flag landed, and
  the scheduled stops after that marked "Not served"; "Cancelled, then reinstated" when it kept
  recording arrivals after the flag. The feed sends one stop update per trip (the next stop), so a
  trip that stops at the flag can leave one predicted arrival past it; three or more arrivals after
  the flag count as the trip carrying on (`lib/cancellation.ts`). Over four days that split 248
  flagged trips into 183 that never ran, 37 cut short and 28 reinstated.
- Route trip board: a flagged trip that ran shows once, as its ranked run with a CANCELLED MID-TRIP
  (CUT SHORT on a phone) or REINSTATED badge, instead of a run plus a separate struck-through
  CANCELLED row. A run made only of a leftover first-stop prediction moves to the unranked
  cancellations. Cancelled rows link to the trip page, which lists the stops the trip would have
  served.

## [1.14.5] - 2026-09-14

### Fixed

- Trip page map: the line joined the trip's stops with straight segments, cutting across blocks and
  the harbour instead of following the road. It now draws the trip's own GTFS shape (the `shape_id`
  on AT's trip record, from the stored shapes), and only joins the stops for a trip AT no longer
  publishes or a shape not yet ingested.

## [1.14.4] - 2026-09-14

### Fixed

- The skeleton `Bone` joined its classes with a template string, so a caller's `rounded-full` or
  `rounded-none` sat beside the default `rounded` and CSS order decided the shape. It merges through
  `cn()` now, as do the route page's Day/Week toggle and the delay spans in the highlight cards and
  Shame rows, which were the last class names built by string concatenation.

## [1.14.3] - 2026-09-14

### Fixed

- Loading skeletons were close to their pages but not the same size, so content jumped a little as
  each page arrived (the route header 20px taller, the Shame cards and hour rows shorter, the rank
  boards 25px short, chips 2px taller, the stop page's lower sections misplaced). Every skeleton is
  now built from shared parts (`SkeletonParts.tsx`) that mirror the real components box for box: the
  same padding, gaps and borders, with each bar the height of the text line it stands in for.
  Measured against the loaded pages at desktop and phone widths, every fixed block lines up; what
  still differs depends on the data (how many hours have passed, a route's alert banner and diagram,
  a long name wrapping). The in-page Suspense fallbacks (home cards, route trip board and diagram,
  stop departures, Shame week boards) use the same parts.

## [1.14.2] - 2026-09-14

### Fixed

- Route page on a phone: the "Buses of the day" board grew to its truncating rows' full width (640px
  in a 368px column), so its sort chips and row ends ran off the right edge. The board is a grid
  item and now carries `min-w-0`, so its rows truncate inside the column.

## [1.14.1] - 2026-09-13

### Fixed

- The site had no favicon, so every first visit logged a 404 for `/favicon.ico`. It now ships a bus
  glyph on AT Shore blue as `icon.svg`, with a 32px `favicon.ico` and a 180px `apple-icon.png`
  rendered from it.

## [1.14.0] - 2026-09-13

### Added

- The "Most off-schedule" boards on the home and rankings pages note each route's cancelled trips
  for the same window and filters ("4 cancelled") beside its name. The ranking stays on measured
  delay: a cancellation has no deviation to average, so it sits next to the score instead of being
  folded into it.

## [1.13.15] - 2026-09-13

### Changed

- Route icons use each route's `route_color` from the AT API exactly as published. A contrast check
  replaced any colour under 3:1 on white with a generic mode colour, which dropped the East West
  Line's green and the Onehunga West Line's blue to the same train purple (only the South City Line
  kept its red), along with the ferries' teal and the InnerLink and OuterLink colours. Routes the
  API gives no colour keep the service and mode fallbacks. The unused contrast helper is removed.

## [1.13.14] - 2026-09-13

### Fixed

- Loading skeletons: a `loading.tsx` covers every page nested under its folder, and a prefetch stops
  at the first one it meets. So the Shame trip, route and stop pages loaded behind the Shame
  dashboard's card skeleton, and a trip page behind the route page's board-and-map skeleton. The
  home page, the Shame dashboard and the route day page now sit in route groups (`(home)`,
  `shame/(overview)`, `route/[id]/(overview)`), so each skeleton covers only its own page; no URL
  changes.
- Skeleton shapes: the route skeleton gains the direction chip row and a board as tall as the map;
  the home and rankings boards show the ten rows the real boards do, with the on-time window line;
  the Shame hour boards show the subtitle line, and their row placeholders shrink to fit a phone
  instead of running off the right edge.

## [1.13.13] - 2026-09-13

### Fixed

- Footer freshness: a page view after a quiet spell could read "no update for 11 min, ingest may be
  stalled" while ingest ran every two minutes, and correct itself only on the next minute's poll.
  The last-run lookup sat in the Data Cache, which answers an expired entry with its stale value and
  refreshes in the background. It now uses the in-process TTL cache, which refetches on expiry, so
  the rendered and polled instants are at most 20 seconds behind the newest run.

## [1.13.12] - 2026-09-13

### Fixed

- Every sort chip, page number, filter chip, Day/Week toggle, Shame tab and board row was a plain
  anchor, so each click reloaded the whole document and the page's loading skeleton streamed in
  before the content. They are client navigations now: changing a sort, page, mode or delay filter
  swaps the content in place without the skeleton, and the in-page chips keep the scroll position.
  The all-routes table skips prefetching so a long list does not fire a request per row.

## [1.13.11] - 2026-09-13

### Fixed

- Route trip board: cancelled trips pinned to the top of page 1 whatever the sort, so "Most off",
  "Latest", "Earliest" and "Departure" all opened on them. A cancellation now takes its place by
  scheduled start on "Departure" (following a reversed sort too) and sits below every ranked run on
  the delay sorts, since it has no delay to rank by. It follows the direction filter like a running
  trip, shows its scheduled start, and the rank numbers count running trips only.
- Ingest records each cancellation's `start_time` from the realtime feed. Cancellations stored
  before this fall back to the start seconds AT encodes in the trip id.

## [1.13.10] - 2026-09-13

### Fixed

- Maps: CARTO now stamps "API KEY REQUIRED" across every basemap tile requested without a key. The
  tile URL appends `NEXT_PUBLIC_CARTO_API_KEY` when set (a free key from carto.com/basemaps/apikey,
  inlined at build time and visible in tile requests, so restrict it to the site's host). Tile
  requests send the site's origin as the Referer, which the site-wide `same-origin` policy otherwise
  strips, so a host-restricted key accepts them.

## [1.13.9] - 2026-09-13

### Changed

- Post-deploy workflow: its header claimed the automatic trigger waits until the file is on `main`.
  GitHub runs a `deployment_status` workflow from the deployed commit, so it fires for every preview
  as well, and it has done so for each push to `dev` since 1.13.5. The job is named
  `deployment-smoke` so it can be a required check on `main` without colliding with CI's `smoke`.

## [1.13.8] - 2026-09-13

### Changed

- Post-deploy workflow: the `ADMIN_SECRET` pass-through added in 1.13.7 belongs to a different
  project's copy of this workflow and is removed again; this project has no admin pages.

## [1.13.7] - 2026-09-13

### Changed

- Post-deploy workflow: the job also passes an `ADMIN_SECRET` repository secret through to the smoke
  test, so the same workflow file serves a project with an admin surface. This project has none and
  no such secret, so it resolves to an empty string the script never reads.

## [1.13.6] - 2026-09-13

### Fixed

- Smoke test: the standalone server's stdout was piped but never read, so a chatty server would fill
  the pipe and stall, and anything it printed there was invisible. Both streams are drained into the
  `[server]` lines now.

## [1.13.5] - 2026-09-13

### Fixed

- Smoke test: a bad argument prints one message and exits 2 instead of an unhandled rejection with a
  stack trace; `--base-url` must be a full http(s) URL, so a bare host fails at once rather than
  after the 90-second readiness wait; `--port` rejects `3001abc`, which `parseInt` read as 3001.
- Smoke test: on Windows the server tree was never force-stopped, because `execSync` runs through
  `cmd.exe`, which rejects the Git Bash `//F` switch form; `taskkill` now takes single slashes, so
  the port and the Prisma engine are released when the run ends.
- Smoke test: a web manifest is fetched without cookies and is not reliably intercepted, so on a
  protected deployment it loops between the site and SSO whatever bypass is primed. That one
  redirect loop is ignored, only for a `.webmanifest` path on the target's own origin and only while
  the bypass secret is set; the cookie priming comment no longer claims to cover it.
- Smoke test: the summary counts "checks", since it includes the endpoint checks; a status echo with
  no URL no longer prints empty parentheses.

## [1.13.4] - 2026-09-13

### Fixed

- A raw MongoDB command that fails with the driver's "I/O error: timed out" (a socket read timing
  out on a long-haul link, which the server labels retryable) is retried once like a connection
  reset. The CI smoke job, running from a GitHub runner far from the database, hit it once on the
  rankings page and landed on the error boundary.

## [1.13.3] - 2026-09-13

### Fixed

- The remote smoke test against a preview deployment failed on every page because Vercel injects its
  preview toolbar script and the site's CSP blocks it; that console error is now ignored (the CSP is
  doing its job, and production never carries the script).
- The bypass secret was attached to every request the page made, including the map tile host. It now
  rides only requests to the deployment's own origin, through request interception, and is also
  stored as a session cookie up front so a request the browser starts on its own cannot loop through
  SSO.
- Console errors that begin "Failed to load resource" were all ignored, which also hid network
  failures (a blocked, aborted or unresolved request) that never produce a response event. Only the
  HTTP-status echo of a failure the response handler already recorded is dropped now.
- The 404 page check now asserts the document's status, so a soft 404 with the right copy fails.
- A dynamic sample (stop, trip, train line, station) that cannot be found is reported instead of
  silently narrowing the run; the direct fetches carry a 30-second timeout; the endpoint checks no
  longer follow redirects, so an SSO bounce reads as its real status rather than a JSON error;
  `--port` rejects a non-number; the empty-section check looks at the nearest section rather than
  the heading's parent.
- Post-deploy workflow: a skipped run raises a warning annotation, the health probe strips a
  trailing slash from a hand-entered URL and clears the previous body between attempts, and a failed
  connection logs `000` once.

### Changed

- The smoke test loads `.env.local` through Node's own `process.loadEnvFile`, which handles quoting,
  comments and multi-line values; existing environment variables still win.

## [1.13.2] - 2026-09-13

### Fixed

- The post-deploy smoke workflow's first run reached the deployment (the bypass secret and the
  health probe both worked) and then started a local build: it passed `--base-url` and the URL as
  two arguments, and the smoke script only read the `--base-url=` form, so the URL was ignored. The
  script now accepts both forms and refuses an argument it does not know instead of falling back to
  a build, and the workflow passes the `=` form.

## [1.13.1] - 2026-09-13

### Changed

- The post-deploy smoke workflow can be started by hand ("Run workflow" with a deployment URL) from
  any branch, so a preview or production deployment can be checked before the workflow reaches
  `main`. Its health probe prints the HTTP status, so a rejected bypass secret (401 or 303), a build
  without the health route (404) and a version mismatch read differently in the log.

## [1.13.0] - 2026-09-13

### Added

- `GET /api/health` answers `{ ok, version, time }` from the deployed build, uncached and without
  touching the database, so a deploy can be confirmed to be the commit it claims.
- A post-deploy smoke workflow (`.github/workflows/post-deploy-smoke.yml`). Vercel reports each
  finished deployment to GitHub; the workflow checks out the deployed commit, probes `/api/health`
  until the expected version answers, and runs the smoke test against the deployment URL. Deployment
  Protection is on, so it needs the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` (the
  project's "Protection Bypass for Automation" value) and skips with a message until it exists.
- The smoke test sends `x-vercel-protection-bypass` on every page and API request when that
  environment variable is set, so it can read a protected deployment by hand as well.

## [1.12.19] - 2026-09-13

### Fixed

- The smoke test's train-station sample never ran: the station link it looked for is percent-encoded
  on the page, so the pattern now accepts both spellings.

### Changed

- Docs: the README says how to run the smoke test against a deployment, and the cron guide notes
  that the two removed GTFS endpoints should point at the sync endpoint and how to check a deploy.

## [1.12.18] - 2026-09-13

### Changed

- The smoke test now reads the pages it visits. Every page's rendered text is checked for a leaked
  raw value (`NaN`, `undefined`, an empty search quote, `Invalid Date`, `[object Object]`), every
  section heading must have content under it, a page can require or forbid copy, and the path the
  browser lands on is compared with the requested one so a streamed redirect is caught. It visits
  more of the site: the route week view, the month rankings, the week shame boards, a trip page
  found on the NX1 board, the first train line in the directory and one of its stations, and the 404
  page, and it fetches the three public endpoints directly. `--base-url` runs it against a server
  that is already up, so a deployment can be checked without a local build.

## [1.12.17] - 2026-09-13

### Added

- Tests for the parts of the pipeline and the API that had none. The cleanup run moved into
  `src/lib/cleanup.ts` behind a small storage port so a test drives it with an in-memory store: the
  cutoff snaps to the 5am service-day start and takes the offset in force on the cutoff day across
  both DST switches, retention under seven days is refused without `?force=1`, and one collection's
  delete failing does not skip the others. The query schemas are pinned (empty values read as unset,
  bounds hold, the 400 body carries field and message only), as are the on-time window per mode, the
  banding's rounding and the cron bearer guard's 500/401/pass outcomes. Two handler tests exercise
  `GET /api/routes/top` (defaults, sanitised 400, bare 500 with a message-only log) and
  `POST /api/ingest/aggregate` (401, an impossible date, the explicit-date form, the catch-up form
  oldest first, and a failed day recorded without stopping the others). The suite is now 212 tests
  across 28 files.

## [1.12.16] - 2026-09-13

### Changed

- `src/lib/data.ts` (3,640 lines, every server read in one file) is split by concern into
  `src/lib/data/`: the cache policy, route identity and the directory, rankings, one route's stats,
  the archive's edges, trips, cancellations, the shared shame filter, the worst-trip and worst-route
  boards, and stops and stations. `data.ts` is now a barrel re-exporting exactly the 45 names it
  exported before, so no import site changed. Every declaration moved verbatim with its comment; the
  only new text is each file's header and imports, the barrel, and `export` on twelve helpers that
  were private to the one file and now serve another.

## [1.12.15] - 2026-09-13

### Fixed

- The footer's freshness line no longer reads "update due now" forever. While no ingest run has been
  logged (a fresh deploy, or the run log reset) it says it is awaiting the first run rather than
  projecting a due time from an arrival stamp, and once three ingest cadences pass with no run it
  says how long ago the last update was and that ingest may be stalled. The resolver behind it is a
  plain function with tests, and the label re-evaluates every 15 seconds instead of every second.
- The worst-stops board's hourly rows linked to the stop without the day being viewed, so a past
  day's row opened today's page; they carry `?day=` like the week rows.
- The worst-routes week board printed "undefined/undefined" beside a row with no date; the date span
  renders only when there is one. The worst-stop card called a stop's arrivals "buses" whatever ran
  there; it says arrivals. The alert banner's route links now encode the slug. The route page says
  when the trips board holds only the first 500 runs of the day.
- Motion and accessibility: the map's pan to a selected stop and the pill and button hover
  transitions honour a reduced-motion preference; the KPI breakdown popover is linked to its button,
  closes on Escape and returns focus; the flame badge's tooltip opens on keyboard focus as well as
  hover; the mode icon is labelled once instead of twice; a skip link leads to the page content.

## [1.12.14] - 2026-09-13

### Added

- Error boundaries. A page that throws while rendering (the database unreachable, an AT feed timing
  out inside a query) now shows a recovery page inside the normal masthead and footer, with a retry
  button and a link home, instead of Next's blank default; a failure inside the root layout itself
  falls through to a bare last-resort page with the same retry. Both log the message and Next's
  error digest so the failure can be found in the function logs.
- The trip page has its own title and description, so a tab or a shared link names the route and the
  run.

### Fixed

- A trip id that matched no route, no recorded arrival on any day and no published schedule rendered
  an empty page with a 200; it is now a 404 like an unknown route or stop.

## [1.12.13] - 2026-09-13

### Fixed

- Loading skeletons now match the pages they stand in for, so a page no longer shifts as it arrives.
  The home and rankings skeletons showed four separate KPI tiles where the page renders one bordered
  strip of five cells; the route skeleton drew dividers the stats strip does not have; the shame
  dashboard skeleton lacked the cancelled-routes board that sits under its cards; the hourly shame
  board skeleton drew 12 rows on mobile and hard-coded its desktop split, and now takes both from
  the board's own per-column constant. The three pages that carried their own copy of the bone
  element share the one component.

## [1.12.12] - 2026-09-13

### Fixed

- Delays are worded through the route's own on-time window everywhere. Seven places rendered a
  signed deviation with no mode, so a bus 4 seconds behind schedule read "+4s late" under a caption
  that calls 5 minutes on time: the home and rankings boards, the routes table, the route page's
  trip board, the line diagram's labels and tooltips, and the map's stop and live vehicle popups now
  all say "on time" inside the window, as the shame boards already did.
- A delay or duration that is not a finite number (NaN from an empty average, an infinity from a bad
  divisor) rendered as "NaNs late"; both formatters now return the unknown dash the tables already
  use, with tests.

## [1.12.11] - 2026-09-13

### Fixed

- Boards and cards with nothing to show now say so instead of vanishing or showing a hole. The
  routes table on an empty day printed `No routes match ""` as if a search had failed; it now tells
  a search miss and an empty period apart. The worst-route and worst-stop cards on the shame
  dashboard, the home page and the rankings page rendered nothing when no route or stop qualified,
  leaving a gap in the card grid; each keeps its slot with a quiet "Nothing to rank yet" state. The
  route page's map, line diagram and stops table disappeared for a route with no arrivals; each
  keeps its heading and says what it is waiting for. The 404 page's route directory says when it is
  unavailable rather than omitting the section. The rankings caption mentions movement arrows only
  when a previous period exists to compare against.

## [1.12.10] - 2026-09-13

### Fixed

- An empty query value (`GET /api/routes/top?limit=`) returned 400; every parameter now reads an
  empty string as unset and falls back to its default, as `week` and `mode` already did. A failed
  parse used to echo Zod's whole issue objects, received input included; the 400 body now carries
  each issue's field and message only. The API handlers log the error message, not the raw error
  object, under one `[API]` prefix with the route id where there is one, and the remaining log
  prefixes are one style (`[AUTH]`); the emoji and the em-dash in two log lines are gone.
- A stop's scheduled departures decided their cache lifetime by comparing the NZ service date to the
  UTC calendar date. Between midnight UTC and 5am NZ the two differ, so every NZ morning the day
  just ended looked like the current day and was refetched from AT twelve times an hour, and the
  current day looked past. The rule now compares service dates, in a small helper with tests.
- The earliest-data marker was cached for six hours, so after the nightly cleanup the day stepper
  could offer a day that no longer existed for most of a morning; it now refreshes every ten minutes
  like the latest-data marker. The cache pre-warm route no longer calls the two markers under the
  belief it refreshed them (a cached read returns the cached value; it refreshed nothing).
- The route map polled live vehicles every minute against a feed the server caches for two minutes,
  so every second poll re-read the same snapshot; it now polls every two minutes, and the vehicles
  endpoint's comment says 120s rather than 15s.

### Removed

- `POST /api/ingest/gtfs/routes` and `POST /api/ingest/gtfs/stops`, which ran one half of the static
  sync each and were scheduled nowhere; `POST /api/ingest/gtfs/sync?force=1` runs both.

## [1.12.9] - 2026-09-13

### Fixed

- The nightly aggregate now catches up. Without `?date=` it rolls up yesterday plus any of the two
  days before it that have arrival events but no summary, oldest first, one IngestRun row per day,
  so a night the cron missed is closed by the next run instead of leaving a permanent hole in the
  rankings. A ghost-pass failure now fails its day rather than rolling the day up unclassified,
  which would have pinned the noise into the archive for good; the day stays unsummarised and the
  next run retries it. The function's time budget is raised to cover three days. The rollup itself
  moved to `src/lib/aggregate.ts` (pipeline, upsert entries and the catch-up rule are plain
  functions with unit tests), and the rebuild script runs the same pipeline.
- The realtime ingest's bulk inserts and upserts bypassed the connection-reset retry, and an
  `ordered: false` bulk command that rejected some entries still resolved, so a half-failed write
  passed unnoticed. Both now go through the retry, which also recognises `ECONNRESET`, `EPIPE` and a
  hung-up socket, and every bulk write checks the reply's per-entry errors, ignoring only the
  duplicate key an idempotent insert or a raced upsert is expected to hit. The ghost pass shares the
  check.

## [1.12.8] - 2026-09-13

### Removed

- Dead code and inert settings. `getModeBreakdown` and `getShameStreak` had no caller and the
  `ModeBreakdown` component rendered nowhere; all three are gone, with the `ModeStat` and
  `ShameStreak` types only they used. The nightly aggregate and the rebuild script no longer compute
  the median and 95th-percentile delay per route: nothing read `p50DelaySec` or `p95DelaySec`, and
  the `$percentile` stage was the one reason the runbook demanded MongoDB 7. The schema keeps the
  two nullable columns so existing rows need no migration; new summaries simply do not set them.
  `ON_TIME_THRESHOLD_SEC` is no longer read (the on-time late bound is the code's own constant, and
  summaries record that), and `NEXT_PUBLIC_SITE_URL`, which nothing read, leaves the README's
  environment table.

## [1.12.7] - 2026-09-13

### Added

- CI runs the smoke test. A `smoke` job builds the app, starts the standalone server and visits
  every public page with Puppeteer against the real database, so a pull request that breaks a page
  at runtime fails before it merges. The job runs only when the `DATABASE_URL` repository secret is
  set (`AT_API_KEY` is optional), so Dependabot pull requests and forks, which get no secrets, skip
  it rather than fail. The `test` job now runs the unit suite as well as lint and build, and the
  unused `MONGODB_URI` secret is no longer passed to the jobs that never open the database.

## [1.12.6] - 2026-09-13

### Changed

- Every file-level `/** @description */` block (95 files across the app, components, libraries, API
  routes and scripts) is now a plain `//` comment with the same prose. A top-of-file JSDoc block
  attaches to no declaration, so the tag was dead ceremony; the smoke test's `@file` tag went with
  it, and one `{@link}` inside a demoted header names its symbol plainly, since the tag is inert
  outside a JSDoc block. No code changed.
- The pre-commit hook chunks lint-staged's command lines (`--max-arg-length=4000`): a commit
  touching this many files exceeded Windows' command-line limit and the hook failed before it could
  format anything.

## [1.12.5] - 2026-09-12

### Changed

- The Auckland timezone name is written once. `NZ_TZ` lives in `src/lib/nz-tz.ts` and reaches
  everything else through `@/lib/time` alongside the date helpers; the 27 places that spelled
  `"Pacific/Auckland"` themselves (the data layer's pipelines, the formatters, the alert banner, the
  freshness label, the service-date expression and its test) now use the constant. A lint rule
  rejects the literal anywhere else, since a hand-written timezone is how a file ends up doing its
  own date maths and how a DST bug gets in. `format.ts` reads the leaf module directly because
  `time.ts` imports it, which keeps the two free of an import cycle.

## [1.12.4] - 2026-09-12

### Fixed

- A run's stop count meant two different things. The route page's trip board counted every row the
  run had, ghost re-reports included, while the shame boards counted only the real ones, so the same
  run showed different "N stops" on the two pages, and a stop carrying both a real arrival and a
  re-report counted twice. Every board now counts the distinct stops that have a real reading. The
  trip board also named the run's vehicle from its earliest row, which for a re-reported run is the
  other vehicle; it now takes the vehicle from the first real reading.
- A route's cancelled-trips list matched the service date by equality with the window's start, so it
  served only a window whose start equalled a stored stamp; it now range-matches like the
  cancellation count and board, and is cached by both ends of the window.
- `GET /api/routes/top` took an ISO week as Monday midnight UTC, twelve or thirteen hours late for a
  New Zealand week; the week now runs from Auckland midnight like every other window.
- A failed AT stop-times fetch was cached as an empty schedule for a day, so a trip page whose first
  visitor hit an AT outage showed no upcoming stops until the next day. The failure now throws out
  of the cache and only that request goes without a schedule.

## [1.12.3] - 2026-09-12

### Fixed

- The nightly ghost pass cleared every flag in the day before deciding them again, so between the
  two steps the day read as unclassified, and a pass that failed in between left it that way. It now
  rewrites each trip's flags from its level in one multi-update, setting the flag on rows outside
  the gap and removing it from the rest in the same write, so every trip's rows agree at any instant
  and a re-run reaches the same verdicts with no clearing step. A failed entry in a bulk update was
  ignored (`ordered: false` carries on past it and the promise still resolves); the reply's write
  errors now fail the pass. The trip levels are computed inside the aggregation (the exact median,
  the same element the in-memory path picks), so the reply carries one number per trip instead of
  every reading and stays far under the 16 MB reply limit; the pass refuses a reply that fills its
  batch rather than classify a silently truncated day. The flagged count is read back from the day
  rather than inferred from rows changed either way.
- Draining an aggregation cursor through Prisma is not possible (`getMore` needs the 64-bit cursor
  id, which arrives as a rounded JavaScript number), so the per-day reads keep their single batch
  and the one unbounded per-trip scan was shrunk instead.

### Added

- Unit tests for the pass's pipeline shape and update batches, and an integration test that runs it
  on a scratch collection: median per trip, outliers flagged, a stale flag cleared, the gap
  exclusive at its boundary, the previous day untouched, and a re-run idempotent.

## [1.12.2] - 2026-09-12

### Fixed

- The three-hour deviation guard applied to every read, classified days included, although its only
  purpose is to stand in for the ghost flags on a day the nightly pass has not reached; on a
  classified day it silently capped any service that really did run more than three hours off
  schedule, which is the kind of run this site exists to show. The two filters now take the window's
  classification: the guard stays on for the current service day, for a completed day whose
  aggregate has not run, and for a window that mixes classified and live days, and comes off once
  every day in the window has a `DailyRouteSummary`. The nightly aggregate rolls a day up without
  the guard, since its own ghost pass has just run, and keeps it only when that pass failed; the
  rebuild script keeps it, as it does not classify. A unit test pins both shapes.

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
