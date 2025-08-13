-- CreateEnum
CREATE TYPE "public"."Mode" AS ENUM ('BUS', 'TRAIN', 'FERRY');

-- CreateTable
CREATE TABLE "public"."Route" (
    "id" TEXT NOT NULL,
    "shortName" TEXT,
    "longName" TEXT NOT NULL,
    "mode" "public"."Mode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Stop" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Trip" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "headsign" TEXT,
    "directionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ArrivalEvent" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "tripId" TEXT,
    "vehicleId" TEXT,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "actualAt" TIMESTAMPTZ(6) NOT NULL,
    "deviationSec" INTEGER NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrivalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Route_mode_idx" ON "public"."Route"("mode");

-- CreateIndex
CREATE INDEX "Trip_routeId_serviceDate_idx" ON "public"."Trip"("routeId", "serviceDate");

-- CreateIndex
CREATE INDEX "ArrivalEvent_routeId_scheduledAt_idx" ON "public"."ArrivalEvent"("routeId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ArrivalEvent_stopId_scheduledAt_idx" ON "public"."ArrivalEvent"("stopId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ArrivalEvent_scheduledAt_idx" ON "public"."ArrivalEvent"("scheduledAt");

-- AddForeignKey
ALTER TABLE "public"."Trip" ADD CONSTRAINT "Trip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ArrivalEvent" ADD CONSTRAINT "ArrivalEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ArrivalEvent" ADD CONSTRAINT "ArrivalEvent_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "public"."Stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ArrivalEvent" ADD CONSTRAINT "ArrivalEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "public"."Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
