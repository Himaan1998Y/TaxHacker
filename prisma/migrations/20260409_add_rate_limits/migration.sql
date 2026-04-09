-- Create durable rate-limit counter table to replace the in-process Map
-- in app/api/agent/auth.ts. The Map did not survive container restarts,
-- so counters reset on every rolling deploy.

CREATE TABLE "rate_limits" (
    "bucket"     TEXT        NOT NULL,
    "key"        TEXT        NOT NULL,
    "count"      INTEGER     NOT NULL DEFAULT 0,
    "reset_at"   TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("bucket", "key")
);

CREATE INDEX "rate_limits_reset_at_idx" ON "rate_limits" ("reset_at");
