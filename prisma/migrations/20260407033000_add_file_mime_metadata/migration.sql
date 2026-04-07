-- Add trusted/untrusted MIME metadata for uploaded files.
ALTER TABLE "files"
ADD COLUMN IF NOT EXISTS "client_mimetype" TEXT,
ADD COLUMN IF NOT EXISTS "detected_mimetype" TEXT;
