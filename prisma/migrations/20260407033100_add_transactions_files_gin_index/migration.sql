-- Index JSON file links for faster array/containment lookups on legacy `transactions.files`.
CREATE INDEX IF NOT EXISTS "transactions_files_gin_idx"
ON "transactions"
USING GIN ("files");
