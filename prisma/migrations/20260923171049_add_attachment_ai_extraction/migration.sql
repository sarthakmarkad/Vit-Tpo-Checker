-- AlterTable
ALTER TABLE "PlacementAttachment" ADD COLUMN     "aiExtractedAt" TIMESTAMP(3),
ADD COLUMN     "aiExtraction" JSONB,
ADD COLUMN     "aiModel" TEXT;
