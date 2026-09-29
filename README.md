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
  approximate boundaries in [`src/lib/areas.ts`](src/lib/areas.ts).
- **Fare zones** come from AT's fare zone shapefile, tested against each stop's position, so a stop
  on an overlap is in both zones. AT's feeds carry no zone for a stop (see below).
- **Detours** come from GPS, not alerts. Each ingest poll measures every bus and train part-way
  through a trip against that trip's road shape, and a trip counts as having left its route when two
  readings more than 200 m off it fall between arrivals it recorded before and after (see
  [`src/lib/off-route.ts`](src/lib/off-route.ts)). AT's detour alert is shown alongside when one was
  active. Ferries are left out, since a sailing's shape is a rough line between wharves.
- **Ghost readings** are excluded. AT reuses a `trip_id` against a later vehicle block, so one run
  can report a near-constant hour-off offset at every stop. A nightly pass classifies those by shape
  rather than by size, so genuinely catastrophic delays survive into the stats (see
  [`src/lib/deviation.ts`](src/lib/deviation.ts)).

## Issues with the AT API

- The GTFS zip just doesn't have school buses. All 317 school routes are missing, even though the
  API has them, so they have to be pulled one route at a time.
- There are no fare zones anywhere in the data. `zone_id` is blank on every stop, the fare files are
  empty, and the API has no field for it. The only source is a shapefile, and it doesn't even match
  AT's own list of boundary stops (8503 had to be fixed by hand).
- Trip ids get reused every day, and the realtime feed sometimes puts one on a later bus, so a trip
  shows up an hour off at every stop.
- Stations get renamed out from under you (Britomart is "Waitemata Train Station" now, Mount Eden is
  Maungawhau), so anything keyed by name breaks.
- The same stop can exist twice under different names. 8503 is both "Stop A Maungawhau Station" and
  "Akiraho Street".
- One interchange is two or three separate stations. Manukau has three.
- The CRL retired four train line ids in one go.
- A day older than the ~4 months of timetable AT keeps just 404s, which looks exactly like "nothing
  runs here".
- There's no endpoint for all trips (`/trips` 404s) and no route shapes, so everything is one call
  per route or per variant.
- Finished trips hang around in the realtime feed pointing at their last stop while the bus drives
  off to its next run.
- Skipped stops show up hours before the trip even starts, with no time on them.
- Most alerts aren't even running yet (143 of 189 when I checked), and recurring ones list a period
  from weeks ago first.
- Go a bit too fast and you get rate limited.
- Parent stations are mixed into the stop list with the stops you can actually board at.
- Parked buses say they're heading due north (heading 0).
- Train fleet labels come padded with spaces (`AMP        1020`).

## City Rail Link

AT renames the train lines when the CRL opens on **13 September 2026**: `STH` becomes `S-C`, `ONE`
becomes `O-W`, and `EAST` and `WEST` merge into `E-W`. Route reads aggregate each new line together
with the lines it replaced, so the archive survives the rename, and retired slugs redirect to their
successor - see [`src/lib/route-lineage.ts`](src/lib/route-lineage.ts). AT publishes the new ids as
`S-C-201`, `E-W-201` and `O-W-201`, and they land in static GTFS days before the first train, so a
retired slug redirects (and the directory swaps the old line for the new) only once the successor
has recorded an arrival.
