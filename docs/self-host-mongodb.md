# Self-hosted MongoDB (TrueNAS SCALE)

The database runs as a MongoDB 8 app on a TrueNAS SCALE box instead of MongoDB Atlas. The
application code is unchanged - Prisma and every `$runCommandRaw` aggregation work as before; only
`DATABASE_URL` points somewhere new. This file is the setup runbook plus the operational procedures
(cert renewal, backups, restore, rollback).

Two hard requirements drive the setup:

- **Prisma requires a replica set.** A single-node replica set (`--replSet rs0` + `rs.initiate`)
  satisfies it; no second node is needed.
- **The port is open to the internet** (Vercel has no static egress IPs to allowlist), so TLS and
  SCRAM auth are mandatory, never optional.

## Prerequisites

1. **AVX CPU check (hard blocker):** in a TrueNAS shell run `grep -o avx /proc/cpuinfo | head -1`.
   MongoDB 5.0+ refuses to start without AVX, and `$percentile` (used by the aggregate endpoint)
   needs 7.0+, so there is no older-version fallback.
2. A public DNS name for the box (e.g. `db.example.nz`) and a router forward of TCP `27019` to the
   NAS. A non-default port avoids drive-by scans of 27017.
3. A TLS certificate issued **before** first start (`requireTLS` needs the PEM at boot). Use the
   TrueNAS built-in ACME support (Credentials > Certificates > ACME) with a DNS-01 challenge - it
   works behind NAT. Naming trap: for a CSR named `mongo`, the issued files are
   `/etc/certificates/mongo-acme.crt` and `mongo-acme.key` - the plain `mongo.key` is the CSR's key,
   not the issued cert's.
4. Raise `vm.max_map_count` or mongod warns at startup: `sysctl -w vm.max_map_count=262144` now, and
   persist it via System Settings > Advanced > Sysctl (`vm.max_map_count` = `262144`).

## Datasets

```
zfs create media/apps
zfs create -o recordsize=64K -o compression=lz4 -o atime=off media/apps/mongodb-data
zfs create media/apps/mongodb-config
zfs create media/apps/mongodb-backups
```

`recordsize=64K` sits closer to WiredTiger's leaf-page writes than the 128K default; lz4 is free.
The mongo image runs as uid 999, so `chown -R 999:999` the data and config paths.

## Bootstrap files

```
openssl rand -base64 756 > /mnt/media/apps/mongodb-config/keyfile
cat /etc/certificates/<name>-acme.crt > /mnt/media/apps/mongodb-config/mongodb.pem
echo "" >> /mnt/media/apps/mongodb-config/mongodb.pem
cat /etc/certificates/<name>-acme.key >> /mnt/media/apps/mongodb-config/mongodb.pem
chmod 400 /mnt/media/apps/mongodb-config/keyfile /mnt/media/apps/mongodb-config/mongodb.pem
chown 999:999 /mnt/media/apps/mongodb-config/keyfile /mnt/media/apps/mongodb-config/mongodb.pem
```

The keyfile enables internal replica-set auth and implies `--auth` for clients (SCRAM). The PEM is
the certificate and private key concatenated - mongod wants them in one file, and the `echo ""`
newline between them is required: without it mongod fails at startup with
`PEM routines::bad end line`.

## Install the app

The catalogue MongoDB app is unusable for this setup: it exposes no field for extra mongod arguments
(so no `--replSet` or TLS) and forces entrypoint user creation. Install via **Apps > Discover Apps >
Custom App > Install via YAML** instead:

```yaml
services:
  mongodb:
    image: mongo:8
    container_name: at-mongodb
    command: >
      mongod --replSet rs0 --port 27019 --bind_ip_all --keyFile /etc/mongo/keyfile --tlsMode
      requireTLS --tlsCertificateKeyFile /etc/mongo/mongodb.pem
      --tlsAllowConnectionsWithoutCertificates --setParameter tlsUseSystemCA=true
      --wiredTigerCacheSizeGB 1.5
    ports:
      - "27019:27019"
    volumes:
      - /mnt/media/apps/mongodb-data:/data/db
      - /mnt/media/apps/mongodb-config:/etc/mongo:ro
      - /mnt/media/apps/mongodb-backups:/dump
    extra_hosts:
      - "db.example.nz:127.0.0.1"
    mem_limit: 3g
    restart: unless-stopped
```

Flag notes, all learned against MongoDB 8.2.x:

- `--setParameter tlsUseSystemCA=true` is required or mongod refuses to start with a chain-of-trust
  error (it cannot validate its own Let's Encrypt cert without the system CA store).
- `--tlsAllowConnectionsWithoutCertificates` is required alongside it or mongod demands client
  certificates and rejects every connection with `No SSL certificate provided by peer`.
- `--keyFile` implies `--auth` for clients (SCRAM); users must be created via the localhost
  exception before anything else can connect.
- The explicit WiredTiger cache size matters because WT sizes itself from the host's RAM, not the
  container limit; `mem_limit: 3g` leaves headroom over the 1.5 GB cache.
- `extra_hosts` maps the public domain to loopback inside the container so `rs.initiate` with the
  public hostname passes mongod's is-self check without relying on NAT hairpin, and so in-container
  `mongosh` can validate the certificate hostname.

## Initialise the replica set and users

The localhost exception is open until the first user exists, so bootstrap from inside the container
(find the container name with `docker ps` if using the catalogue app):

```
docker exec -it at-mongodb mongosh "mongodb://db.example.nz:27019/?tls=true&directConnection=true"
```

```js
rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "db.example.nz:27019" }] });
// wait for PRIMARY, then:
use admin;
db.createUser({ user: "root", pwd: "<32+ char random>", roles: ["root"] });
// reconnect authenticated as root, then:
use at-route-performance;
db.createUser({
  user: "atapp",
  pwd: "<32+ char random>",
  roles: [{ role: "readWrite", db: "at-route-performance" }],
});
```

`readWrite` covers everything the app does: Prisma CRUD, `$runCommandRaw` aggregations,
`createIndex` (the production build runs `prisma db push`), and `dbStats` (cleanup route).

## Connection string

```
mongodb://atapp:<pass>@db.example.nz:27019/at-route-performance?tls=true&authSource=at-route-performance&directConnection=true&retryWrites=true
```

`directConnection=true` makes the driver skip replica-set topology discovery, so the advertised host
never has to resolve from Vercel's side. Do **not** also set `replicaSet=rs0` - the two options
conflict. Prisma only needs the server to be a replica-set member; transactions work fine over a
direct connection to the primary.

Set this as `DATABASE_URL` in Vercel (Production, and Preview if previews share the database) and in
`.env.local`. Also set `STORAGE_LIMIT_MB` (e.g. `4096`) so the cleanup route's storage warning
reflects the new allowance.

## Certificate renewal

TrueNAS ACME renews the `.crt`/`.key` pair automatically, but mongod reads the combined PEM, which
nothing rebuilds. Add a TrueNAS Cron Job (System > Advanced > Cron Jobs, monthly):

```
cat /etc/certificates/<name>-acme.crt > /mnt/media/apps/mongodb-config/mongodb.pem \
  && echo "" >> /mnt/media/apps/mongodb-config/mongodb.pem \
  && cat /etc/certificates/<name>-acme.key >> /mnt/media/apps/mongodb-config/mongodb.pem \
  && chown 999:999 /mnt/media/apps/mongodb-config/mongodb.pem \
  && chmod 400 /mnt/media/apps/mongodb-config/mongodb.pem \
  && docker exec at-mongodb mongosh "mongodb://root:<pass>@db.example.nz:27019/admin?tls=true&directConnection=true" \
       --eval "db.adminCommand({rotateCertificates: 1})"
```

`rotateCertificates` hot-reloads the PEM without a restart (`docker restart at-mongodb` is the blunt
fallback). An expired certificate takes the whole app down - point an uptime monitor at the port and
watch the first renewal.

## Backups

- **ZFS snapshots** on `mongodb-data`: hourly keep 24, daily keep 14, weekly keep 8 (Data
  Protection > Periodic Snapshot Tasks). Snapshotting a running mongod is crash-consistent: the
  WiredTiger journal replays on startup exactly like recovery from a power cut, which is a supported
  path **provided journal and data live in the same dataset** (they do - both under `/data/db`).
  Restore whole datasets only; never copy individual files out of a snapshot into a live data dir.
- **Nightly logical dump** via a TrueNAS Cron Job:

  ```
  docker exec at-mongodb mongodump \
    --uri="mongodb://root:<pass>@db.example.nz:27019/?tls=true&authSource=admin&directConnection=true" \
    --gzip --archive=/dump/at-$(date +\%F).archive.gz
  ```

  plus a prune of archives older than 30 days. A gzipped dump is ~200-300 MB at 14-day retention but
  scales with the data: at a year's retention expect several GB and a dump window well past an hour,
  at which point drop the cadence to weekly and lean on the ZFS snapshots as the primary recovery
  path. Replicate or rsync the backups dataset off-box so a pool loss is not a data loss.

## Migration from Atlas (one-off)

Run the tools from inside the container - the mongo:8 image ships matching Database Tools, and
Atlas > NAS is one network hop.

Rehearsal (Atlas stays live, zero risk):

```
docker exec at-mongodb mongodump --uri="<atlas SRV uri>" \
  --readPreference=secondaryPreferred --gzip -o /dump/rehearsal
docker exec at-mongodb mongorestore \
  --uri="mongodb://root:<pass>@db.example.nz:27019/?tls=true&authSource=admin&directConnection=true" \
  --nsInclude="at-route-performance.*" --gzip --drop /dump/rehearsal
```

The dump includes index definitions; restore rebuilds all of them, including the unique
`(tripId, stopId, scheduledAt)` index. Point local dev at the new box and click around before any
cutover.

Cutover (~30-45 min; overlap is harmless because ArrivalEvent upserts are idempotent, but a gap
loses realtime rows permanently, and `mongorestore` never updates existing documents - hence the
full re-dump with `--drop`):

1. Disable all cron-job.org jobs; wait 2 minutes for in-flight runs.
2. Full re-dump from Atlas > full `mongorestore --drop` (commands above).
3. Verify per-collection `countDocuments()` matches Atlas exactly (crons are paused).
4. Swap `DATABASE_URL` in Vercel and set `STORAGE_LIMIT_MB`.
5. Redeploy production (env changes need one). The build's `prisma db push` should no-op - it
   doubles as a schema/index sanity check.
6. Smoke-check the deployed app, then re-enable the cron jobs, realtime first.
7. Keep the Atlas cluster paused and intact for 14 days as the rollback path: swap `DATABASE_URL`
   back and redeploy (loses only data ingested since cutover).
8. After 14 days: delete the Atlas cluster and rotate the old credentials.

## Retention at ten years

The target retention is `RETENTION_DAYS=3650` with `STORAGE_LIMIT_MB=262144` (256 GB allowance,
warns at 80% = ~205 GB). Raise `RETENTION_DAYS` in the Vercel env as soon as the decision is made -
the nightly cleanup permanently deletes the oldest day, so every day it runs at 14 keeps the archive
at two weeks. The archive accumulates forward from the raise; nothing older can be recovered.

Sizing, extrapolated from measured per-document costs (~108 B data + ~162 B index on disk at
lz4/WiredTiger compression, ~235k events/day): ~86M events/year > ~9 GB data + ~14 GB indexes, so
~23 GB per year and ~230 GB at the ten-year steady state. Queries stay day-bounded (see the query
rule in `src/lib/data.ts`), so the hot working set remains the recent days plus index interiors, not
the archive - but raise `--wiredTigerCacheSizeGB` toward 4 (and `mem_limit` to ~6g) once the archive
passes a few months, and revisit as index interiors grow.

At this scale logical dumps stop being a workable backup: a full `mongodump` would run for hours and
produce tens of GB nightly. Keep the nightly dump only while the data set is small (first year or
so), then retire it in favour of the ZFS snapshots plus replication of `mongodb-data` to a second
pool or off-box target - snapshot restore is the recovery path, and it restores the whole dataset at
a point in time.

## Verification checklist

1. Per-collection counts match Atlas at cutover; `ArrivalEvent` exact.
2. `db.ArrivalEvent.getIndexes()` shows the unique index plus the three compounds from
   `prisma/schema.prisma`.
3. A `$percentile` aggregation over one day runs via `mongosh` (proves 7.0+ features).
4. Home page, a route page, rankings, and week view load on production with historical numbers
   identical to pre-cutover.
5. Two realtime ingest runs succeed (`IngestRun` rows, ~1.6k rows/run growth).
6. A manual cleanup run returns 202 then records success, with the storage warning quiet.
7. Vercel function durations stay sane: the week boards fan out per-day with `Promise.all`, so the
   extra Sydney > NZ round trip (~20-50 ms) costs one RTT, not seven.
