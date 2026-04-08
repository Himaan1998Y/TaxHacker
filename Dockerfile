FROM node:23-slim AS base

# Default environment variables
ENV PORT=7331
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production

# Build stage
FROM base AS builder

# Prevent OOM on memory-constrained VPS builds
ENV NODE_OPTIONS="--max_old_space_size=4096"

# Install dependencies required for Prisma and sharp
RUN apt-get update && apt-get install -y openssl python3 make g++

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files (including pnpm lockfile)
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install dependencies using pnpm with frozen lockfile
RUN pnpm install --frozen-lockfile

# Explicitly generate Prisma client (pnpm ignores package build scripts by default)
RUN pnpm exec prisma generate

# Copy source code
COPY . .

# Rebuild sharp for the Linux build environment (pnpm ignored its postinstall)
RUN pnpm rebuild sharp || true

# Build the application (runs prisma generate again via build script, then next build)
RUN pnpm run build

# Materialise every package that the production stage will COPY --from=builder.
# pnpm stores node_modules entries as symlinks into node_modules/.pnpm/.
# Docker cannot resolve symlinks across build stages, so dereference them all here
# in one pass rather than patching per-package on each failure.
RUN for target in \
      node_modules/.prisma \
      node_modules/@prisma \
      node_modules/@img \
      node_modules/prisma \
      node_modules/sharp; \
    do \
      [ -e "$target" ] || mkdir -p "$target"; \
      if [ -L "$target" ]; then \
        real=$(readlink -f "$target") || continue; \
        cp -rL "$real" "${target}.real" 2>/dev/null && rm -f "$target" && mv "${target}.real" "$target" || true; \
      else \
        for link in "$target"/*; do \
          [ -L "$link" ] || continue; \
          real=$(readlink -f "$link") || continue; \
          tmp="${link}.real"; \
          cp -rL "$real" "$tmp" 2>/dev/null && rm -f "$link" && mv "$tmp" "$link" || true; \
        done; \
      fi; \
    done; \
    true

# Production stage
FROM base

# Install required system dependencies (including curl for healthcheck)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    ghostscript \
    graphicsmagick \
    openssl \
    libwebp-dev \
    libvips-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create upload directory
RUN mkdir -p /app/upload /app/data

# Copy built standalone output (much smaller than full node_modules)
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Next.js standalone output traces dependencies and creates partial node_modules
# entries (sometimes as files, not dirs) for prisma/sharp/@img/@prisma. Those
# stubs would block the full COPYs below with "cannot copy to non-directory".
# Remove the traced stubs first so the full materialised packages can be copied in.
RUN rm -rf node_modules/.prisma node_modules/@prisma node_modules/prisma \
           node_modules/sharp node_modules/@img

# Copy prisma CLI + engine (needed for migrate deploy in entrypoint)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy sharp native bindings from builder (already compiled for linux)
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
RUN chown -R nextjs:nodejs /app/data /app/upload
USER nextjs

EXPOSE 7331

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -sf http://localhost:7331/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
