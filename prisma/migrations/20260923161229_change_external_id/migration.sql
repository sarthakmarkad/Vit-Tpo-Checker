/*
  Warnings:

  - Added the required column `externalId` to the `PlacementChange` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PlacementChange" ADD COLUMN     "externalId" TEXT NOT NULL;
