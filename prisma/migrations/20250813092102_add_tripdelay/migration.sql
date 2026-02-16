-- CreateTable
CREATE TABLE "public"."TripDelay" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "delaySec" INTEGER NOT NULL,
    "source" TEXT,

    CONSTRAINT "TripDelay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripDelay_routeId_timestamp_idx" ON "public"."TripDelay"("routeId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TripDelay_tripId_timestamp_key" ON "public"."TripDelay"("tripId", "timestamp");

-- AddForeignKey
ALTER TABLE "public"."TripDelay" ADD CONSTRAINT "TripDelay_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
