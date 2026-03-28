#!/bin/sh
set -e

# Extract server part from DATABASE_URL (remove database name)
SERVER_URL=$(echo "$DATABASE_URL" | sed 's/\/[^/]*$//')

# Wait for database to be ready using psql and SERVER_URL
echo "Waiting for PostgreSQL server to be ready at $SERVER_URL..."
until psql "$SERVER_URL" -c '\q' >/dev/null 2>&1; do
  echo "PostgreSQL server is unavailable - sleeping"
  sleep 1
done
echo "PostgreSQL server is ready!"

# Resolve any previously failed migrations before deploying
echo "Checking for failed migrations..."
node node_modules/prisma/build/index.js migrate resolve --rolled-back 20260328000000_add_pgvector_embeddings 2>/dev/null || true

# Run database migrations (use direct node path — npx not available in standalone)
echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

# Optional: enable pgvector if available (non-fatal)
echo "Checking pgvector availability..."
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null && \
  psql "$DATABASE_URL" -c "ALTER TABLE \"transactions\" ADD COLUMN IF NOT EXISTS \"embedding\" vector(768);" 2>/dev/null && \
  psql "$DATABASE_URL" -c "CREATE INDEX IF NOT EXISTS \"transactions_embedding_idx\" ON \"transactions\" USING hnsw (\"embedding\" vector_cosine_ops);" 2>/dev/null && \
  echo "pgvector enabled successfully." || \
  echo "pgvector not available (optional — embeddings will use fallback)."

# Ensure upload directories exist and are writable
mkdir -p /app/data/uploads 2>/dev/null || true

# Start the application
echo "Starting the application..."
exec "$@"
