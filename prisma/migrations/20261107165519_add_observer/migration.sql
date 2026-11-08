-- CreateTable
CREATE TABLE "observer_session" (
    "id" UUID NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "conversationRevision" INTEGER NOT NULL,
    "turn" INTEGER NOT NULL,
    "ended" BOOLEAN NOT NULL DEFAULT false,
    "claimId" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observer_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observer_message" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "turn" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observer_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observer_request" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "introducedByMessageId" TEXT NOT NULL,
    "targetAction" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "observer_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observer_event" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestId" TEXT,
    "turn" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "challengeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observer_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observer_receipt" (
    "sessionId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "challengeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observer_receipt_pkey" PRIMARY KEY ("sessionId","key")
);

-- CreateTable
CREATE TABLE "observer_assessment" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "currentMessageId" TEXT NOT NULL,
    "basedOnRevision" INTEGER NOT NULL,
    "application" TEXT NOT NULL,
    "appliedKey" TEXT,
    "seq" SERIAL NOT NULL,
    "record" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observer_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "observer_session_threadId_key" ON "observer_session"("threadId");

-- CreateIndex
CREATE INDEX "observer_session_ownerKey_idx" ON "observer_session"("ownerKey");

-- CreateIndex
CREATE UNIQUE INDEX "observer_message_sessionId_revision_key" ON "observer_message"("sessionId", "revision");

-- CreateIndex
CREATE INDEX "observer_request_sessionId_revision_idx" ON "observer_request"("sessionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "observer_event_sessionId_revision_key" ON "observer_event"("sessionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "observer_assessment_appliedKey_key" ON "observer_assessment"("appliedKey");

-- CreateIndex
CREATE INDEX "observer_assessment_sessionId_seq_idx" ON "observer_assessment"("sessionId", "seq");

-- AddForeignKey
ALTER TABLE "observer_message" ADD CONSTRAINT "observer_message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observer_request" ADD CONSTRAINT "observer_request_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observer_event" ADD CONSTRAINT "observer_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observer_receipt" ADD CONSTRAINT "observer_receipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observer_assessment" ADD CONSTRAINT "observer_assessment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "observer_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
