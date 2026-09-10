-- ============================================
-- Broker Execution Framework Migration
-- ============================================

-- BrokerProviderConfig
CREATE TABLE "BrokerProviderConfig" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "authType" TEXT NOT NULL,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerProviderConfig_providerId_key" ON "BrokerProviderConfig"("providerId");

-- BrokerProviderCapability
CREATE TABLE "BrokerProviderCapability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "supported" BOOLEAN NOT NULL DEFAULT true,
    "constraints" JSONB,

    CONSTRAINT "BrokerProviderCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerProviderCapability_providerId_capability_key" ON "BrokerProviderCapability"("providerId", "capability");

ALTER TABLE "BrokerProviderCapability" ADD CONSTRAINT "BrokerProviderCapability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "BrokerProviderConfig"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BrokerConnection
CREATE TABLE "BrokerConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accountId" TEXT,
    "accountName" TEXT,
    "accountType" TEXT NOT NULL DEFAULT 'demo',
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "connectionState" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "encryptedApiKey" TEXT,
    "encryptedApiSecret" TEXT,
    "encryptedPassphrase" TEXT,
    "encryptedToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 0,
    "lastConnectedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "reconnectAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrokerConnection_tenantId_idx" ON "BrokerConnection"("tenantId");
CREATE INDEX "BrokerConnection_tenantId_providerId_idx" ON "BrokerConnection"("tenantId", "providerId");
CREATE INDEX "BrokerConnection_connectionState_idx" ON "BrokerConnection"("connectionState");

ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "BrokerProviderConfig"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ExecutionCommandRecord
CREATE TABLE "ExecutionCommandRecord" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "commandPayload" JSONB NOT NULL,
    "currentState" TEXT NOT NULL DEFAULT 'CREATED',
    "previousState" TEXT,
    "requestFingerprint" TEXT,
    "deduplicateCount" INTEGER NOT NULL DEFAULT 0,
    "brokerOrderId" TEXT,
    "brokerPositionId" TEXT,
    "rejectionReason" TEXT,
    "fillPrice" DOUBLE PRECISION,
    "fillSize" DOUBLE PRECISION,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionCommandRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExecutionCommandRecord_commandId_key" ON "ExecutionCommandRecord"("commandId");
CREATE INDEX "ExecutionCommandRecord_tenantId_idx" ON "ExecutionCommandRecord"("tenantId");
CREATE INDEX "ExecutionCommandRecord_idempotencyKey_tenantId_connectionId_providerId_idx" ON "ExecutionCommandRecord"("idempotencyKey", "tenantId", "connectionId", "providerId");
CREATE INDEX "ExecutionCommandRecord_commandId_idx" ON "ExecutionCommandRecord"("commandId");
CREATE INDEX "ExecutionCommandRecord_currentState_idx" ON "ExecutionCommandRecord"("currentState");
CREATE INDEX "ExecutionCommandRecord_createdAt_idx" ON "ExecutionCommandRecord"("createdAt");

ALTER TABLE "ExecutionCommandRecord" ADD CONSTRAINT "ExecutionCommandRecord_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ExecutionStateTransition
CREATE TABLE "ExecutionStateTransition" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionStateTransition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExecutionStateTransition_commandId_idx" ON "ExecutionStateTransition"("commandId");
CREATE INDEX "ExecutionStateTransition_timestamp_idx" ON "ExecutionStateTransition"("timestamp");

ALTER TABLE "ExecutionStateTransition" ADD CONSTRAINT "ExecutionStateTransition_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "ExecutionCommandRecord"("commandId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- KillSwitchRecord
CREATE TABLE "KillSwitchRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'INACTIVE',
    "emergencyReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KillSwitchRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KillSwitchRecord_scope_scopeId_key" ON "KillSwitchRecord"("scope", "scopeId");
CREATE INDEX "KillSwitchRecord_state_idx" ON "KillSwitchRecord"("state");

-- ReconciliationResult
CREATE TABLE "ReconciliationResult" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "brokerOrderCount" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "discrepancies" JSONB,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationResult_accountId_idx" ON "ReconciliationResult"("accountId");
CREATE INDEX "ReconciliationResult_connectionId_idx" ON "ReconciliationResult"("connectionId");
CREATE INDEX "ReconciliationResult_startedAt_idx" ON "ReconciliationResult"("startedAt");

ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BrokerExecutionAudit
CREATE TABLE "BrokerExecutionAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT,
    "providerId" TEXT,
    "action" TEXT NOT NULL,
    "previousState" TEXT,
    "resultingState" TEXT,
    "reason" TEXT,
    "correlationId" TEXT,
    "commandId" TEXT,
    "ipMetadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerExecutionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrokerExecutionAudit_tenantId_idx" ON "BrokerExecutionAudit"("tenantId");
CREATE INDEX "BrokerExecutionAudit_actorId_idx" ON "BrokerExecutionAudit"("actorId");
CREATE INDEX "BrokerExecutionAudit_action_idx" ON "BrokerExecutionAudit"("action");
CREATE INDEX "BrokerExecutionAudit_commandId_idx" ON "BrokerExecutionAudit"("commandId");
CREATE INDEX "BrokerExecutionAudit_timestamp_idx" ON "BrokerExecutionAudit"("timestamp");

-- IdempotencyRecord
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "deduplicateCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyRecord_idempotencyKey_tenantId_accountId_providerId_key" ON "IdempotencyRecord"("idempotencyKey", "tenantId", "accountId", "providerId");
CREATE INDEX "IdempotencyRecord_commandId_idx" ON "IdempotencyRecord"("commandId");
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- ProviderEventLog
CREATE TABLE "ProviderEventLog" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "connectionId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB NOT NULL,
    "sequenceNum" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderEventLog_providerId_idx" ON "ProviderEventLog"("providerId");
CREATE INDEX "ProviderEventLog_connectionId_idx" ON "ProviderEventLog"("connectionId");
CREATE INDEX "ProviderEventLog_eventType_idx" ON "ProviderEventLog"("eventType");
CREATE INDEX "ProviderEventLog_timestamp_idx" ON "ProviderEventLog"("timestamp");
