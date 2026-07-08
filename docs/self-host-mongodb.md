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
   works behind NAT. TrueNAS writes certs to `/etc/certificates/<name>.crt` and `.key`.

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
cat /etc/certificates/<name>.crt /etc/certificates/<name>.key > /mnt/media/apps/mongodb-config/mongodb.pem
chmod 400 /mnt/media/apps/mongodb-config/keyfile /mnt/media/apps/mongodb-config/mongodb.pem
chown 999:999 /mnt/media/apps/mongodb-config/keyfile /mnt/media/apps/mongodb-config/mongodb.pem
```

The keyfile enables internal replica-set auth and implies `--auth` for clients (SCRAM). The PEM is
the certificate and private key concatenated - mongod wants them in one file.

## Install the app

**Preferred: the catalogue app.** Apps > Discover Apps > MongoDB (community train). Configure:

- Storage: host path `mongodb-data` for the data dir, `mongodb-config` mounted read-only at
  `/etc/mongo`, `mongodb-backups` at `/dump`.
- Port: `27019`.
- Additional mongod arguments:
  `--replSet rs0 --keyFile /etc/mongo/keyfile --tlsMode requireTLS --tlsCertificateKeyFile /etc/mongo/mongodb.pem --wiredTigerCacheSizeGB 1.5`
- Leave the root username/password fields empty (the image entrypoint's auto user creation
  misbehaves combined with `--replSet`; users are created manually below).
- Memory limit ~3 GB. The explicit WiredTiger cache size matters because WT sizes itself from the
  host's RAM, not the container limit.

**Fallback: Custom App via YAML** (Apps > Discover Apps > Custom App) if the catalogue app does not
expose extra arguments or read-only mounts:

```yaml
services:
  mongodb:
    image: mongo:8
    container_name: at-mongodb
    command: >
      mongod --replSet rs0 --port 27019 --bind_ip_all --keyFile /etc/mongo/keyfile --tlsMode
      requireTLS --tlsCertificateKeyFile /etc/mongo/mongodb.pem --wiredTigerCacheSizeGB 1.5
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

The `extra_hosts` entry maps the public domain to loopback inside the container so `rs.initiate`
with the public hostname passes mongod's is-self check without relying on NAT hairpin, and so
in-container `mongosh` can validate the certificate hostname.

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
cat /etc/certificates/<name>.crt /etc/certificates/<name>.key > /mnt/media/apps/mongodb-config/mongodb.pem \
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

  plus a prune of archives older than 30 days. A gzipped dump is ~200-300 MB; replicate or rsync the
  backups dataset off-box so a pool loss is not a data loss.

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
8. After 14 days: optionally raise `RETENTION_DAYS` (disk is no longer scarce), then delete the
   Atlas cluster and rotate the old credentials.

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
