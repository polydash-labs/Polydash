-- Agent Wallets (Phase 1): approval queue for big moves above the agent key's caps.
-- status: pending | executed | denied. Addresses lowercase. No key material stored.
CREATE TABLE "AgentWalletApproval" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "to" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '0',
    "data" TEXT NOT NULL DEFAULT '0x',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "decisionTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentWalletApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentWalletApproval_wallet_createdAt_idx" ON "AgentWalletApproval"("wallet", "createdAt");
CREATE INDEX "AgentWalletApproval_wallet_status_idx" ON "AgentWalletApproval"("wallet", "status");
CREATE INDEX "AgentWalletApproval_owner_createdAt_idx" ON "AgentWalletApproval"("owner", "createdAt");
