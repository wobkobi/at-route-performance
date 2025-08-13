/*
  Warnings:

  - A unique constraint covering the columns `[tripId,stopId,actualAt]` on the table `ArrivalEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ArrivalEvent_tripId_stopId_actualAt_key" ON "public"."ArrivalEvent"("tripId", "stopId", "actualAt");
