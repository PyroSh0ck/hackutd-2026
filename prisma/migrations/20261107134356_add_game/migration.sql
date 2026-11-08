-- CreateTable
CREATE TABLE "game_session" (
    "id" UUID NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioVersion" INTEGER NOT NULL,
    "opponentMode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "pendingTurnId" TEXT,
    "pendingTurnStartedAt" TIMESTAMP(3),
    "pendingTurnExpiresAt" TIMESTAMP(3),
    "lastTurnId" TEXT,
    "lastTurnOrigin" TEXT,
    "lastTurnFallbackReason" TEXT,
    "parentSessionId" UUID,
    "checkpointEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_event" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actionId" TEXT,
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_action_receipt" (
    "sessionId" UUID NOT NULL,
    "actionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultVersion" INTEGER NOT NULL,
    "eventIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_action_receipt_pkey" PRIMARY KEY ("sessionId","actionId")
);

-- CreateTable
CREATE TABLE "game_turn" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "triggerActionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "origin" TEXT,
    "fallbackReason" TEXT,
    "modelId" TEXT,
    "modelRequests" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "observationFields" TEXT[],
    "toolCalls" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "game_turn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_session_ownerKey_idx" ON "game_session"("ownerKey");

-- CreateIndex
CREATE INDEX "game_session_parentSessionId_idx" ON "game_session"("parentSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "game_event_sessionId_sequence_key" ON "game_event"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "game_turn_sessionId_startedAt_idx" ON "game_turn"("sessionId", "startedAt");

-- AddForeignKey
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "game_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_action_receipt" ADD CONSTRAINT "game_action_receipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_turn" ADD CONSTRAINT "game_turn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
