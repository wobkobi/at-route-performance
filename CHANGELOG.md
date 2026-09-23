# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org/): a
new feature bumps the minor number, and a fix, a tidy-up or a dependency update bumps the patch.
Merge commits and local-only exploratory scripts are left out.

Each entry says what changed on the site (or in how it runs), what you would notice, and why it was
needed. Where an entry has to use one of the terms below, this is what it means.

## Terms used in this changelog

- **Arrival** - one vehicle reaching one stop. A bus that serves 40 stops on a run makes 40
  arrivals. The site counts and averages arrivals, not trips.
- **Run** or **trip** - one journey by one vehicle from the start of a route to its end, identified
  by AT's trip id. AT reuses the same trip id on every day that timetable runs.
- **Service day** - a transport day, which runs 4am to 4am rather than midnight to midnight, so a
  bus leaving at 11:30pm and finishing at 12:40am counts under the day it left. (Before 1.27.0 the
  day ran 5am to 5am.)
- **On-time window** - how early or late an arrival can be and still count as on time: up to 5
  minutes late, and up to 1 minute early (5 minutes early for ferries).
- **Off schedule** / **off by** - how far an arrival was from its timetable, early or late alike.
- **Flagged cancelled** - a trip AT's feed marked as cancelled. Some of these never run, some are
  cut short part way, and some are reinstated and run anyway.
- **Ghost run** - a false reading. AT sometimes reports one vehicle's position under a different
  trip id, so a run appears to be an hour or more off its timetable when it was not. A nightly check
  finds these and hides them from the figures.
- **Ingest** - the job that reads AT's live feed every two minutes and stores the new arrivals.
- **Nightly aggregate** - the job that runs after each day ends, checks it for ghost runs, and
  stores one summary row per route per day. Week and month figures are built from these summaries.
- **Board** - a ranked list on the site, such as "Most off-schedule" or the worst trips of the day.
- **Card** - the preview image a chat app or social site shows when someone shares a link.
- **Smoke test** - an automated check that opens every page in a real browser and fails if one
  errors or shows broken text.

## [1.55.23] - 2026-09-23

### Fixed

- The pre-release page check no longer reports the route page's Stops section as empty. A collapsed
  disclosure reports no text past its own label, so the check was reading the section's contents as
  absent rather than as one click away.

## [1.55.22] - 2026-09-23

### Changed

- No visible change: the dash that stands in for a figure the site does not have is now written from
  one definition in six more places, rather than as a loose character each time, so it cannot drift
  to a different glyph on one page.

## [1.55.21] - 2026-09-23

### Changed

- No visible change: the pulse placeholder every loading skeleton is drawn from now lives in the
  shared skeleton library rather than inside the shame board's own skeleton, which thirteen files
  had been reaching into for it.

## [1.55.20] - 2026-09-23

### Changed

- No visible change: the filter, sort and pager chips across the site now come from one definition
  rather than eleven copies of it, so a chip cannot be added that forgets to hold the reader's
  scroll position or to tell a screen reader which option is chosen.
- No visible change: the row layout shared by the shame board's trips and the cancellations list,
  and the sortable numeric column header shared by Live now and Hardest-worked vehicles, each come
  from one definition rather than two copies that had already begun to drift.

## [1.55.19] - 2026-09-23

### Fixed

- Three loading placeholders now match what replaces them: a shame day board draws the hours that
  have started rather than a fixed 24, a rank board on the week or month home reserves the rank
  column its movement badge needs and the row's trailing chevron, and the routes "Only" filter row
  draws its fourth chip.

## [1.55.18] - 2026-09-23

### Fixed

- A board or card that names one hour now opens the route page on that hour, and the time-of-day
  chips name a range no preset covers.

## [1.55.17] - 2026-09-23

### Fixed

- A stop page now links up to the worst-stops board - the only page on the site that lists stops -
  so a reader who arrived from a shame board or a route's stop table is no longer left with the top
  bar, which has no stops in it. The 404 page lists all nine pages rather than five: Live now and
  Cancellations are top-bar sections and Day by day and Vehicles have no tab of their own, so the
  one page whose whole job is being a way out was itself a dead end for four of them.

## [1.55.16] - 2026-09-23

### Fixed

- Day by day is now in the footer's Explore list, carrying the day being read like every other
  footer link. It previously had a single link on the whole site, on the home page's week and month
  views only, so a reader on the day view - the default - had no path to it at all.

## [1.55.15] - 2026-09-23

### Fixed

- The day-by-day page reads its window the way every other range page does, so a URL saying
  `window=day` no longer renders a week: it moves to the week holding the day it was reading,
  keeping the mode and school filters. A link followed onto the page now keeps the reader's date too
  - arriving with a day in the URL opens the week or month holding that day rather than the current
    one. Its table gained the horizontal-scroll wrapper every other table on the site has, so a long
    day label scrolls the table rather than the page.

## [1.55.14] - 2026-09-23

### Fixed

- The day and period steppers and the board pager - icon-only chips the whole archive is read
  through - are now 44px targets instead of 42x26. Every filter chip row marks its active chip with
  aria-current, so a screen reader can tell which mode, direction, part of day or sort is in force.
  The 4am-to-4am service day is stated in the footer, where it was previously explained only in a
  tooltip no phone can reach. The route page's Stops section keeps its heading in the outline when
  it has data, its table and the route week table name their columns to assistive tech, and the
  vehicles rank row stops announcing its own label twice.

## [1.55.13] - 2026-09-23

### Fixed

- A flame badge's tooltip is now removed from the layout while it is hidden rather than merely made
  transparent, so a label longer than the badge's room cannot give a shame board a horizontal
  scrollbar that nothing on screen explains; shown, it wraps inside a bounded box instead of running
  off the side.

## [1.55.12] - 2026-09-23

### Fixed

- The trip board states what the active sort actually ranks on, so "Most off" and "Latest" stop
  looking like the same question asked twice - a run 9m early tops one and sits at the far end of
  the other. Runs on an identical average now break their tie on departure time and then trip id, in
  the query as well as on the page: the query takes only the first 50, so an unbroken tie decided
  which runs appeared at all.

## [1.55.11] - 2026-09-23

### Fixed

- A figure and its colour now agree: an off-schedule average is banded on the rounded value it
  prints, so two rows both reading "5m late" cannot be one green and one red; the worst-stop card
  and the worst-stops board word their average and take its tone from its direction instead of
  painting a directionless magnitude red, and that card names the hour its figures are from, as the
  worst-route card beside it already did; the hottest flame badge leaves the blue that means on time
  everywhere else.

## [1.55.10] - 2026-09-23

### Fixed

- The highlighted Day/Week chip and the highlighted window tab are no longer links, so clicking the
  view you are already on cannot reset the board's sort and page; the day and period steppers and
  the vehicles rank chips hold the scroll position, as the mode chips beside them already did.

## [1.55.9] - 2026-09-23

### Fixed

- A link now carries exactly the view it was clicked from: a trip opened from a part-of-day board
  returns to that board rather than the whole day, a vehicle's day link keeps the list state behind
  it, a card naming today stops paying a redirect for a param that is about to be stripped, /shame
  passes on only the params its boards read, and /rankings?window=day round-trips instead of landing
  on the week.

## [1.55.8] - 2026-09-23

### Fixed

- Empty states now say whether a figure is absent or unknown: a zero-arrival day on Day by day names
  the cancellations that explain it, an empty rank board names the arrivals bar a route had to
  clear, the routes hero says its dashes are blank rather than zero, a stage filter that empties the
  cancellation list offers a way back out, and the 404 no longer insists a mistyped page was a route
  or stop.

## [1.55.7] - 2026-09-23

### Fixed

- A route or stop day with no arrivals now says so under its KPI strip, and the on-time popover says
  there is no split to show instead of drawing an empty bar at 0%.

## [1.55.6] - 2026-09-23

### Fixed

- An open day's cancellation penalty was charged against arrivals the day had not reached yet, so a
  trip cancelled for the evening dragged this morning's on-time share down and the figure recovered
  through the day for no real reason. A cancellation is now counted only once its scheduled
  departure has passed, from the same clip point the arrivals use. The route stats resolve their
  window once instead of the arrivals falling back to a rolling 168 hours while the penalty covered
  seven service days - which the public stats API returned as one figure.

## [1.55.5] - 2026-09-23

### Fixed

- A part-of-day filter drops the cancellation penalty, and every stop figure never had it, but both
  still carried the sentence saying cancelled trips were counted. Each punctuality figure now states
  the basis it was actually computed on. A route day view with a direction or a part of the day
  chosen says what the figures above it do and do not cover, as the week view already did, and the
  per-stop table says why its arrivals add up to less than the strip above.

## [1.55.4] - 2026-09-23

### Fixed

- Every page read that degrades when the database is unreachable now logs at error level under a
  stable [DB-READ-FAILED] marker, so an outage can be alerted on instead of finishing as a
  plain 200. A database failure on /live no longer tells the reader AT's feed was at fault. The
  connection pool is bounded to 10 sockets per instance with a 10s wait, so a saturated pool fails
  cleanly rather than hanging.

## [1.55.3] - 2026-09-23

### Fixed

- Every surface that states the on-time window now says whose it is: "That window is this site's
  choice, not AT's." Auckland Transport publishes the schedule, but the threshold a run is judged
  against is the site's own, and stating it bare under an AT logo read as AT's own standard. The
  route, stop and trip descriptions now name the schedule and the window separately.

## [1.55.2] - 2026-09-23

### Fixed

- A route's "Avg delay" no longer reads "on time" beside an on-time percentage: it always names a
  distance, such as "6s late", coloured by band. Applies on the routes explorer, a route's week
  table and its per-stop table. The verdict sentence and the share card now list the arrival count
  and the on-time share instead of joining them with "of", which claimed a relationship the two
  figures do not have.

## [1.55.1] - 2026-09-23

### Fixed

- The site is named AT Route Performance in the masthead, the footer and every tab title, replacing
  three competing names. A trip's title now reads "NX1 trip, Wed 23 Sep" rather than a raw GTFS id,
  and the masthead logo no longer announces itself as Auckland Transport.

## [1.55.0] - 2026-09-23

### Added

- The site had no robots.txt and no sitemap, while every page renders against the database, so a
  crawler following links could walk one route page multiplied by day, window, mode, direction, part
  of day, sort and page - a distinct uncached render each time. robots.txt now shuts out the
  query-string permutations, per-run trip pages and per-vehicle pages, and turns away the agents
  that train models or index backlinks rather than send readers. Search engines are unaffected.
  sitemap.xml lists the canonical set instead: the nine sections and one URL per current route, with
  feed versions collapsed, 541 in total. A preview deployment disallows everything, so a throwaway
  build cannot turn up in search beside the real site.

## [1.54.9] - 2026-09-23

### Fixed

- The route directory computes its lineage trim outside its own hourly cache, because a successor
  line starts carrying traffic within ten minutes of its first train. /api/routes then wrapped the
  whole answer in an hour of shared caching, putting that staleness straight back. It now holds for
  ten minutes, matching the trim. This matters at the CRL cutover, when four train lines retire at
  once and a stale answer lists a retired line beside the one replacing it.

## [1.54.8] - 2026-09-23

### Changed

- Route display names were cached under a key built from the exact set of route ids asked for, so a
  board showing a different set per mode, sort, page and day almost never found a warm entry and
  left a new one behind each time. The whole name table is a few hundred rows, so it is now held
  under a single key.

## [1.54.7] - 2026-09-23

### Changed

- Only a single live day's figures are keyed on the last ingest run, but every window was fetching
  that run before it could read its cache - including the current week and month, which key on the
  service date and discard it. That lookup is held per worker thread rather than in the shared
  cache, so a cold instance paid an uncached database round trip in front of every page render.

## [1.54.6] - 2026-09-23

### Changed

- Page views are now reported to Vercel Analytics, beside the Speed Insights already collected. Both
  scripts are served from the deployment's own origin and load only on Vercel, so local builds and
  the CI smoke are unaffected and the content security policy needs no exception.

## [1.54.5] - 2026-09-23

### Changed

- Dependency update: Next 16.3.6 with its matching bundle-analyzer and eslint-config-next,
  @vercel/speed-insights 2.0.0, @vercel/analytics 2.0.1, tsx 4.23.15 and typescript-eslint 8.70.1.

## [1.54.4] - 2026-09-23

### Fixed

- The five section tabs no longer crowd the logo on a narrow phone.

## [1.54.3] - 2026-09-23

### Fixed

- A held batch can no longer be overwritten by another poll holding one in the same millisecond.

## [1.54.2] - 2026-09-23

### Fixed

- Spool replay no longer stalls on a blob response that carries no body.

## [1.54.1] - 2026-09-23

### Fixed

- The spool's configuration check accepted only a read-write token, so a Blob store connected
  through OIDC - which sets a store id instead - would have read as no store at all. The spool would
  then have sat silently off while the configuration looked right, and an outage would still have
  lost data. Either form now counts.

## [1.54.0] - 2026-09-23

### Added

- A poll that cannot reach the database no longer loses its arrivals. Once the retries run out, the
  batch is gzipped into a Vercel Blob store, and every later poll replays the spool oldest-first
  before fetching AT, deleting each batch as it lands. Replay is safe to repeat: the inserts already
  ignore duplicate keys and the arrivals are upserts keyed on the stop visit, so a batch that partly
  landed before the outage does nothing the second time. At most 8 batches replay per run so a
  catch-up cannot collide with the next poll, and a batch older than a day is dropped rather than
  written over what the nightly aggregate has since settled. The spool needs a Blob store connected
  to the project; without the token it is off and the ingest behaves as before.

## [1.53.0] - 2026-09-23

### Added

- A route page can now be narrowed to a part of the service day - Early, Morning peak, Midday,
  Evening peak or Night - with All day as the default. The five presets partition the 4am-4am day
  exactly once, and Night wraps past midnight, so a bus leaving at 11:30pm counts in the same band
  as the rest of that evening. Every figure moves together: the summary, the per-stop table, the
  route map and the buses-of-the-day board, which would otherwise have shown evening runs under a
  morning-peak heading. A narrowed view stays on measured arrivals alone, because a cancellation is
  counted per service day and cannot be placed in one hour of it.

## [1.52.1] - 2026-09-23

### Fixed

- The nightly pre-warm now covers the hardest-worked-vehicles page. It has a day stepper like the
  other warmed pages, so until now its first reader each day paid for the cold render. Three
  documented claims were corrected against measurement: the realtime ingest's cadence is not a free
  knob (three constants are pinned to it, and a slower poll degrades every delay figure), a poll
  takes 2.6s at the median and 12s at p90 rather than the 8s and 22s a code comment claimed, and a
  cron-job.org failure notice on that job is usually the scheduler's 30s drop rather than a real
  failure - none of 8,617 polls failed server-side.

## [1.52.0] - 2026-09-23

### Added

- A database outage no longer takes every page to an unstyled error screen. The footer's freshness
  line now reads "Last update unknown" instead of claiming the site is awaiting its first data, and
  each page fails through its own error boundary, so the masthead, nav and footer survive an outage.
  /api/health gained a database field, probed with a five-second bound, so a monitor can watch the
  database separately from the build - the two fail independently.

## [1.51.2] - 2026-09-23

### Fixed

- The ingest now waits out a database that is unreachable, retrying a write over about 27 seconds
  instead of giving up at once. AT's feed is a snapshot of where the buses are at that moment and
  nothing re-fetches it, so a write abandoned during a restart was a permanent hole in the record;
  only dropped sockets were retried before.

## [1.51.1] - 2026-09-23

### Fixed

- The smoke test now expects /shame to land on the trips board, and it visits the routes board
  alongside the trips and stops ones.

## [1.51.0] - 2026-09-23

### Added

- The home page now shows a worst trip, a worst route and a worst stop for whichever window is open,
  each taken from that board's own ranking so the card and the board it names never disagree. The
  route and stop cards gained the trip card's clean-window state, so a window with nothing bad
  enough to crown reads green instead of blank.

## [1.50.2] - 2026-09-23

### Changed

- A shame board's title, window controls and filters now appear while its rows are still loading,
  and the placeholder matches the window you opened.

## [1.50.1] - 2026-09-23

### Fixed

- The shame boards now carry the Day / Week / Month controls the rest of the site uses, so a window
  switch stays on the day you were reading, and the board tabs say which one you are on.

## [1.50.0] - 2026-09-23

### Added

- The three shame boards now have their own top-bar tab and footer links, and /shame opens the trips
  board with whatever day, window and filter you arrived with.

## [1.49.9] - 2026-09-23

### Fixed

- The worst-trip, worst-route and worst-stop boards now go by one name each - on the page, in the
  browser tab and on a shared link - and the worst-stop board marks the one hour or day it crowns
  instead of every appearance of that stop. The stop board names the filter it is under, and a past
  week or month is described as such rather than as "this week".

## [1.49.8] - 2026-09-23

### Fixed

- A run or vehicle opened from a live map popup loads like any other link, instead of reloading the
  whole site.

## [1.49.7] - 2026-09-23

### Fixed

- Back from a trip, a vehicle or anywhere off the Cancellations list lands where you left it: the
  route's trip board keeps its sort, page and direction, the vehicles list its filters, sort and
  length, the cancellations list its stage and how far it was opened, and the line diagram its
  version.

## [1.49.6] - 2026-09-23

### Fixed

- A vehicle's page lights Overview in the top bar, and a section tab lit for a page under it is
  marked as the current section rather than the current page

## [1.49.5] - 2026-09-23

### Fixed

- Links keep what you were looking at: the home page's week link opens the viewed day's week,
  cancellations and the shame route board open a route's week on a week or month, live's mode chips
  keep the full list, the route's day and week toggle keeps its threshold, and vehicle route links
  go straight to the route

## [1.49.4] - 2026-09-23

### Fixed

- A run that crosses 4am now counts whole, on the day it started, on the trip page, the route's trip
  board, the stop board, the stop page and cards, and the cancellation stages; an undated trip link
  opens the day the run started

## [1.49.3] - 2026-09-23

### Fixed

- Pages now say which day they mean. On a past day the shame boards and the home page's worst-trip
  card say "that day" instead of "today", and the week tab's default reads "over the last 7 days",
  since it is not the calendar week. The home page's shared-link title names the day the page opens
  on, and a stop page's title reads the same day as the page. Hovering the date on any day stepper
  shows the 4am-to-4am window it covers. A run after midnight now says it counts toward the day
  before: a note on the trip page, a tooltip on the 12am to 3am rows of the shame boards and on the
  route's trip list, and a line above the late departures in a stop's schedule, which now lists them
  last instead of first.

## [1.49.2] - 2026-09-23

### Fixed

- Every day page and its shared-link card now opens on the same day. Before today has 2,000 arrivals
  due (about 5:45am), the home page, the shame boards, Routes, Cancellations, the vehicle pages and
  each route and stop page all show yesterday, where each page used to decide for itself and a quiet
  stop could show a different day from the home page. Yesterday's next-day arrow is replaced by
  "today still starting" until today opens, so it no longer leads back to yesterday.

## [1.49.1] - 2026-09-23

### Fixed

- Weeks and months now run from 4am to 4am like days, so between midnight and 4am on a Monday or the
  1st the week and month views stay on the one still running, and a week is no longer treated as
  finished while its Sunday is.

## [1.49.0] - 2026-09-23

### Added

- The route diagram marks the day's recorded stop closures and detours: a strand bends round a stop
  closed all day on the side of the way it closed, a grey dashed stub marks line no run used,
  detours the runs took step off in orange (dashed for one or two runs), and an announced detour is
  dashed along the line. A part-day closure keeps its figure with a star, and notes under the
  diagram say where, which way, when and what said so. Arrivals timed at a stop while it was closed
  are left out of its figures.

## [1.48.0] - 2026-09-23

### Added

- The realtime ingest now keeps a record of stop closures and detours as they happen, for the route
  diagram to show. A record opens from any of three signs: an AT alert naming a stop as skipped,
  moved or detoured on a route; AT's feed marking a stop skipped on a run already under way; or a
  run seen off its road between two stops it did serve. A detour the buses show counts once three
  runs take it within two hours, and ends once three runs pass through those stops again; one AT
  announced but three runs drove straight through is marked as disputed. Each record keeps the runs
  that showed it, so a poll that misses the step is made up by the next one. Nothing on the site
  shows these yet. The cleanup cron deletes ended records past the retention window, the same as the
  other collections.

## [1.47.0] - 2026-09-23

### Added

- The route page's line diagram is now a strip map. The line runs down the page carrying both
  directions, and each stop's ring is split in two: the left half for runs reading down the list and
  the right half for runs reading up it, each in the colour of that direction's average delay that
  day, and dashed where that direction doesn't stop. Two figure columns beside the names give each
  direction's delay, headed by where its runs end, or Clockwise and Anticlockwise on a circuit run
  both ways. Where a route has more than one version, chips pick one: the stops it doesn't use go
  grey, and the figures become that version's runs alone. The direction chip at the top of the page
  dims the other direction instead of redrawing, so no stop moves. A long route splits into two
  columns on a wide screen, and on a phone a long stop name wraps onto a second line. The week view
  draws the line without figures, since figures per stop are kept for a single day. The old snake
  diagram is gone.

## [1.46.0] - 2026-09-23

### Added

- The route diagram v2 now has its layout. Both directions merge into one list of stops, with a
  stop's two sides of the road on one row. The version that reaches the most stops runs straight
  down, and stops only other versions reach sit on a track beside it. A loop such as the Southern
  line's city loop is drawn as a lasso, and a circuit such as the Inner Link ends on the stop it
  started from. Every stretch of line is drawn once and knows which versions run along it, so the
  pieces always meet. Versions are now matched by the names of their ends, since a bus stop has a
  different id on each side of the road, and one carrying under 5% of a route's runs is listed as a
  minor version.

## [1.45.0] - 2026-09-23

### Added

- Each stop's figures on a route can now be read per direction and per version (runs with the same
  two termini), joined through each run's trip record. The route diagram v2 draws from them.

## [1.44.0] - 2026-09-22

### Added

- The trip page's stop list is now a transit map drawn in the route's colour. Stops the run made off
  its timetable sit on an orange spur where they came in time, not at the end. Stops a detour went
  around are marked skipped only where GPS put the vehicle off route. A live run greys the legs it
  has not reached, and the key names only what is on screen.

## [1.43.0] - 2026-09-22

### Added

- The mouse wheel zooms a map once the pointer is resting on it; scrolling the page past a map still
  scrolls the page.

## [1.42.2] - 2026-09-22

### Fixed

- Every line on a shared-link card is at least 40px, so a card shrunk into a phone's feed can still
  be read; long names end in an ellipsis instead of wrapping.

## [1.42.1] - 2026-09-22

### Fixed

- The smallest text on the site is 13px, nothing is set under 12px, and the shared-link cards'
  smaller lines are larger.

## [1.42.0] - 2026-09-22

### Added

- The trip page says when Auckland Transport reported a run under another run's number.

## [1.41.12] - 2026-09-22

### Fixed

- Early figures and labels across the site (the boards, the trip page, the live and vehicle pages)
  use the darker green, so they read on white. Swatches and chips keep the brand green.

## [1.41.11] - 2026-09-22

### Fixed

- Early vehicles on the maps, and the early dots on the live map, use a darker green. The brand
  green was hard to see on white, about 2.1:1; the darker one is about 5:1, like late and on time.

## [1.41.10] - 2026-09-22

### Fixed

- Per-deployment preview addresses go back to the watermarked map tiles. CARTO can only allow them
  with a wildcard over every Vercel site, so only the branch preview link gets the key.

## [1.41.9] - 2026-09-22

### Changed

- The changelog entries for 1.41.6 and 1.41.7 are back after being dropped by the 1.41.8 commit.

## [1.41.8] - 2026-09-22

### Fixed

- A preview deployment's own address can also send the map key, so every preview link, not just the
  branch one, can draw clean tiles once CARTO allows it.

## [1.41.7] - 2026-09-22

### Fixed

- Maps on a branch's preview link (the git-dev address) can draw clean tiles once the key is allowed
  there, rather than always showing the watermarked ones.

## [1.41.6] - 2026-09-22

### Fixed

- A live vehicle's page now says it is on a run now, rather than on the road, which never fitted a
  train or ferry.

## [1.41.5] - 2026-09-22

### Fixed

- Speed Insights now only loads on the live site, so local builds and the CI smoke test no longer
  fail looking for its script.

## [1.41.4] - 2026-09-22

### Fixed

- Picking a direction on a route's week view now narrows the map's stops, line and live buses and
  the line diagram to that direction, as the day view already did, with a note that the week's
  figures still cover both. The week view's line diagram draws again instead of saying no trips were
  observed.

## [1.41.3] - 2026-09-22

### Fixed

- On a phone the line diagram is laid out six stops to a row and drawn close to full size, instead
  of a desktop-width line shrunk to a third, and short lines stack one per row. The stop tooltip
  stays inside the diagram at both edges and drops below a stop near the top. The loading
  placeholder is sized for each width.

## [1.41.2] - 2026-09-22

### Fixed

- The line diagram is one tab stop per direction, with the arrow keys stepping along its stops, and
  each stop is announced by name and delay. Tapping a stop on a phone shows its name, and tapping
  elsewhere closes it. Desktop no longer shows two tooltips at once.

## [1.41.1] - 2026-09-22

### Fixed

- The line diagram no longer leaves a stop without its delay when every side of it is crossed by a
  line; the number is drawn over the line with a white backing instead. Label widths now come from
  the font itself, so labels stop dodging space they never needed. A detour note with no readings no
  longer prints a nonsense distance.

## [1.41.0] - 2026-09-22

### Added

- The Routes page has a Running now filter, which keeps only the routes with a vehicle on a run at
  the moment.

## [1.40.0] - 2026-09-22

### Added

- New Live page (in the top bar): every bus, train and ferry on a run right now on one map, coloured
  by how late it is, with counts of how many are late, on time or early, and a table of the routes
  running. Tap a dot to open its run or the vehicle.

## [1.39.0] - 2026-09-22

### Added

- New Hardest-worked vehicles page ranking every vehicle by hours in service, with a LIVE mark on
  the ones running now. Each vehicle has its own page: where it is now on a map, its current run,
  how it ranks, and every run or day in the chosen period.

## [1.38.0] - 2026-09-22

### Added

- The home page has a Vehicles on the routes section, counting the buses, trains and ferries seen on
  the chosen day and since records began.

## [1.37.0] - 2026-09-22

### Added

- A train on the live map and on the trips board now says how many carriages it has. Every live-feed
  check also records each vehicle's fleet label and number plate, so vehicles can be named later.
  The map no longer remembers its zoom, so each visit shows the whole route again.

## [1.36.9] - 2026-09-22

### Fixed

- The trips, routes and stops boards for a day now list the same hours, with an empty row where a
  board had nothing, so one no longer stops early or skips an hour the others show. The last row of
  the right-hand column gets its bottom border.

## [1.36.8] - 2026-09-22

### Fixed

- Behind the scenes only: when the site runs on a developer's own computer, a page opened at
  localhost now moves itself to at.localhost. The map provider (CARTO) will not accept its key from
  localhost, but does from at.localhost, so local maps load without the "API KEY REQUIRED"
  watermark. The live site is unaffected.

## [1.36.7] - 2026-09-22

### Changed

- Documentation only: every changelog entry is rewritten in plain words, saying what changed on the
  site, what you would notice and why, with a list of the terms it uses (service day, ghost run,
  on-time window and others) at the top. Entries that only changed how the site is built or tested
  now say so.

## [1.36.6] - 2026-09-22

### Fixed

- Live vehicles on the route and trip maps are easier to understand and to use without a mouse.
  - A screen reader now reads each vehicle marker by name, for example "Bus 3524, 5m 1s late".
    Before, a marker could be reached with the Tab key but announced nothing.
  - The keyboard focus ring around a marker is round, following the vehicle's disc, instead of a
    square around its box.
  - A key under each map now explains the vehicle marker: the ring colour shows its delay (grey
    means the feed gave no delay), the point on the ring shows which way it is heading, and the
    floating label shows how far off schedule it is once it is outside the on-time window. On a trip
    map where the vehicle left its route, the key also explains the dashed orange line. The route
    map and the trip map now share one key instead of two copies that had drifted apart.
  - The train and ferry icons inside the marker were squashed sideways. They now keep their
    proportions.

## [1.36.5] - 2026-09-22

### Fixed

- The route map was hiding some vehicles that were really running. It only drew a vehicle within 2km
  of one of the route's stops, and some stops are much further apart than that: Papakura to Pukekohe
  is about 18km, so a train between them vanished from the map. Distance is now measured to the
  route's line itself, so a vehicle anywhere along the route shows. A vehicle more than 2km from the
  line is still left off, since that is usually a bus parked at a depot that the feed has not yet
  taken off its last trip.
- Vehicles now always draw on top of the small direction arrows along the route line. Before, an
  arrow could cover a vehicle, depending on which was further south.
- When the map is showing one direction only, a vehicle whose direction the feed does not report is
  now left off, since it may be running the other way.
- If the live positions fail to load, the map now says "Live positions could not be refreshed.
  Trying again in two minutes." Before, a failure looked exactly like no vehicles running.

## [1.36.4] - 2026-09-22

### Changed

- Live vehicles on the route and trip maps now move smoothly.
  - Every two minutes the map used to delete every vehicle and draw them all again, so the map
    flickered, any popup you had open closed, and vehicles jumped up to a kilometre or two in one
    frame. Each vehicle is now kept and slides to its new position over one second. An open popup
    stays open and updates in place. (The slide is turned off if your device asks for reduced
    motion.)
  - Coming back to the tab after being away for two minutes or more now fetches fresh positions
    straight away, instead of showing old ones until the next scheduled refresh.
  - A map that becomes a live view after the page has loaded now starts showing vehicles. Before,
    the map only checked once, when it first appeared.

## [1.36.3] - 2026-09-22

### Fixed

- The arrow showing which way a live vehicle is heading was a tiny triangle that was hard to see,
  and in the early (green) colour almost invisible. It is now a larger chevron, the same shape as
  the arrows along the route line, with a white edge so it stands out against any map background. It
  is drawn over the vehicle's ring so the ring cannot hide it.
- A parked or stopped vehicle no longer shows an arrow pointing north. AT's feed reports a heading
  of 0 (due north) when a vehicle is stationary or its heading is unknown, so every parked bus used
  to claim it was heading north. A heading of 0 now means "unknown" and draws no arrow.

## [1.36.2] - 2026-09-22

### Fixed

- The "5m late" style label beside a live vehicle used to sit on top of the vehicle's own icon,
  because it was positioned from the icon's centre. It now starts just past the icon's edge.
- The label now has a solid white box behind it. It used to be thin text with a faint outline, which
  was hard to read over roads and parks.
- The label now appears only when a vehicle is outside the on-time window (more than 5 minutes late,
  or more than 1 minute early). Before, it appeared at a separate 2-minute threshold, so labels
  popped in and out for vehicles the rest of the site called on time.

## [1.36.1] - 2026-09-22

### Fixed

- A live vehicle on the map could give three different answers about how late it was. A bus 3
  minutes late showed a red "late" ring, a "3m late" label, and a popup saying "on time", because
  each used its own rule. All three now use the same on-time window as every other figure on the
  site:
  - the ring is coloured by that window, so a bus 3 minutes late has an on-time ring;
  - the label and the popup say the same words, such as "5m 1s late";
  - inside the window the popup still says how far off it is: "3m late, inside the on-time window"
    rather than a bare "on time";
  - a vehicle the feed gives no delay for is now grey. Before, it was the on-time blue, so "no data"
    and "on time" looked the same.

## [1.36.0] - 2026-09-22

### Added

- Sharing a link to any Shame page, the Routes page or the Cancellations page now shows a preview
  card in chat apps and on social sites, describing exactly what was shared: the same day, week or
  month, and the same bus, train or ferry filter.
  - `/shame` shows the day's worst run and how late it was, plus one line each for the worst route
    and the worst stop.
  - `/shame/trip`, `/shame/route` and `/shame/stop` show the worst run, route or stop on that board
    and its figure. On a day where nothing was worse than the on-time window, the card says "Nothing
    stood out" instead of naming a winner.
  - `/routes` shows how many routes match, how many arrivals they made, the share on time and the
    average off schedule.
  - `/cancellations` shows how many trips were flagged cancelled, how many never ran and how many
    were cut short, and which route had the most.
- These pages now also have their own title in the browser tab and in the link preview (for example
  "Worst route of the week, week of Mon 14 Sep (Trains)").

## [1.35.0] - 2026-09-22

### Added

- Sharing a link to a route, a single run or a stop now shows a preview card for it.
  - A route card shows the route's number and name and its share of arrivals on time, for the day or
    week in the link, coloured by the same Great-to-Shit scale as the home page.
  - A run card shows the route, where the run was headed, and how far off schedule it ran on
    average, or that it was cancelled or cut short.
  - A stop card shows the stop's name and how far off schedule its arrivals were on average.
- A card for a past day always describes that day, not today. A link to a route or run that does not
  exist still gets a plain branded card rather than a broken image.

## [1.34.0] - 2026-09-22

### Added

- Sharing a link to the home page now shows a preview card of that exact view: the day, week or
  month it names, any bus, train, ferry or school-bus filter, the one-word verdict (Great to Shit),
  the share of arrivals on time and the average off schedule. The card uses the site's colours and
  the "AT Route Performance" name, and says the site is independent and not affiliated with AT.
- A card for a finished day never changes, so it is kept for a week. A card for today is refreshed
  every five minutes.

## [1.33.0] - 2026-09-22

### Added

- A new Day by day page (`/days`), reached from the "Day by day" link on the week and month views of
  the home page. It shows a bar for each day of the week or month, its height the share of arrivals
  on time and its colour that day's verdict (Great to Shit), so you can see which days made the week
  good or bad. Under the chart is a table of the same days with the verdict, on-time share,
  arrivals, average off schedule and flagged cancellations. Every day links to that day on the home
  page. The bus, train, ferry and school-bus filters apply.

## [1.32.7] - 2026-09-22

### Changed

- Behind the scenes only: the automated tests moved out of the `src/` folder into a `tests/` folder
  laid out the same way, so the app's code and its tests are no longer mixed together. Nothing on
  the site changed.

## [1.32.6] - 2026-09-22

### Changed

- The worst stop for a week or month loads much faster. It used to be worked out by scanning every
  arrival in the whole week or month on each visit (up to about 9 seconds). Each finished day's
  per-stop totals are now saved once and reused, so only today has to be scanned again.

## [1.32.5] - 2026-09-22

### Changed

- Behind the scenes only: the site's API routes are now deployed as one server bundle instead of
  three, which roughly halves the amount of server code stored for each deployment. Nothing on the
  site changed.

## [1.32.4] - 2026-09-22

### Changed

- The week and month views of the home page appear sooner. The verdict and the route boards now show
  as soon as the rankings are ready, and the worst-trip and worst-stop cards each fill in when their
  own figures arrive. Before, the whole page waited for the slowest of these (usually the worst
  stop).

## [1.32.3] - 2026-09-22

### Changed

- The current week and month views load faster. They used to be recalculated from scratch every time
  new arrivals came in, which is every two minutes, so almost every visitor paid the full wait. They
  now show the last result straight away and refresh it in the background. A new day still starts
  fresh, so you never see yesterday's figures labelled as today's.

## [1.32.2] - 2026-09-21

### Fixed

- The one-word verdict on the home page now uses the words Great, Fine, Meh, Bit bad and Shit (best
  to worst). The share of arrivals on time needed for each, and the colours, are unchanged.

## [1.32.1] - 2026-09-21

### Changed

- The home page is grouped into three clear sections instead of eight loose blocks: Today (the
  verdict and the day's figures), Shame of the day (the worst run, route and stop), and Route
  rankings (the two boards).
- The bus, train, ferry and school-bus filters now sit above the verdict, because they change all
  three sections. The late and early filters sit on the rankings heading, because they only change
  the boards.
- On the week and month views, the filters and headings no longer disappear while the figures are
  loading.

## [1.32.0] - 2026-09-21

### Added

- The home page now answers its own question, "How bad was it today?". It leads with a one-word
  verdict on the whole network's share of arrivals on time, from the best word down to "Shit", with
  a five-step meter showing where the day sits and a sentence giving the figures behind it (for
  example "65.9% of 73,667 arrivals were on time, 2m 19s off on average"). The scale is set so a
  typical weekday lands in the middle and the word can move either way. The on-time explainer lists
  the whole scale. The week and month views get the same verdict.
- The worst-trip card puts where the run was headed on its own line, so the route name lines up with
  the worst-stop card beside it.

## [1.31.7] - 2026-09-21

### Fixed

- Boards sorted by how far off schedule something was now always show that distance. A run 2 minutes
  late used to print "on time", because it was inside the on-time window, even though the board was
  ranking it by those 2 minutes. It now reads "2m late" in the on-time colour. A run that was early
  at some stops and late at others reads "4m off".
- The trip page now names the day the run was on in its heading and browser tab.
- Timetable times now have a space before am and pm ("12:49 pm"), like the rest of the site.

## [1.31.6] - 2026-09-21

### Fixed

- A ghost run (see Terms) that the nightly check hid no longer takes up a row on a route's trips
  board or counts in the route's "Trips" figure. Before, it was hidden from the delay figures but
  still listed and counted.
- The on-time, early and late percentages on the day boards and rankings now count only real
  readings, so a hidden ghost run can no longer move a route's on-time share.
- Every saved board is recalculated once when this version is deployed, so days that were repaired
  stop showing their old figures.

## [1.31.5] - 2026-09-21

### Changed

- Every day board now files a run under the service day stored with it when it was recorded, instead
  of working it out again from the clock. A run that crosses 4am is now counted once, whole, on the
  day it started, instead of being split across two days.
- Fixed a bug in the route "streaks" on the Shame route board. AT reuses a trip id on every day its
  timetable runs, and the streaks were treating a fortnight of one trip's runs as a single row on
  its earliest day. Each day's runs are now counted separately.

## [1.31.4] - 2026-09-21

### Fixed

- Scrolling the page with a mouse wheel over a map now scrolls the page instead of zooming the map.
  On a phone, a one-finger swipe over the map scrolls the page too; use two fingers to move or zoom
  the map.
- A trip map now opens showing the whole trip. It used to open zoomed in on the trip's first stop
  with that stop's popup open, which nobody had asked for.
- Moving the map on a trip page no longer changes where the route page's map opens. The two maps
  were sharing one saved position.
- The trip page's stop list now has a key explaining its grey and hollow stop dots.

## [1.31.3] - 2026-09-21

### Fixed

- On the trips board and the cancellations list, the whole row is now the link. Before, only the
  route or destination name could be clicked.
- On a narrow screen, a badge (such as CANCELLED or OFF ROUTE) that does not fit now moves under the
  name instead of cutting the name short ("32 to Manger...").

## [1.31.2] - 2026-09-21

### Fixed

- When a route's stop pattern fails to load from AT, the route page now says so. Before, the
  direction buttons and the line diagram simply vanished, and the diagram said the route had not
  recorded a full run yet, which was not true. The failed result was also being saved for 24 hours,
  so one hiccup at AT broke the route for the rest of the day; it is now retried on the next visit.
- When a trip's timetable fails to load, the trip page now says so, instead of showing a run with no
  stops or even a "page not found".

## [1.31.1] - 2026-09-21

### Fixed

- The trips board and the cancellations list now have a key under them explaining each badge that
  appears in the rows (CANCELLED, CUT SHORT, REINSTATED, OFF ROUTE, and the wait until the next
  trip). The explanations used to exist only as hover text, which a phone cannot show. The key only
  lists badges that are actually on screen.

## [1.31.0] - 2026-09-21

### Added

- Every button, link, filter chip and line-diagram stop now shows a clear blue outline when you
  reach it with the Tab key, so you can see where you are when using a keyboard. In the dark footer
  the outline is yellow so it stays visible. Clicking with a mouse does not leave the outline
  behind.

## [1.30.21] - 2026-09-21

### Fixed

- The small "i" explainer next to figures like "On time" is now usable on a phone. It used to open a
  box that ran off the side of the screen, slid under the sticky header, and could not be closed
  with a tap. On a phone it now opens as a panel across the bottom of the screen and closes when you
  tap anywhere else.

## [1.30.20] - 2026-09-21

### Fixed

- On the Routes page, "Show more" now survives the Back button. If you had shown 120 routes, opened
  one and came back, the list used to reset to the first 40. The number shown is now kept in the
  address.

## [1.30.19] - 2026-09-21

### Fixed

- The Shame pages now have the bus, train, ferry and school-bus filter buttons. Links from elsewhere
  already carried a filter onto them, but there was no way to see or clear it there.
- `/shame` itself ignored the filter entirely: a link saying "Trains" showed every mode. It now
  applies the filter and names it under the heading.

## [1.30.18] - 2026-09-21

### Fixed

- Sorting or changing page on a route's trips board no longer blanks the board. The board used to
  wait for AT's live vehicle feed (to know which runs to mark LIVE) before showing anything, so
  every click replaced the board, including the button you just pressed, with a grey placeholder
  until AT answered. The rows now show straight away and the LIVE badges appear when the feed
  arrives.

## [1.30.17] - 2026-09-21

### Fixed

- Both route boards on the home page now explain themselves. The on-time window was only explained
  under "Most off-schedule", and nothing was under "Most reliable", whose whole column is the
  on-time share. Each board now has its own line, so the two also start at the same height.
- "Most off-schedule" now has a colour key. Without one, a week where all ten worst routes ran early
  showed ten green rows under the heading "Most off-schedule", which looked like good news.

## [1.30.16] - 2026-09-21

### Changed

- One word, "Arrivals", is now used everywhere for a vehicle reaching a stop. The route, stop and
  Shame pages said "Events" for the same number that the home page and the cards called "Arrivals".

## [1.30.15] - 2026-09-21

### Fixed

- The home page called a figure "Cancelled" while the Cancellations page called the same number
  "Flagged cancelled". Both now say "Flagged cancelled", with a note under it that reinstated trips
  are included, because the number counts AT's cancellation flags, and some flagged trips run
  anyway.

## [1.30.14] - 2026-09-21

### Fixed

- The worst-route card's figures are for that route's single worst hour, not its whole day, but the
  card did not say so, so they seemed to disagree with the whole-day figures on the route boards.
  The card now names the hour ("Worst route - 5pm") and says how many arrivals were in that hour.

## [1.30.13] - 2026-09-21

### Fixed

- AT's service alerts only exist for right now; there is no history of past alerts. So on a past day
  or week, the alerts shown are today's. The alert banner now says "running now" on those pages and
  gives full dates for each alert, instead of a bare time that read as belonging to the day being
  viewed.
- On a past day, the route's line diagram no longer marks stops as disrupted or dashes the line
  because of today's alerts, which had nothing to do with that day.

## [1.30.12] - 2026-09-21

### Fixed

- The worst-trip card showed a green "No shame today" on a day with no data at all, which read as a
  perfect day. A day with nothing recorded now gets a grey "Nothing to rank yet" card, like the
  worst-route and worst-stop cards beside it.

## [1.30.11] - 2026-09-21

### Fixed

- The explanation of how cancelled trips affect the on-time share was wrong in one place and vague
  in others. It now says the same correct thing everywhere: each stop a cancelled trip missed counts
  by how long a rider would have waited for the next trip, as on time if that was under five minutes
  and late if longer.

## [1.30.10] - 2026-09-20

### Fixed

- Behind the scenes: when the site runs on a developer's own computer, it no longer sends the map
  tile key, which the map provider (CARTO) always rejects from there. Local test runs now show
  watermarked maps instead of eight blank ones, which had made the automated checks fail.

## [1.30.9] - 2026-09-20

### Changed

- Documentation only: the guide to the scheduled jobs said the route-shape download ran weekly. It
  actually runs daily, and the guide now says so and explains why daily is right (AT changed its
  route shapes twice in nine days).

## [1.30.8] - 2026-09-20

### Fixed

- The worst-trip, worst-route and worst-stop cards now open the run, route or stop they name.
  Before, they opened the Shame board they came from, and the heading above them went somewhere else
  again. The heading now opens the board, and each card opens its subject.

## [1.30.7] - 2026-09-20

### Fixed

- Clicking a cancelled run with no recorded start time now opens it on the day you were looking at.
  Before, it could open the most recent day that trip ran instead.

## [1.30.6] - 2026-09-20

### Fixed

- Clicking the top menu tab for the page you are already on no longer throws away your search and
  filters on that page.
- The menu and footer links on a trip page now keep the run's day. Before, they jumped to today.

## [1.30.5] - 2026-09-20

### Fixed

- On a route page, stepping to the previous or next day and choosing a direction now keep your sort
  order and filters. Stepping forward onto today used to drop them all.
- After the page falls back to an earlier day (because today has no data yet, early in the morning),
  the next-day arrow now goes somewhere. It used to lead back to the same page.

## [1.30.4] - 2026-09-20

### Fixed

- Clicking a route from a month view used to open that route on today, silently. It now opens the
  route on the last week of that month (the route page has day and week views, but no month view).
  All the boards and the Routes list now build this link the same way.

## [1.30.3] - 2026-09-20

### Fixed

- Switching between the Day, Week and Month tabs now keeps the date you were looking at. On Sunday
  14 September, the Week tab used to open the last seven days up to today; it now opens the week
  that contains the 14th.

## [1.30.2] - 2026-09-20

### Changed

- Behind the scenes only: removed four development tools from the project's direct list because
  other packages already install them, and removed two version pins and a leftover setting that were
  no longer needed. Nothing on the site changed.

## [1.30.1] - 2026-09-19

### Changed

- Behind the scenes only: each deployment of the site's server code is now much smaller, about 39MB
  per function instead of 95MB. The database library shipped five engines for other platforms that
  this site never uses, and they are now left out. It matters because the hosting plan has a 10GB
  limit on stored server code across all kept deployments, and the site had used 7.26GB of it.
  Nothing on the site changed.

## [1.30.0] - 2026-09-19

### Added

- The nightly check now catches a second kind of ghost run (see Terms). The existing check compares
  each reading with the rest of its own run, so it could not see a run where every reading was wrong
  by the same amount: all of them had been reported under another trip's id, about one vehicle cycle
  (an hour or more) off the run's real timetable, so they agreed with each other. Such a run is now
  hidden only when two things are both true: none of its readings is anywhere near its own
  timetable, and there is supporting evidence, such as the run's own start time (which is part of
  its trip id) being more than half an hour from the times it was reported at. A run that is
  genuinely late is still measured against its own timetable, so it is never hidden however late it
  is. Each hidden run is recorded with the reason it was hidden. On the eight days on record it
  hides exactly one run, on 14 September.

## [1.29.2] - 2026-09-18

### Fixed

- When AT cancels one single trip, its alert now appears on that route's page instead of in the
  network-wide alert banner on the home page, where it was noise for everyone else. The alert is
  headed with the route's short name ("Route 195", not AT's internal "Route 195-203") and links to
  the route.

## [1.29.1] - 2026-09-18

### Changed

- Past days load faster the first time. Every night the site now opens each day page (home, the four
  Shame boards, rankings and cancellations) for each of the last seven finished days, so their
  figures are already calculated and saved. Before, the first person to step back to one of those
  days had to wait while it was worked out.

## [1.29.0] - 2026-09-18

### Added

- Stepping to the previous or next day, week or month is now instant most of the time. The
  neighbouring pages load quietly in the background while you read, and a page you saw in the last
  two minutes is shown again straight away. If a step does still have to wait, its arrow pulses
  until the new page arrives, instead of looking like a click that did nothing.

## [1.28.0] - 2026-09-18

### Added

- A page showing today now updates its figures by itself, without a reload, each time new arrivals
  come in (every two minutes). Before, today's figures were refreshed on a fixed five-minute clock
  and only on reload. A page showing a past day stays as it is, since its figures do not change.

## [1.27.3] - 2026-09-18

### Fixed

- A real arrival could be overwritten by a false one. AT sometimes reuses a trip id for a different
  vehicle later in the day, and the second vehicle's report of the same stop replaced the first,
  real one. Now, when a different vehicle reports a stop that already has a reading far from it, the
  reading closer to the stop's timetable is kept and the stop is marked as affected. A vehicle
  revising its own reading (for example a bus first predicted on time that then arrives 40 minutes
  late) still always updates it. This protects arrivals from now on; ones overwritten before this
  fix (including seven on route 152 on 14 September) cannot be recovered.

## [1.27.2] - 2026-09-18

### Added

- Behind the scenes: a one-off repair script that goes back over every stored arrival and records
  which service day its run belongs to (see 1.26.0, which does this for new arrivals). A run that
  crossed the day boundary is filed whole under the day it departed. Nothing on the site changed
  until it was run.

## [1.27.1] - 2026-09-17

### Fixed

- A cancellation AT announced far in advance could be filed under the wrong day. The rule that
  matched a cancellation to its run's day assumed the notice came within twelve hours either side of
  departure, but AT gives up to 12h40m of notice, so four cancellations landed on the day before.
  Two of them would then have looked like duplicates of a real cancellation and been deleted by the
  service-day move (1.26.1). The window now allows up to 14 hours of notice and 10 hours of
  lateness, which matches what AT actually sends.

## [1.27.0] - 2026-09-17

### Changed

- The service day (see Terms) now runs 4am to 4am instead of 5am to 5am. Between 4am and 5am some
  early runs had already started while the site still counted it as the previous day, so a run could
  be split across two days, and the 4am hour did not appear in today's hourly figures. A cancelled
  trip is now also filed under the day its run was due to operate, rather than the day the
  cancellation was noticed.

## [1.26.1] - 2026-09-17

### Added

- Behind the scenes: a one-off script to move the stored data onto the new 4am service day (1.27.0),
  to be run straight after that version was deployed. It moves each day's saved summaries onto the
  new day boundary, refiles cancelled trips under their run's own day, and removes a date field from
  off-route readings that nothing used. Nothing on the site changed until it was run.

## [1.26.0] - 2026-09-16

### Added

- Every new arrival now records which service day its run belongs to, worked out once for the whole
  run when it is first seen. Before, each arrival's day was worked out from its own time, so a run
  that crossed the day boundary had its first stops on one day and its last stops on the next.

## [1.25.3] - 2026-09-16

### Changed

- Behind the scenes only: two instruction files (AGENTS.md and CLAUDE.md) that the Next.js
  development server writes into the project every time it starts are now kept in the project's
  history. Leaving them out meant the project always showed uncommitted changes. Nothing on the site
  changed.

## [1.25.2] - 2026-09-16

### Fixed

- Behind the scenes: the site decides whether a past day is finished (and its figures final) by
  finding that day's saved summaries. It used to look them up by one exact time of day, so moving
  the day boundary (as 1.27.0 later did) would have made every past day look unfinished. It now
  looks for any summary within the day. Nothing on the site changed.

## [1.25.1] - 2026-09-16

### Changed

- Behind the scenes only: a diagnostic endpoint that shows a sample of AT's live feed now also shows
  each trip's id, start date and start time. This was to check whether AT's feed says which day a
  run belongs to before building on it. Nothing on the site changed.

## [1.25.0] - 2026-09-16

### Added

- The site now says when its records start (11 September 2026) in four places: a line in the footer,
  a "first day" note on the day stepper when you reach 11 September, "(from 11 Sep)" after a week or
  month that starts before then, and a line under the home heading on that first day.

## [1.24.0] - 2026-09-16

### Added

- Asking for a day before the records start, or after today, now takes you to the nearest day that
  has data instead of showing an empty page. A week or month that starts before the records begin is
  cut to start on the first day and marked as partial. The rank movement arrows (up or down since
  the previous week) are left off when there is no previous week to compare with.

## [1.23.0] - 2026-09-16

### Added

- The site now knows its records start on 11 September 2026. The day stepper will not step back past
  that day, and week and month views stop there.
- Fixed how the middle of a service day is worked out. It used to add a fixed seven hours to the
  day's start, which is an hour out when daylight saving changes during the day. It now uses the
  actual clock time.

## [1.22.2] - 2026-09-16

### Changed

- Behind the scenes only: tidied the list of files the project keeps out of its history, removing
  rules for tools this project never uses and adding two folders it does create. Nothing on the site
  changed.

## [1.22.1] - 2026-09-16

### Changed

- Documentation only: the schedule of the site's nightly jobs is now written in New Zealand time,
  since that is how they are scheduled. It was written in UTC, which is out by an hour for half the
  year because of daylight saving. Also added step-by-step instructions for each reason the nightly
  clean-up can refuse to run (see 1.21.4).

## [1.22.0] - 2026-09-16

### Added

- Behind the scenes: the site's health check address (`/api/health`) now also reports how much
  history the last nightly clean-up kept, and whether that clean-up refused to run or was only a
  test run. This makes it possible to confirm that old data is not being deleted without logging in
  to the database. An automated test fails if the clean-up ever records keeping less than the safe
  minimum.

## [1.21.4] - 2026-09-16

### Fixed

- The nightly clean-up, which deletes arrivals older than the retention period, is now much harder
  to get wrong. If the retention period was not configured, it used to fall back to keeping only 14
  days and delete everything older. It now refuses to run instead. It also refuses to keep less than
  a year, to delete more than 2% of all stored data in one go, or to move its cut-off more than two
  days at once. Every run records what it decided and why, and it can be run as a test that deletes
  nothing (`?dryRun=1`).

## [1.21.3] - 2026-09-16

### Fixed

- Behind the scenes only: the code-style check (lint) had been changed to fix problems as it found
  them. That meant the check that runs before code is uploaded was editing files after they had been
  committed. It is back to only reporting problems, and fails on warnings too; fixing them is a
  separate command (`lint:fix`). Nothing on the site changed.

## [1.21.2] - 2026-09-16

### Changed

- Behind the scenes only: updated two development tools, and pinned the database library (Prisma) to
  exactly 6.19.3, because Prisma 7 no longer supports the MongoDB database this site uses. Nothing
  on the site changed.

## [1.21.0] - 2026-09-14

### Changed

- The home page and the Rankings page were one dashboard split in two: Home showed a day and
  Rankings showed a week or month, so changing the time span meant changing pages. The home page now
  has Day, Week and Month buttons like the Routes and Cancellations pages, and its week and month
  views include everything Rankings had (rank movement, and the Shame of the week or month).
  `/rankings` now forwards to the matching home page view. The top menu reads Overview, Routes,
  Cancellations.
- Moving between sections keeps what you were looking at. Each top menu link carries the current
  day, week or month and the bus, train, ferry and school-bus filters, so a past week on the
  Overview opens the same week on Routes or Cancellations. The late or early filter is not carried,
  because the same setting means something else on the other pages.
- The top menu now highlights Routes on route, trip and stop pages, and Overview on the Shame pages.
  Before, nothing was highlighted there.
- The "Shame of the day" (or week, or month) heading on the Overview now links to the Shame pages:
  the Shame overview for a day, which nothing linked to before, and the worst-trips page for a week
  or month, keeping the bus, train, ferry and school-bus filters.

### Fixed

- On a route's week view, the direction buttons used to jump back to the day view. They now stay on
  the week you are looking at.
- A route's Day and Week buttons used to forget the day, the week and the direction. Week on a past
  day now opens the week containing that day, Day on a past week opens its Monday, and stepping
  between weeks keeps the direction.
- A trip page's "Back to" link opened the route on today rather than on the day of the run.
- The Week button on the Shame pages opened the last seven days whatever day was showing, and the
  Day button opened today. They now keep the week containing the day, or the Monday of the week.

## [1.20.1] - 2026-09-14

### Fixed

- The Shame of the Day pages could show only part of the day. Saved results are reused until they
  expire, and even an expired one is shown once more while a fresh one is worked out. The saved
  result only knew whether a day was finished or not, so a result saved partway through today kept
  being reused. At 9:14pm one evening the Trips page stopped at 7pm, Routes at 8pm and Stops at 9pm,
  each showing the day as it was when someone last visited. A finished day could also show only up
  to the hour someone had looked at it while it was live: Sunday 13 September loaded only up to 4pm
  the next evening. Saved results now know three states: finished and summarised, over but not yet
  summarised (so nothing saved during the day is reused), and live (a new result at least every few
  minutes). The ranking and cancellation figures behind the home, Routes and Shame pages now follow
  the same rule.
- The Shame day pages put ten hours in the left column and the rest in the right, so a full day ran
  5am to 2pm on the left and 3pm to 4am on the right, with a gap under the left. The hours now split
  evenly, 12 and 12 for a full day.

## [1.20.0] - 2026-09-14

### Added

- The Routes page now has three preset buttons: "All routes", "Most off-schedule" and "Most
  reliable". The last two sort the list the same way as the home page's boards and hide routes with
  too few arrivals to judge, and every other filter (mode, area, late or early, cancellations,
  school buses) still applies. When sorted like this, each route shows its rank. Ties are settled
  the same way as on the boards, so a board's top ten always matches the top ten on the Routes page.

### Changed

- The "Most off-schedule" and "Most reliable" boards on the home and Rankings pages now show their
  top ten and a "See all N" link to the Routes page with that preset, keeping the day or week and
  the filters, instead of expanding in place. The separate "Every route" link under the boards is
  gone.

## [1.19.1] - 2026-09-14

### Fixed

- The automatic check that runs after every deployment (the smoke test) failed on every page with a
  map. The map provider's key (CARTO) only works from the site's real address, and the check visits
  the deployment's own temporary address, so every map tile was refused and the maps stayed blank.
  The key is now only sent from the site's real address. Any other address gets the free tiles with
  a watermark, as test deployments already did.

## [1.19.0] - 2026-09-14

### Changed

- Cancelled trips now count against a route's on-time figures. Before, only arrivals were counted,
  and a cancelled trip has no arrivals, so it could never be late. That meant a route that cancelled
  its late runs looked better for it. Now each stop a cancelled trip failed to serve counts as a
  rider's wait for the next trip on the same route and direction (capped at an hour): on time if
  that wait was within the on-time window, late if longer.
  - A trip that never ran counts at all its usual stops, a trip cut short counts at the stops after
    it stopped, and a trip that was reinstated and ran counts nothing extra.
  - This feeds the "Most off-schedule" and "Most reliable" boards, the figures strips, the Routes
    page, and the route page's summary and week table. The Shame boards and stop pages still use
    measured arrivals only, and the cancellation counts themselves are unchanged.
- On a route's trips board, sorting by "Most off", "Latest" or "Earliest" now ranks a cancelled trip
  among the runs by its wait (for example "10m wait"), and a run cut short includes its unserved
  stops at the wait, so it can move up. A cancellation whose wait cannot be worked out stays below
  the ranked runs.

## [1.18.0] - 2026-09-14

### Added

- The site now spots trips that left their route. Every two minutes, each bus and train part way
  through a trip is compared with that trip's road shape, and any position more than 200m off it is
  saved. Most of those are not detours: AT often leaves a vehicle signed onto the trip it just
  finished while it drives to its next run or to a depot. So a trip only counts as off route when at
  least two such positions fall between stops it actually served before and after. Ferries are left
  out.
- The trip page shows a "Went off its route" note saying how far, when, which stop was nearest the
  furthest point, and AT's detour alert if one was active. The off-route positions are drawn on the
  trip map as orange dots joined by a dashed line.
- On a route's trips board, runs that left their route get an OFF ROUTE badge.
- Behind the scenes: the nightly download of AT's route shapes now also stores which shape each trip
  uses.

### Changed

- Behind the scenes: AT's vehicle-position feed is now read once per two-minute run and used both
  for vehicle names and for the off-route check. If the off-route check fails, the run carries on.

## [1.17.0] - 2026-09-14

### Added

- A new Cancellations page (`/cancellations`, in the top menu) for a day, week or month.
  - A figures strip counting every trip AT flagged as cancelled, split into never ran, cut short and
    reinstated (ran anyway), and how many routes had at least one.
  - A "Most cancelled" board of the top 15 routes, linking to the rest on the Routes page.
  - A list of every flagged trip with its route, destination and a badge for what happened. It can
    be filtered by what happened, and each trip links to its own page.
  - The bus, train, ferry and school-bus filters apply to all three.

## [1.16.0] - 2026-09-14

### Added

- A new Routes page (`/routes`, in the top menu) listing every route for a day, week or month, with
  a figures strip covering exactly the routes shown and a link to each route's own page on the same
  day or week.
  - Filters: search, mode, area, running late or early, enough data to rank, had cancellations, and
    school buses.
  - Sorts: route number, on-time %, average off schedule, average delay, late %, early %, arrivals
    and cancellations, either way round.
  - The filters are kept in the page address, so a filtered list can be reloaded or shared as it is.
- Areas: Central, North Shore, West, East, South, Hibiscus Coast & Rodney, and Waiheke & islands.
  AT's data does not say which area a stop is in, so each stop is placed by its map position against
  rough boundaries, checked against stop names across 80 suburbs. A route belongs to each area that
  holds at least two of its stops (or a quarter of them).
- Routes that had cancellations but no recorded arrivals (Te Huia, the Pine Harbour ferry) are still
  listed, without on-time figures, so the page's cancellation total matches the Rankings page.

### Changed

- The full table of all routes moved from the home and Rankings pages to the Routes page; both link
  to it with their filters. The mode, school-bus and late or early buttons now sit on one row above
  the boards.
- On a phone, the header drops the site name beside the logo so the menu fits.

## [1.15.1] - 2026-09-14

### Fixed

- The map on a past day was showing where the route's vehicles are right now. Live vehicles are now
  only shown when you are looking at today (or the last seven days up to today), and on a trip page
  only for a run on today's service day.
- A past day's run on the trips board could be marked LIVE. AT reuses trip ids every day, so the
  same trip id running today made yesterday's run look live. LIVE badges now only appear on today.

## [1.15.0] - 2026-09-14

### Added

- A trip page for a trip AT flagged as cancelled now says so, and what actually happened:
  - "Cancelled" if it recorded no arrivals at all;
  - "Cancelled mid-trip" with its last stop and when the cancellation came, and the stops after that
    marked "Not served";
  - "Cancelled, then reinstated" if it carried on after the cancellation.
- Over four days this split 248 flagged trips into 183 that never ran, 37 cut short and 28
  reinstated. (AT's feed can leave one predicted arrival after a trip actually stopped, so a trip
  needs three or more arrivals after the cancellation to count as carrying on.)
- On a route's trips board, a flagged trip that ran now shows once, as its ranked run with a
  CANCELLED MID-TRIP (CUT SHORT on a phone) or REINSTATED badge. Before, it showed twice: as a run
  and as a separate struck-through CANCELLED row. Cancelled rows link to the trip page, which lists
  the stops the trip would have served.

## [1.14.5] - 2026-09-14

### Fixed

- The line on a trip's map joined its stops with straight lines, cutting across blocks and the
  harbour. It now follows the actual road the trip takes, using AT's route shape. Straight lines are
  only used for a trip AT no longer publishes, or before its shape has been downloaded.

## [1.14.4] - 2026-09-14

### Fixed

- Behind the scenes: the grey placeholder shapes shown while a page loads could come out square when
  they should be round, or the other way round, depending on the order of the page's styles. The
  styles are now merged so the intended shape always wins. The same fix went into a few other places
  that built their styles the same way.

## [1.14.3] - 2026-09-14

### Fixed

- The grey placeholder shown while a page loads was close to the real page but not the same size, so
  content jumped slightly as it arrived (the route header 20px too short, the rank boards 25px
  short, and so on). Every placeholder is now built from shared pieces that match the real page's
  parts exactly: the same padding, gaps and borders, and each grey bar the height of the line of
  text it stands in for. Checked against the loaded pages on desktop and phone. What still differs
  depends on the data, such as how many hours have passed or a long name wrapping.

## [1.14.2] - 2026-09-14

### Fixed

- On a phone, a route page's trips board was wider than the screen (640px in a 368px column), so its
  sort buttons and the ends of its rows ran off the right edge. It now fits, cutting long names
  short instead.

## [1.14.1] - 2026-09-13

### Fixed

- The site had no tab icon, so browsers showed a blank one and every first visit logged a "not
  found" error. It now has a bus icon on AT blue, in the sizes browsers and phones ask for.

## [1.14.0] - 2026-09-13

### Added

- The "Most off-schedule" boards on the home and Rankings pages now show how many of each route's
  trips were cancelled in the same period ("4 cancelled") beside its name. The ranking itself still
  uses measured delay only (see 1.19.0 for when cancellations started counting).

## [1.13.15] - 2026-09-13

### Changed

- Route icons now use each route's own colour exactly as AT publishes it. Before, any colour that
  did not stand out enough against white was swapped for a general colour for that mode, so the East
  West Line's green and the Onehunga West Line's blue both became the same train purple, and the
  ferries and the InnerLink and OuterLink lost their colours too. Routes AT gives no colour for
  still get the general mode colour.

## [1.13.14] - 2026-09-13

### Fixed

- Some pages loaded behind the wrong placeholder. The Shame trip, route and stop pages showed the
  Shame overview's placeholder while loading, and a trip page showed the route page's. Each page now
  has only its own placeholder. No addresses changed.
- Placeholder shapes now match more closely: the route page's includes the direction buttons and a
  trips board as tall as the map, the home and Rankings boards show ten rows like the real ones, and
  the Shame hour boards fit on a phone instead of running off the right edge.

## [1.13.13] - 2026-09-13

### Fixed

- The footer could wrongly say "no update for 11 min, data collection may be stalled" after a quiet
  spell, while new data was in fact arriving every two minutes. It corrected itself a minute later.
  The footer was reading a saved answer that could be shown once more after it expired. It now reads
  a fresh one, so it is never more than 20 seconds behind.

## [1.13.12] - 2026-09-13

### Fixed

- Every sort button, page number, filter button, Day or Week toggle, Shame tab and board row used to
  reload the whole page when clicked, showing the loading placeholder each time. They now update the
  page in place, and the filter buttons keep your scroll position. The long all-routes table no
  longer preloads every row's link.

## [1.13.11] - 2026-09-13

### Fixed

- On a route's trips board, cancelled trips were stuck at the top of page 1 whatever the sort, so
  "Most off", "Latest", "Earliest" and "Departure" all opened on them. A cancelled trip now takes
  its place by departure time when sorting by departure, and sits below every run on the delay
  sorts, since it has no delay to rank. It also follows the direction filter, shows its departure
  time, and is not given a rank number.
- Behind the scenes: each cancellation now records its trip's start time from AT's feed. Older ones
  use the start time that is part of the trip id.

## [1.13.10] - 2026-09-13

### Fixed

- The maps' provider (CARTO) started stamping "API KEY REQUIRED" across every map tile. The site now
  sends its CARTO key with each tile request when one is set, so the maps are clean again.

## [1.13.9] - 2026-09-13

### Changed

- Behind the scenes only: corrected a note in the after-deployment check's setup, which claimed it
  only ran once merged to the main branch. It in fact runs for every test deployment too. The check
  was also renamed so it can be required before merging without clashing with another check. Nothing
  on the site changed.

## [1.13.8] - 2026-09-13

### Changed

- Behind the scenes only: removed the setting added in 1.13.7, which belonged to another project's
  copy of the same check. Nothing on the site changed.

## [1.13.7] - 2026-09-13

### Changed

- Behind the scenes only: the after-deployment check was given an extra setting so the same file
  could be shared with a project that has admin pages. This site has none, so it had no effect
  (removed again in 1.13.8). Nothing on the site changed.

## [1.13.6] - 2026-09-13

### Fixed

- Behind the scenes only: the smoke test ignored part of the test server's output, which could make
  the server freeze if it printed a lot, and hid anything it printed there. All of its output is now
  read and shown. Nothing on the site changed.

## [1.13.5] - 2026-09-13

### Fixed

- Behind the scenes only: several fixes to the smoke test. Nothing on the site changed.
  - A mistyped option now prints one clear message instead of a crash, and a bad address or port
    fails straight away instead of after a 90-second wait.
  - On Windows, the test server was never properly shut down after a run, leaving its port in use.
  - A redirect loop on one file (the web manifest) that only happens on a password-protected test
    deployment is now ignored, and only there.
  - The summary's wording and one empty message were tidied.

## [1.13.4] - 2026-09-13

### Fixed

- A database request that timed out on a slow network link is now retried once, as a dropped
  connection already was. The automated test, which runs on a server far from the database, hit this
  once and showed the error page on Rankings.

## [1.13.3] - 2026-09-13

### Fixed

- Behind the scenes only: fixes to the smoke test when it runs against a test deployment. Nothing on
  the site changed.
  - Every page failed because the hosting company adds a toolbar script to test deployments, which
    the site's security settings rightly block. That one error is now ignored.
  - The password for getting past the test deployment's protection was being sent to other sites,
    such as the map tile server. It is now only sent to the deployment itself.
  - The test was ignoring every "failed to load" error, which hid real network failures. It now only
    ignores ones already reported another way.
  - The "page not found" check now also checks the page really returns a not-found status.
  - A few smaller checks were made stricter, and the setup reports its failures more clearly.

### Changed

- Behind the scenes only: the smoke test reads its local settings file with Node's built-in reader,
  which handles quotes, comments and multi-line values properly.

## [1.13.2] - 2026-09-13

### Fixed

- Behind the scenes only: the after-deployment check reached the new deployment and then, by
  mistake, started building and testing a local copy instead, because it misread how the address was
  passed to it. It now reads the address either way, and refuses an option it does not understand
  instead of quietly doing something else.

## [1.13.1] - 2026-09-13

### Changed

- Behind the scenes only: the after-deployment check can now be started by hand against any
  deployment address, and its log says why it could not reach a deployment (wrong password, missing
  health check, or the wrong version).

## [1.13.0] - 2026-09-13

### Added

- A health check address, `/api/health`, which reports the version of the site that is actually
  running. It never touches the database, so it answers even if the database is down. It is used to
  confirm that a new deployment is live before checking anything else.
- Behind the scenes: an automatic check that runs after every deployment. When the hosting company
  reports a finished deployment, the check waits until the health check reports the expected
  version, then runs the smoke test (see Terms) against that deployment. Test deployments are
  password-protected, so the check is given a special key to get past that, and skips with a message
  if the key has not been set up.

## [1.12.19] - 2026-09-13

### Fixed

- Behind the scenes only: the smoke test was meant to open a train station page but never did,
  because it looked for the station link written one way and the page writes it another. It now
  accepts both. Nothing on the site changed.

### Changed

- Documentation only: the README explains how to run the smoke test against a deployment, and the
  scheduled-jobs guide says which address replaces the two that were removed in 1.12.10.

## [1.12.18] - 2026-09-13

### Changed

- Behind the scenes only: the smoke test now reads the pages it opens, not just checks that they
  load. Nothing on the site changed.
  - It fails if a page shows broken text such as `NaN`, `undefined`, `Invalid Date` or
    `[object Object]`, if a section heading has nothing under it, or if a page ends up at a
    different address from the one asked for.
  - It covers more of the site: a route's week view, the month rankings, the week Shame boards, a
    trip page, a train line and one of its stations, and the "page not found" page.
  - It can be pointed at a site that is already running, so a live deployment can be checked without
    building a local copy.

## [1.12.17] - 2026-09-13

### Added

- Behind the scenes only: automated tests for the parts that had none, including the nightly
  clean-up (which must delete the right days across daylight saving changes, refuse to keep less
  than a week without being forced, and carry on if one part fails), the checks on the address
  options the site accepts, the on-time window for each mode, and the nightly summary job. There are
  now 212 tests. Nothing on the site changed.

## [1.12.16] - 2026-09-13

### Changed

- Behind the scenes only: the one very large file holding every database query (3,640 lines) was
  split into a folder of smaller files, one per subject (rankings, trips, cancellations, stops, and
  so on). The code itself moved unchanged. Nothing on the site changed.

## [1.12.15] - 2026-09-13

### Fixed

- The footer's line saying when the data was last updated could read "update due now" forever. When
  no data run has been recorded yet it now says it is waiting for the first one, and when no run has
  happened for three cycles in a row it says how long ago the last update was and that data
  collection may have stopped.
- The hourly rows on the worst-stops board opened the stop on today, not on the day you were looking
  at. They now keep the day.
- The worst-routes week board showed "undefined/undefined" beside a row with no date; it now shows
  nothing there. The worst-stop card called a stop's arrivals "buses" even at train stations; it now
  says arrivals. The route page now says when its trips board is only showing the first 500 runs of
  the day.
- Accessibility: map movement and button animations are turned off if your device asks for reduced
  motion; the "i" explainer can be closed with Escape and returns you to its button; the flame
  badge's explanation also opens from the keyboard; screen readers no longer read the mode icon
  twice; and a "skip to content" link is the first thing the Tab key reaches.

## [1.12.14] - 2026-09-13

### Added

- When a page fails to load (for example because the database cannot be reached), it now shows a
  proper error page with the normal header and footer, a "try again" button and a link home, instead
  of a blank page. The error is also logged so it can be found and fixed.
- A trip page now has its own browser tab title and link preview text naming the route and the run.

### Fixed

- A trip id that does not exist anywhere used to show an empty page. It now shows "page not found",
  like an unknown route or stop does.

## [1.12.13] - 2026-09-13

### Fixed

- The grey placeholders shown while a page loads now match the pages they stand in for, so the page
  no longer jumps as it arrives. For example, the home page's placeholder showed four separate
  figure boxes where the page has one strip of five, and the Shame overview's was missing the board
  under its cards.

## [1.12.12] - 2026-09-13

### Fixed

- Delays are now described using the route's own on-time window everywhere. Seven places showed the
  raw difference instead, so a bus 4 seconds behind read "+4s late" under a caption saying up to 5
  minutes late counts as on time. The home and Rankings boards, the Routes table, the route page's
  trips board, the line diagram, and the map's stop and vehicle popups now say "on time" inside the
  window, as the Shame boards already did.
- A delay that could not be worked out (for example an average of nothing) showed as "NaNs late". It
  now shows a dash, as the tables already did for unknown values.

## [1.12.11] - 2026-09-13

### Fixed

- Boards and cards with nothing to show now say so, instead of vanishing or leaving a gap.
  - The routes table on a day with no data said `No routes match ""`, as if a search had failed. It
    now tells an empty day apart from a search with no results.
  - The worst-route and worst-stop cards disappeared when nothing qualified, leaving a hole in the
    layout. They now stay and say "Nothing to rank yet".
  - A route with no arrivals lost its map, line diagram and stops table entirely. Each now keeps its
    heading and says what it is waiting for.
  - The "page not found" page says when its list of routes cannot be loaded, and the Rankings page
    only mentions the up and down arrows when there is a previous period to compare with.

## [1.12.10] - 2026-09-13

### Fixed

- Behind the scenes: the site's data addresses (API) now treat an empty option such as `?limit=` as
  "use the default" instead of rejecting the request, and an error reply no longer echoes back
  everything that was sent. Error logs were made consistent.
- A stop's timetable was fetched from AT far too often between midnight and 5am. The rule for how
  long to keep a saved copy compared New Zealand's day with the UTC day, which differ in those
  hours, so every morning the day just ended was re-fetched twelve times an hour.
- After the nightly clean-up deleted the oldest day, the day stepper could still offer that day for
  most of the morning, because the site's note of its earliest day was only refreshed every six
  hours. It now refreshes every ten minutes.
- The route map asked for vehicle positions every minute, but the server only refreshes them every
  two minutes, so half the requests got the same answer. It now asks every two minutes.

### Removed

- Two data-loading addresses that each did half of the nightly timetable download and were never
  scheduled. The single sync address does both.

## [1.12.9] - 2026-09-13

### Fixed

- The nightly aggregate (see Terms) now catches up on days it missed. If the scheduled job did not
  run one night, that day used to be left without a summary for good, leaving a hole in the
  rankings. Each run now also finishes any of the two days before that were missed, oldest first. If
  the ghost-run check fails for a day, that day is left unsummarised and retried the next night,
  instead of being saved with the false readings still in it.
- Behind the scenes: when saving new arrivals, a write that partly failed could go unnoticed, and a
  dropped connection was not retried. Both are now retried and checked properly.

## [1.12.8] - 2026-09-13

### Removed

- Behind the scenes only: removed code that nothing used, including two unused queries, an unused
  component, and the median and 95th-percentile delay figures the nightly job worked out but the
  site never showed. Dropping those also removed the only reason the database needed a newer
  version. Nothing on the site changed.

## [1.12.7] - 2026-09-13

### Added

- Behind the scenes only: the automated checks run on every proposed change now include the smoke
  test, which builds the site and opens every public page in a real browser against the real
  database. A change that breaks a page is caught before it is merged. Nothing on the site changed.

## [1.12.6] - 2026-09-13

### Changed

- Behind the scenes only: the comment at the top of 95 files was changed to a simpler style, and the
  pre-commit check was fixed so it works when a change touches that many files at once (it was
  hitting Windows' limit on command length). No code changed.

## [1.12.5] - 2026-09-12

### Changed

- Behind the scenes only: the name of Auckland's time zone, which was typed out in 27 places, is now
  written once and shared, and a rule stops it being typed out again. Doing date sums by hand in
  many places is how daylight saving bugs get in. Nothing on the site changed.

## [1.12.4] - 2026-09-12

### Fixed

- A run's number of stops meant different things on different pages. The route page counted ghost
  readings (see Terms) and could count one stop twice, while the Shame boards counted only real
  readings, so the same run could show different "N stops". Every board now counts each stop with a
  real reading once. The trips board could also name the wrong vehicle for a run with ghost
  readings; it now takes the vehicle from the first real reading.
- A route's list of cancelled trips only worked when looking at exactly one day. It now works for
  any period.
- Behind the scenes: the data address for top routes started a week at midnight UTC, which is 12 or
  13 hours late for New Zealand. It now starts at midnight in Auckland like the rest of the site.
- If AT's timetable service was down when a trip page was first opened, the empty result was saved
  for a whole day, so the page showed no upcoming stops until the next day. A failure is now not
  saved, and the next visit tries again.

## [1.12.3] - 2026-09-12

### Fixed

- Behind the scenes: the nightly ghost-run check used to clear every flag for the day and then set
  them again. In between, and if it failed part way, the day showed false readings as real ones. It
  now updates each run's flags in one step, so a day is never half checked, and a failed write stops
  the check instead of being ignored. It was also changed to fetch much less data from the database,
  so a busy day cannot exceed the database's reply size limit.

### Added

- Behind the scenes only: tests for the nightly ghost-run check, including one that runs it on a
  scratch copy of the database.

## [1.12.2] - 2026-09-12

### Fixed

- Before a day has been checked for ghost runs (see Terms), the site hides any reading more than
  three hours off schedule, as a stand-in. That rule was also being applied to days that had already
  been checked, so a run that really was more than three hours late was hidden, which is exactly the
  kind of run this site exists to show. The three-hour rule now only applies to days that have not
  been checked yet (today, and a finished day whose nightly job has not run).

## [1.12.1] - 2026-09-12

### Fixed

- A finished day's figures could be saved before that day's false readings had been removed. Saved
  results for a finished day are kept for a week, and that started as soon as the day ended, about
  20 hours before the nightly job removes ghost readings (see Terms). So whoever first opened
  yesterday's boards fixed the uncorrected figures in place for a week. A day's figures are now only
  kept long once the nightly job has run for it; before that they are refreshed every few minutes.

## [1.12.0] - 2026-09-12

### Added

- Rankings now cover every day in the period, including today. The week and month boards use the
  nightly summaries for finished days and work out the rest (today, and any day the nightly job has
  not reached yet) from the raw arrivals, then combine the two. Before, as soon as any summary
  existed, days without one were left out: on 12 September the week view showed ten routes based on
  a sliver of 10 September and none of the 240,000 arrivals recorded since.
- A route's week view fills in the same way, so today appears in its table as it happens. When the
  week has no arrivals, the table says so instead of showing a heading over zeros and dashes.

### Fixed

- Today's boards were counting AT's predictions for stops the vehicle had not reached yet. The site
  stores a predicted arrival for every remaining stop of a running trip and updates it every two
  minutes, so today's figures mixed guesses with real arrivals. Today's figures now stop at the
  present moment. The trip page still shows a run's upcoming stops.

## [1.11.8] - 2026-09-12

### Changed

- Behind the scenes only: updated Next.js and several development tools. Three major updates were
  tried and held back because they do not work with this project: Prisma 7 (no MongoDB support),
  TypeScript 7 (the code-style checker refuses to run on it) and ESLint 10 (a plugin it needs only
  supports ESLint 9). Nothing on the site changed.

## [1.11.7] - 2026-09-12

### Fixed

- On the days daylight saving starts or ends, the week Shame boards and the route streaks could file
  the first hour of a service day under the wrong date. They worked out the day by taking five hours
  off the time, which crosses the clock change: on 27 September 2026 the week board would have shown
  two rows labelled 26 September. They now use the same rule as the rest of the site, based on the
  Auckland clock.
- Behind the scenes: two maintenance scripts had the same kind of date bug (one labelled every day
  one day early). Both are fixed.

### Added

- Behind the scenes only: a new kind of test that runs against the real database, the first of which
  checks that the database and the site agree on which service day a time belongs to, at fifteen
  times around both daylight saving changes.

## [1.11.6] - 2026-09-12

### Added

- Behind the scenes only: tests that check the new City Rail Link station names (Te Waihorotiu,
  Waitemata) are handled correctly, so platforms join their station and a bus stop with a similar
  name stays separate. Added before the 13 September opening put real arrivals through them.

## [1.11.5] - 2026-09-12

### Fixed

- The old train lines (Southern, Eastern, Western, Onehunga) were already forwarding to their City
  Rail Link replacements three days before the new lines ran, because AT published the new lines
  early. Visitors landed on lines with nothing to show. An old line's page now only forwards once
  its replacement has recorded an arrival in the last seven days.
- The route list showed a new line beside the line it replaces. It now shows only one: the old line
  until the new one is running, then the new one.
- The rankings could list one line twice in a week where its id changed, either because AT
  republished its timetable (for example `501-217` and `501-218`) or because of the City Rail Link
  switch. Such rows are now merged into one per line, under the newer name and colour.

## [1.11.4] - 2026-09-12

### Fixed

- On the days daylight saving starts or ends, local midnight was worked out an hour wrong, so ranges
  starting on those days ended at the wrong time. 27 September 2026 now correctly runs 23 hours and
  5 April 2026 25 hours. Only a period starting on the change-over Sunday itself was affected.
- The Rankings page's comparison with the previous week stepped back exactly seven days of hours,
  which is an hour out across a daylight saving change. It now steps back seven calendar days.

## [1.11.3] - 2026-09-12

### Fixed

- Behind the scenes: a calculation on the Rankings page divided by a stored count with no check for
  zero. A zero cannot be stored today, but if one ever were, the whole Rankings page would fail. It
  is now guarded.

## [1.11.2] - 2026-09-12

### Fixed

- The list of all routes stopped working. When the nightly download saved the date each route was
  last seen, it stored it as text instead of as a date, so reading it back failed. The list's data
  address returned an error and the "page not found" page lost its route list. The date is now saved
  correctly, and a script converted the ones already stored.
- The route list no longer shows routes AT has stopped publishing. It had been showing nine old
  versions of routes beside their replacements, and six routes that no longer run.

## [1.11.1] - 2026-09-12

### Changed

- Behind the scenes only: turned on a stricter code check that treats every lookup in a list as
  possibly missing, and handled each of the 198 places it flagged. Also removed some duplicated date
  code and old settings. Nothing on the site changed.

## [1.11.0] - 2026-09-11

### Added

- Ghost runs (see Terms) are now removed from the figures. AT sometimes reports a vehicle under
  another trip's id, so it appears to be about an hour off at every stop, and a few of those could
  put a quiet stop at the top of the worst-stops board. A nightly check looks at the shape of each
  run's delays rather than their size: a ghost is off by nearly the same amount at every stop, while
  a real delay builds up along the trip. (A simple cap on size would also throw away genuinely awful
  delays, which is what this site exists to show.) Readings are flagged, never deleted, and
  re-checking a day gives the same result.
- A board of cancelled trips. A cancelled trip records no arrivals, so it can never show up as late
  and cannot drag a route's on-time share down; if anything, cancelling late runs makes a route look
  better. This board is where that shows.
- Route colours are checked for readability. AT's colours are designed for its own maps: the Eastern
  Line's yellow is far too pale against the page, and Te Huia's is pure black. Colours that are too
  faint are replaced. (Undone in 1.13.15.)
- Behind the scenes: each route now records when AT last published it, so the route list can show
  only routes that currently run. Old routes are never deleted, so their history and links keep
  working.

### Changed

- A station is now identified by AT's own station id instead of its name. AT renames stations
  (Britomart became Waitemata, Mount Eden became Maungawhau, with more coming from the City Rail
  Link), and using the name split a station's history in two and broke shared links.
- Service alerts are now graded by how serious they are. Only alerts that stop a service get the
  loud styling, so routine notices no longer look like line closures.
- The loading placeholders stop pulsing if your device asks for reduced motion.
- The README now describes this project.

## [1.10.1] - 2026-09-11

### Fixed

- Behind the scenes: the self-hosted database had been unable to build its search indexes since 8
  July. A change in how its security certificate was renewed meant the database refused connections
  from itself, which index building needs. Reading and writing still worked, which is why nothing
  looked wrong. It now uses a separate certificate for those internal connections, so a renewal
  cannot break it again.
- Behind the scenes: two project commands (the smoke test and the bundle size report) only worked on
  one machine because a package they needed was not listed. Both are fixed.
- Documentation: the database restore guide wrongly said a restore always rebuilds every index. It
  does not if interrupted, so the checklist now starts by checking the indexes.

### Changed

- Behind the scenes only: updated 17 packages, holding back five major updates that would not work
  yet (Prisma 7 has no MongoDB support, among others). Automatic dependency updates are now built
  and tested before being merged, and major updates wait for a person. Stricter code settings were
  turned on and some unused ones removed.

## [1.10.0] - 2026-08-07

### Added

- Train lines now show their real names. AT gives every train route only a code as its name, so a
  route page's header read just "STH". It now reads "Southern Line" beside the code. This also
  covers the new City Rail Link lines that replace them on 13 September 2026 ("S-C" is the South
  City Line, "E-W" the East West Line, "O-W" the Onehunga West Line) and Te Huia.
- A line's history carries over when the City Rail Link renames it. On 13 September the Southern,
  Eastern, Western and Onehunga lines are retired and replaced by three new lines (Eastern and
  Western merge into one). Without this, the old lines' history would be stranded and the new lines
  would start from zero. A line's figures now include the lines it replaced, and an old line's page
  forwards to its replacement once the replacement appears in AT's data.

### Fixed

- The home page's headline count was labelled "Trips" but actually counts arrivals. One trip makes
  one arrival per stop, so the number was 20 to 40 times the real number of trips, and contradicted
  the explainer right under it. It now says "Arrivals".
- Behind the scenes: the nightly timetable download never worked out which version of AT's timetable
  was current, because it read a field AT does not send. So it never noticed a new timetable. It now
  reads the right field and picks the version covering today. This is what brings in the renamed
  lines at the City Rail Link switch.
- Behind the scenes: the timetable download no longer stores AT's 140 or so "parent station"
  entries. Nothing departs from them (only from their platforms), so they could never have arrivals,
  and they cluttered the stop list with duplicate names.

### Changed

- Behind the scenes: each stop now remembers which station it belongs to and its platform number, so
  platforms can be grouped by AT's own station ids rather than by name, since AT renames stations
  (Britomart became Waitemata, Mount Eden became Maungawhau).

## [1.9.5] - 2026-07-23

### Fixed

- Behind the scenes: a service alert whose id arrived in an unexpected form could be saved with the
  id "[object Object]". It now falls back to an empty id instead. Also simplified three scheduled
  jobs. Nothing on the site changed.

## [1.9.4] - 2026-07-23

### Changed

- Behind the scenes only: removed some unnecessary type overrides that the new code checks showed
  were not needed, and fixed the one place where removing one uncovered a real type mistake. Nothing
  on the site changed.

## [1.9.3] - 2026-07-23

### Changed

- Behind the scenes only: stricter code-style and correctness checks, automatic sorting of style
  classes, tighter checks before each commit and upload, and updated Next.js, React and other
  packages. Nothing on the site changed.

## [1.9.2] - 2026-07-09

### Fixed

- Documentation only: the database setup guide pointed at an old example storage size. It now points
  to the section on how long data is kept.

## [1.9.1] - 2026-07-09

### Changed

- The site now keeps ten years of data instead of a short rolling window, since the database moved
  to a home server with plenty of room (see 1.8.0). The setup guide now covers how much space that
  needs (about 23GB a year, about 230GB after ten years), memory settings, and a backup plan using
  disk snapshots once nightly copies become too big.

## [1.9.0] - 2026-07-09

### Added

- Behind the scenes: a public address, `/api/freshness`, that reports when the data was last updated
  and when the next update is due. The footer uses it (below).

### Fixed

- The footer's "last updated" line turned red ("update due now") on any tab left open for more than
  two minutes, because the times were only fetched when the page first loaded. An open tab now
  checks again every minute (not while hidden, and straight away when you come back to it).

## [1.8.1] - 2026-07-09

### Fixed

- Documentation only: corrected the home-server database setup guide after doing the real install.
  Several steps did not work as written, and each is now replaced with what actually works.

## [1.8.0] - 2026-07-08

### Added

- The database can now run on a home server (a TrueNAS box) instead of the paid-tier-limited MongoDB
  Atlas cloud service, costing nothing a month and leaving room to keep far more history. A full
  setup guide covers installing it, renewing its security certificate, backups, moving the data
  across from Atlas with the scheduled jobs paused, and how to switch back. No code changes were
  needed; the site just points at a different database address.

### Changed

- Behind the scenes only: a few code comments and the scheduled-jobs guide no longer assume the
  database is on Atlas.

## [1.7.8] - 2026-07-08

### Fixed

- Behind the scenes: removed a database index (64.6MB at the time) that another, larger index
  already covered, freeing space on the storage-limited free database.
- The nightly clean-up's storage warning now reports the database's real size on disk. It had been
  estimating, and was overstating the usage about two times.

## [1.7.7] - 2026-07-08

### Fixed

- The site's server now runs in Sydney, next to the database, instead of the default in the eastern
  US. Every database request had been making a round trip across the Pacific (about 210ms), and a
  page can need several in a row. New Zealand visitors also reach Sydney faster.

## [1.7.6] - 2026-07-08

### Fixed

- Pages could take 17 to 27 seconds to load. Finding the earliest and latest days with data read
  through every stored arrival (3.2 million at the time), taking about 17 seconds each, and the
  earliest day is needed on every page. It now reads just the first and last arrival directly, which
  takes 30 to 200 milliseconds.

## [1.7.5] - 2026-07-08

### Fixed

- The slow scheduled jobs (timetable download, route shapes, nightly summary, clean-up) now reply
  "accepted" straight away and do their work afterwards. The scheduling service gives up after 30
  seconds, so a 40-second clean-up was reported as failed even though it finished. Each job's result
  is now recorded in the site's own run log instead.

## [1.7.4] - 2026-07-08

### Fixed

- Behind the scenes: the script that removes duplicate arrivals can now check only recent hours, so
  it can finish between two data runs (every two minutes) while the duplicate guard is being
  rebuilt.

## [1.7.3] - 2026-07-08

### Fixed

- Behind the scenes: every test deployment, including ones built from old branches, was updating the
  live database's structure to match its own copy. A test build of an old branch removed the guard
  against duplicate arrivals, and duplicates piled up. Only the real (production) build changes the
  database structure now.

## [1.7.2] - 2026-07-07

### Fixed

- The Shame week boards showed eight days ("Monday to Monday"). They now show seven, and the last
  seven days no longer gain or lose a day across a daylight saving change.
- The weekday names on the week boards were one day ahead of the dates beside them.
- The hourly Shame boards went nearly empty between midnight and 5am. The filter meant to hide hours
  that had not happened yet was hiding the whole daytime instead.
- Route service alerts never matched their routes, because AT adds a version to the route id in its
  alerts ("NX1-202409"). That is now removed before comparing, so the route alert banner, the dashed
  detour line and the disrupted-stop rings work again.
- A trip page with a malformed date in its address crashed with a server error. An impossible date
  such as 31 February no longer quietly turns into a different day, and a stray `%` in a stop
  address no longer crashes the page.
- On the worst-route week board, clicking a row opened the last seven days instead of the week being
  viewed.
- Routes with no delay data showed "on time" instead of a dash in the tables and boards.
- Streak counts treated days with no data as part of a streak, and skipped a day across the spring
  daylight saving change.
- The nightly summary silently dropped arrivals on routes not yet in AT's downloaded timetable.
- The same stop visit was stored several times as AT revised its prediction (about 5% of all
  arrivals were duplicates). Each stop visit is now stored once and updated, and the existing
  duplicates were removed.
- A maintenance script assumed New Zealand was always 12 hours ahead of UTC, which is wrong during
  daylight saving.

### Security

- Removed two data addresses that let anyone write to the database without logging in.

### Added

- A month view for the three Shame boards, with buttons to step between months. The Rankings page's
  month cards now open it, and Rankings gained previous and next month buttons.
- A nightly job that works out yesterday's boards in advance, so the first visitor does not wait.

### Performance

- Figures for finished days are now saved for a week (they never change), so week and month views
  are fast after the first time they are opened.
- The Shame boards, Rankings, home page cards and stop departures now show the page heading straight
  away and fill in the figures as they are ready, instead of the whole page waiting.
- A couple of lookups now run at the same time instead of one after the other.

## [1.0.0] - 2026-06-25

### New pages

- `/shame`: the worst trip and worst stops of the chosen day, week or month, with buttons to step
  between weeks or months and a link straight to the worst trip's stop-by-stop page.
- `/shame/stop`: ranks stops by how many arrivals were off schedule in the chosen period, with a
  worst-stop card and a link to each stop's page.
- `/stop/[id]`: a page for each stop showing today's timetabled arrivals, live delay badges, and
  links to each trip's stop-by-stop page.
- A proper "page not found" page.

### Route page

- A two-week calendar of each day's on-time share and number of arrivals, with previous and next
  week buttons. The back button disappears at the earliest day with data.
- Week and month views: the route page can show a whole week or month, with its figures and its
  worst trips over that period.
- Direction buttons to switch the line diagram between the two directions.

### Rankings and shame links

- Links from the Rankings page to routes, Shame boards and worst stops now keep the week or month
  you were looking at.
- The Shame card's wording follows the period: "Shame of the week", "No shame this month", and so
  on, instead of always saying "day".

### Alerts and data freshness

- An alert banner showing AT's current service disruptions on the home page and on the affected
  routes' pages. Each alert can be dismissed for the rest of your visit.
- A line on the home page saying when data was last collected and how many new arrivals it added.

### Ingest and data fixes

- The nightly summary was silently stopping after 101 routes, because of a default limit on how many
  results the database returns in one go. It now gets every route. Rebuilding the past summaries
  took each day from about 101 routes to between 460 and 512.
- Behind the scenes: the clean-up job can now also delete old daily summaries.

### Maintenance

- Behind the scenes only: removed one-off investigation scripts, keeping the five still in use.

## [0.21.0] - 2026-06-19

- Restyled the site to feel like Auckland Transport's own: a solid blue header bar with the white AT
  logo and menu, a dark footer with links and a note that this is an independent project, matching
  pill-shaped buttons for every filter and control, and a thin border around every card.

## [0.20.1] - 2026-06-19

- The route page's trips board heading now matches the mode: "Ferries of the day" or "Trains of the
  day" instead of always "Buses of the day".

## [0.20.0] - 2026-06-19

- The route page's trips board can now be sorted by most off schedule (the default), latest,
  earliest or departure time, and keeps the chosen day when you sort.

## [0.19.1] - 2026-06-19

- Choosing the Ferry filter now shows ferries. The boards only listed routes with at least 10
  arrivals, which a ferry rarely reaches in a day, so the Ferry filter came up empty. When a single
  mode is chosen, the minimum is now lower.

## [0.19.0] - 2026-06-19

- The route map now follows the actual roads, using AT's route shapes (see 0.18.0) instead of
  straight lines between stops. The two directions are drawn as two lines side by side so each can
  be seen. Routes without a stored shape still use straight lines.

## [0.18.0] - 2026-06-18

- Behind the scenes: a new job downloads AT's full timetable package, takes the shape of every route
  from it, simplifies each one and stores it. This is what lets the route map follow the roads
  (0.19.0). Documented as a weekly scheduled job.

## [0.17.0] - 2026-06-18

- Polished the line diagram:
  - every direction is drawn at the same scale, filling the card, with dots and labels the same
    size;
  - a line only splits for a real difference in route, not a one- or two-stop offshoot;
  - delay labels are no longer cut off at the edge;
  - variants that start somewhere else are shown as their own labelled lines instead of being left
    out;
  - stops the route has not served in the past week are hidden, and stops served recently but not
    today show as plain dots;
  - hovering over or tabbing to a stop shows its name and delay.

## [0.16.0] - 2026-06-18

- Redrew the route line diagram in the style of AT's train map: one bold line per direction that
  wraps onto new rows to stay on screen, with variants that end elsewhere branching off at 45
  degrees, and each stop a white circle ringed in the colour of its average delay (end stops drawn
  larger).
- Days are now service days (5am to 5am the next day) instead of calendar days, so a route's runs
  after midnight count under the day they started. The trip page and the "most recent day with data"
  fallback use this too.
- The home and route pages now show the actual date with previous and next day arrows (in the page
  address as `?day=`) instead of just saying "today", so you can step back to earlier days.

## [0.15.1] - 2026-06-18

- A trip page mixed up several days. AT uses the same trip id every day a trip runs, so the page
  showed every day's run at once, with stops out of order and repeated. It now shows one day's run
  (the day you came from, or the trip's most recent day), and a stop with two recorded arrivals
  shows once.

## [0.15.0] - 2026-06-18

- Live vehicles on the route map now look like AT's own markers: a bus, train or ferry icon on a
  white disc, ringed in the colour of how late it is, with a matching arrow on the ring pointing the
  way it is heading. Stops are the only dots with a black outline.

## [0.14.0] - 2026-06-18

- The separate "Running latest" and "Running earliest" boards on the home and Rankings pages became
  one "Most off-schedule" board, ranked by how far off schedule each route ran either way, with All,
  Late and Early buttons that work together with the mode and school-bus filters.
- The school-bus filter was hiding almost no school buses. It looked for the school code (such as
  `S046`) in the route's short name, but the code is in the long name, and can end in a letter (such
  as `S046D`). It now checks both names, so school buses are hidden by default as intended.

## [0.13.0] - 2026-06-18

- Refreshed the look and layout while keeping AT's style: a real top menu (Today and Rankings), a
  train-line-coloured stripe under the header and on each page heading, a slim footer naming where
  the data comes from, and a home page headline that names the day.

## [0.12.0] - 2026-06-18

- Added a line diagram under the route map, like a train map: each direction's stops in order,
  branching where some runs end early or take a different way, with each stop coloured by its
  average delay. The stop order comes from AT's timetable.

## [0.11.0] - 2026-06-18

- Added a page for each trip (`/route/[id]/trip/[tripId]`) showing one run's timetabled time at each
  stop and how early or late it was there, opened from the worst-buses list.

## [0.10.0] - 2026-06-18

- Rebuilt the route page around a "worst buses of the day" list: every run of the route, ranked by
  how far off schedule it ran on average, with its start time, vehicle and number of stops, each
  linking to that run's stop-by-stop page. Like the home page, it shows today, or the most recent
  day with data.
- The route map became a real route map: the route is drawn between its stops in order, stops are
  outlined so they stand out, and live buses are arrows pointing the way they are going. The route
  is drawn with straight lines between stops, because AT's live data gives the stop order but not
  the roads.

## [0.9.0] - 2026-06-18

- School bus routes (short names like `S123`) are now hidden from the home and Rankings lists by
  default, with a "School buses" button to show them. It works together with the mode filter and the
  table sort.

## [0.8.3] - 2026-06-17

- Fixed the route map showing grey instead of a map. The site's security settings only allowed map
  tiles from the old map provider, so the new one (0.8.1) was blocked.

## [0.8.2] - 2026-06-17

- Late and early buses on the route map are now labelled directly (for example `4m late`), so you
  can see which are running late without clicking. On-time buses stay unlabelled to keep the map
  readable.

## [0.8.1] - 2026-06-17

- Changed the route map's background map from OpenStreetMap's volunteer servers, which refuse to
  serve apps like this one, to CARTO's light map, which allows it and suits AT's light colours.

## [0.8.0] - 2026-06-17

- Added Bus, Train and Ferry filter buttons on the home and Rankings pages, which narrow the route
  lists to one mode. The network-wide figures stay network-wide.
- Weeks now start on Sunday, and the Rankings week is labelled "Week of" its first date.
- The lists show one name per route (the short name, or the long name if there is no short one),
  since for buses the two are usually the same.

## [0.7.3] - 2026-06-17

- Several lists were silently cut off at 101 results, because of a default limit on how many results
  the database returns in one go. The rankings only showed about 101 routes (leaving out whole
  modes, such as trains), and route pages showed at most 101 stops. Every query now gets its full
  results.

## [0.7.2] - 2026-06-17

- The route map now refreshes live vehicle positions once a minute (and not while the tab is
  hidden), and the server shares one answer per minute between all visitors. This keeps the site
  well inside AT's limit of 35,000 requests a week however many people are looking.

## [0.7.1] - 2026-06-17

- Behind the scenes: new arrivals are now saved in one batch per group instead of one at a time,
  with already-seen ones skipped. The two-minute data collection had been timing out on the hosting
  service.

## [0.7.0] - 2026-06-17

- The route page's map now shows the route's live buses, from AT's live vehicle-position feed,
  refreshed every 20 seconds and coloured by how late, early or on time each one is.
- Delays on the route page are shown in minutes and seconds, like the rest of the site.
- Fixed the map sometimes drawing incorrectly by always loading its styles.

## [0.6.4] - 2026-06-17

- Behind the scenes: the timetable download now saves stops and routes in batches instead of about
  7,500 separate saves, so it finishes in seconds instead of timing out on the hosting service.

## [0.6.3] - 2026-06-17

- Renamed the project to `at-route-performance` and started this changelog.

## [0.6.2] - 2026-06-17

- Behind the scenes only: added a script to wipe the database, and kept experimental scripts out of
  the project.

## [0.6.1] - 2026-06-17

- Fixed a security hole: stop names from AT's data were inserted into the map's popups as raw HTML,
  so a stop name containing code could have run it in visitors' browsers. Popups now treat names as
  plain text.

## [0.6.0] - 2026-06-17

Moved the database from a SQL database to MongoDB, in these steps:

- Switched the database connection to MongoDB and removed the SQL set-up files.
- Updated the build and code-checking tools, and added checks that run before each commit.
- Added the code that reads AT's timetable and live feeds and the code that reads the database.
- Added the AT-styled page layout, fonts and shared pieces.
- Added the data addresses (API) and the jobs that collect data.
- Added the route page with a map of its stops.
- Added AT's fonts and logos and reference documents.
- Added automated checks, dependency update settings and a new README.

## [0.5.2] - 2026-06-16

- Moved the scheduled data collection from the hosting company's built-in scheduler to an outside
  one (cron-job.org), because the free hosting plan only allows a few scheduled jobs. The setup is
  documented.

## [0.5.1] - 2026-06-16

- Behind the scenes only: removed an unused helper, and fixed a package version clash that stopped
  the project installing.

## [0.5.0] - 2026-06-16

- Added the pieces the dashboard is built from (boards, network figures, a per-mode breakdown and a
  table of routes).
- Rebuilt the home page as a dashboard of today's network performance.
- Added a Rankings page for the week and month.

## [0.4.0] - 2026-06-16

Groundwork for the performance dashboard (behind the scenes):

- Added automated testing.
- Added a helper that writes delays as "4m 10s late" or "1m early".
- Added helpers for Auckland days, weeks and months that handle daylight saving.
- Added the ranking logic (earliest, latest and most reliable routes, only counting routes with
  enough arrivals to judge).
- Added the database queries for rankings, network figures and the per-mode breakdown.

## [0.3.1] - 2026-02-17

- Fixed security vulnerabilities in the React server components library, and updated other packages.

## [0.3.0] - 2025-08-29

- Behind the scenes: reworked the database layout and the data addresses to process arrivals better,
  and added a table for each trip's delay. Updated packages.

## [0.2.1] - 2025-08-13

- Fixed a check that treated a missing delay wrongly, and improved how dates are worked out.
- Behind the scenes: tidied some code and added checks that run before each commit.

## [0.2.0] - 2025-08-13

- Fresh start: rebuilt the project as a single Next.js app instead of a separate server and website.

## [0.1.1] - 2025-07-22

- Behind the scenes only: updated the packages used by the original server and website (React 19,
  the map library, Next.js, and others).

## [0.1.0] - 2025-04-23

- First version: a basic server and a website with a map, plus automatic dependency updates and a
  README.
