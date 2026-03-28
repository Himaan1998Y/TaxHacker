-- Storage fields need BIGINT to support >2GB uploads (INT4 max is ~2.1GB)
ALTER TABLE "users" ALTER COLUMN "storage_used" TYPE BIGINT;
ALTER TABLE "users" ALTER COLUMN "storage_limit" TYPE BIGINT;
