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

A second, self-signed certificate carries the member-to-member connection. Generate it once; it
never needs renewing:

```
cd /mnt/media/apps/mongodb-config
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout cluster.key -out cluster.crt \
  -subj "/CN=db.example.nz" \
  -addext "extendedKeyUsage=serverAuth,clientAuth" \
  -addext "subjectAltName=DNS:db.example.nz,IP:127.0.0.1"
cat cluster.crt cluster.key > cluster.pem
chmod 400 cluster.pem cluster.crt
chown 999:999 cluster.pem cluster.crt
openssl x509 -in cluster.crt -noout -ext extendedKeyUsage   # must list BOTH usages
```

Why a second certificate: mongod opens a replication connection to itself, and that connection is a
**client** connection, so the certificate it presents needs the `clientAuth` extended key usage.
Let's Encrypt issues `serverAuth` only, so pointing the cluster at the ACME cert leaves mongod
rejecting its own replication connections with
`SSL peer certificate validation failed: unsuitable certificate purpose`, logged against
`NetworkInterfaceTL-ReplNetwork`. Keeping the two roles on separate certificates also means an ACME
renewal can never break replication again. The `Client connecting with server's own TLS certificate`
warning afterwards is benign - both certificates share a CN.

## Install the app

The catalogue MongoDB app is unusable for this setup: it exposes no field for extra mongod arguments
(so no `--replSet` or TLS) and forces entrypoint user creation. Install via **Apps > Discover Apps >
Custom App > Install via YAML** instead:

```yaml
services:
  mongodb:
    image: mongo:8.3.9
    container_name: at-mongodb
    command: >
      mongod --replSet rs0 --port 27019 --bind_ip_all --keyFile /etc/mongo/keyfile --tlsMode
      requireTLS --tlsCertificateKeyFile /etc/mongo/mongodb.pem
      --tlsAllowConnectionsWithoutCertificates --tlsCAFile /etc/ssl/certs/ca-certificates.crt
      --tlsClusterFile /etc/mongo/cluster.pem --tlsClusterCAFile /etc/mongo/cluster.crt
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

Pin the image to an exact version. `mongo:8` floats, so a restart can move the server across minor
versions without warning and change behaviour under a data set written by the previous one.

Flag notes, verified against MongoDB 8.3.9:

- `--tlsCAFile` pointing at the image's system bundle replaces the older
  `--setParameter tlsUseSystemCA=true`: mongod still needs the public roots to validate the Let's
  Encrypt chain, and `--tlsClusterCAFile` refuses to load unless `--tlsCAFile` is set too.
- `--tlsClusterFile` / `--tlsClusterCAFile` put member-to-member TLS on the self-signed cluster
  certificate. Without them every index build hangs forever; see the Bootstrap files section.
- `--tlsAllowConnectionsWithoutCertificates` is required or mongod demands client certificates and
  rejects every connection with `No SSL certificate provided by peer`. Vercel presents no client
  certificate.
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
`.env.local`. Also set `STORAGE_LIMIT_MB` and `RETENTION_DAYS` per the retention section below so
the cleanup route enforces the intended policy from the first run.

Paste the value into Vercel **unquoted**. `.env.local` wraps it in double quotes; carrying those
into the Vercel env field makes the last option parse as `true"` and the production build dies at
`prisma db push` with `P1013: connection string 'retrywrites' option must be a boolean`. Vercel
stores the value verbatim, quotes included, and the dashboard renders it indistinguishably from a
clean one - the only symptom is the failed build.

Removing the variable from one environment removes it from every environment it covers: a single
entry spanning Production and Preview disappears entirely when removed from Production alone. Re-add
it to both.

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

## Migration from Atlas (done)

The Atlas cluster is deleted. The NAS holds the only copy of the data, so there is no rollback
target: the Backups section above is the sole recovery path, not belt-and-braces.

## Verify indexes after any restore

`mongorestore` does **not** reliably leave collections indexed. The archive carries the index
definitions, but the builds run as a per-collection final phase, and an interrupted restore exits
with every document in place and some collections holding only `_id_`. Nothing reports the gap:
pages still render, just off collection scans.

Check explicitly, then let `prisma db push` create whatever is missing:

```
docker exec at-mongodb mongosh "<uri>" --quiet --eval \
  'db.getCollectionNames().sort().forEach(c=>print(c+": "+db.getCollection(c).getIndexes().map(i=>i.name).join(", ")))'
```

`ArrivalEvent` is the one that matters. Ingest upserts on `(tripId, stopId, scheduledAt)` (see
`bulkUpsertArrivals` in `src/app/api/ingest/at/route.ts`), so without that unique index every upsert
degrades to a collection scan of the whole archive, and `ordered: false` lets concurrent writes race
duplicates in. Ingest does not fail loudly - it slows until the function times out.

## When index builds hang

A mongod that serves reads, writes and index _drops_ at normal speed while every `createIndex` hangs
indefinitely has a broken replication network interface. Two-phase index builds are the only routine
operation that has to round-trip through it to reach commit, so it is the one thing that breaks
while the database otherwise looks perfectly healthy.

**Check the mongod log first.** Every hypothesis reachable from a client connection is a dead end,
and each costs a slow round of elimination: the hang reproduces on an empty collection (so it is not
data volume), with `commitQuorum: 0` (not the quorum wait), against fast `w:"majority"` writes (not
a stalled commit point), on 1.5 TB of free disk, with a clean catalogue, and it survives a restart.
The log names the cause on the first line.

```
docker logs --tail 50 at-mongodb | grep -i replnetwork
```

`unsuitable certificate purpose` there means the cluster certificate is missing `clientAuth`; see
the Bootstrap files section. A real build, by contrast, reports a `progress` field in
`db.currentOp()` and advances; a blocked one reports none.

Aborted builds leave `internal-sideWrites-*` idents behind. The `TimestampMonitor` drops them on the
next startup, which is normal cleanup rather than a further fault.

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

1. `db.ArrivalEvent.getIndexes()` shows the unique index plus the three compounds from
   `prisma/schema.prisma`, and every other collection matches its schema block. Do this first: the
   checks below all pass against an unindexed database, just slowly.
2. `prisma db push` runs clean against the box in under a minute. The production build runs it, so a
   push that hangs is a failed deploy.
3. A `$percentile` aggregation over one day runs via `mongosh` (proves 7.0+ features).
4. Home page, a route page, rankings, and week view load on production.
5. Two realtime ingest runs succeed (`IngestRun` rows, ~1.6k rows/run growth).
6. A manual cleanup run returns 202 then records success, with the storage warning quiet.
7. Vercel function durations stay sane: the week boards fan out per-day with `Promise.all`, so the
   extra Sydney > NZ round trip (~20-50 ms) costs one RTT, not seven.
