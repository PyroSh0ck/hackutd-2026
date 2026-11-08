-- DropIndex
DROP INDEX "observer_event_sessionId_revision_key";

-- AlterTable
ALTER TABLE "observer_assessment" ALTER COLUMN "requestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "observer_event" ADD COLUMN     "detail" TEXT,
ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "observer_session" ADD COLUMN     "caseReference" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "practiceCode" TEXT,
ADD COLUMN     "scenarioId" TEXT NOT NULL DEFAULT 'legacy-observer-v1',
ADD COLUMN     "scenarioVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "observer_issue" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "originAssessmentId" TEXT NOT NULL,
    "addressedMessageId" TEXT,
    "resolvedByAssessmentId" TEXT,
    "resolutionEventId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,

    CONSTRAINT "observer_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observer_addition" (
    "sessionId" UUID NOT NULL,
    "additionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "introducedMessageId" TEXT,

    CONSTRAINT "observer_addition_pkey" PRIMARY KEY ("sessionId","additionId")
);

-- CreateTable
CREATE TABLE "planner_record" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "inputId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "committedKey" TEXT,
    "seq" SERIAL NOT NULL,
    "record" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planner_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "observer_issue_dedupeKey_key" ON "observer_issue"("dedupeKey");

-- CreateIndex
CREATE INDEX "observer_issue_sessionId_seq_idx" ON "observer_issue"("sessionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "planner_record_committedKey_key" ON "planner_record"("committedKey");

-- CreateIndex
CREATE INDEX "planner_record_sessionId_seq_idx" ON "planner_record"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "observer_event_sessionId_revision_idx" ON "observer_event"("sessionId", "revision");

-- AddForeignKey
ALTER TABLE "observer_issue" ADD CONSTRAINT "observer_issue_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observer_addition" ADD CONSTRAINT "observer_addition_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_record" ADD CONSTRAINT "planner_record_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: sessions that ended before the lifecycle existed are in the ended stage.
UPDATE "observer_session" SET "stage" = 'ended' WHERE "ended" = true;
