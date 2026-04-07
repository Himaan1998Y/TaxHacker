-- Composite index for the "unsorted files" query, which filters by
-- (userId, isReviewed=false). Without this index, every dashboard /
-- unsorted page load triggered a full table scan of `files`, becoming
-- slower as file count grew.
CREATE INDEX IF NOT EXISTS "files_user_reviewed_idx" ON "files" ("user_id", "is_reviewed");
