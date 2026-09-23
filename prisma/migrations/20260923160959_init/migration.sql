-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "notifyEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "branch" TEXT,
    "program" TEXT,
    "graduationYear" INTEGER,
    "cgpa" DOUBLE PRECISION,
    "sscPercentage" DOUBLE PRECISION,
    "hscPercentage" DOUBLE PRECISION,
    "diplomaPercentage" DOUBLE PRECISION,
    "activeBacklogs" INTEGER NOT NULL DEFAULT 0,
    "deadBacklogs" INTEGER NOT NULL DEFAULT 0,
    "skills" JSONB,
    "preferredRoles" JSONB,
    "preferredLocations" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementOpportunity" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "offeringCode" TEXT,
    "packageLpa" DOUBLE PRECISION,
    "minPackageLpa" DOUBLE PRECISION,
    "placementType" TEXT,
    "internshipType" TEXT,
    "companyType" TEXT,
    "academicYear" TEXT,
    "registrationStart" TIMESTAMP(3),
    "registrationEnd" TIMESTAMP(3),
    "minimumCgpa" DOUBLE PRECISION,
    "sscPercentage" DOUBLE PRECISION,
    "hscPercentage" DOUBLE PRECISION,
    "diplomaPercentage" DOUBLE PRECISION,
    "activeBacklogsAllowed" BOOLEAN,
    "deadBacklogsAllowed" BOOLEAN,
    "placedStudentsAllowed" BOOLEAN,
    "yearDownAllowed" BOOLEAN,
    "higherStudiesAllowed" BOOLEAN,
    "programs" JSONB,
    "organizations" JSONB,
    "skills" JSONB,
    "locations" JSONB,
    "minStipend" DOUBLE PRECISION,
    "maxStipend" DOUBLE PRECISION,
    "stipendDescription" TEXT,
    "description" TEXT,
    "jobDescription" TEXT,
    "bondDescription" TEXT,
    "selectionProcess" JSONB,
    "isActive" BOOLEAN,
    "contentHash" TEXT,
    "aiInterpretation" JSONB,
    "rawData" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetailFetchAt" TIMESTAMP(3),

    CONSTRAINT "PlacementOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementRequirement" (
    "id" SERIAL NOT NULL,
    "opportunityId" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementAttachment" (
    "id" SERIAL NOT NULL,
    "opportunityId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "objectKey" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "localPath" TEXT,
    "extractedText" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementChange" (
    "id" SERIAL NOT NULL,
    "opportunityId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "previousHash" TEXT,
    "newHash" TEXT,
    "fieldChanges" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "PlacementChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementOpportunity_externalId_key" ON "PlacementOpportunity"("externalId");

-- CreateIndex
CREATE INDEX "PlacementOpportunity_registrationEnd_idx" ON "PlacementOpportunity"("registrationEnd");

-- CreateIndex
CREATE INDEX "PlacementOpportunity_companyName_idx" ON "PlacementOpportunity"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementRequirement_opportunityId_key" ON "PlacementRequirement"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementAttachment_opportunityId_externalId_key" ON "PlacementAttachment"("opportunityId", "externalId");

-- CreateIndex
CREATE INDEX "PlacementChange_detectedAt_idx" ON "PlacementChange"("detectedAt");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementRequirement" ADD CONSTRAINT "PlacementRequirement_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "PlacementOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementAttachment" ADD CONSTRAINT "PlacementAttachment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "PlacementOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementChange" ADD CONSTRAINT "PlacementChange_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "PlacementOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
