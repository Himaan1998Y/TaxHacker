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

# Run database migrations (use direct node path — npx not available in standalone)
echo "Running database migrations..."
node node_modules/prisma/build/index.js generate
node node_modules/prisma/build/index.js migrate deploy

# Start the application
echo "Starting the application..."
exec "$@"
