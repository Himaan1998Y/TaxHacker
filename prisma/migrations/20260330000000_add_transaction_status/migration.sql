-- Transaction reversal support (Companies Act 2013 compliance)
-- Financial records should be reversed, not deleted.
-- status: 'active' (default) | 'reversed'

ALTER TABLE "transactions" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
CREATE INDEX "idx_transactions_status" ON "transactions"("status");
