/*
  Warnings:

  - The primary key for the `ArrivalEvent` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `ArrivalEvent` table. All the data in the column will be lost.
  - The `id` column on the `ArrivalEvent` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `createdAt` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Stop` table. All the data in the column will be lost.
  - You are about to drop the `Trip` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `tripId` on table `ArrivalEvent` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."ArrivalEvent" DROP CONSTRAINT "ArrivalEvent_tripId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Trip" DROP CONSTRAINT "Trip_routeId_fkey";

-- DropIndex
DROP INDEX "public"."ArrivalEvent_scheduledAt_idx";

-- DropIndex
DROP INDEX "public"."Route_mode_idx";

-- AlterTable
ALTER TABLE "public"."ArrivalEvent" DROP CONSTRAINT "ArrivalEvent_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "id",
ADD COLUMN     "id" BIGSERIAL NOT NULL,
ALTER COLUMN "tripId" SET NOT NULL,
ALTER COLUMN "scheduledAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "actualAt" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "ArrivalEvent_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."Route" DROP COLUMN "createdAt";

-- AlterTable
ALTER TABLE "public"."Stop" DROP COLUMN "createdAt";

-- DropTable
DROP TABLE "public"."Trip";
