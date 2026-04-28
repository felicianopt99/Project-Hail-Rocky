# Use latest Node.js Debian Slim as base
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Dependency stage
FROM base AS deps
COPY package.json package-lock.json ./
# Install all dependencies (including dev for building and tsx)
RUN npm ci

# Builder stage
FROM base AS builder
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma Client
RUN npx prisma generate
# Build the Vite frontend
RUN npm run build

# Runner stage
FROM base AS runner
# Install dependencies needed for Prisma, native modules, and audio processing
RUN apt-get update && apt-get install -y openssl ffmpeg libcap2 curl wget && rm -rf /var/lib/apt/lists/*

# ENV NODE_ENV is set by docker-compose or defaults to production if not provided

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy only the necessary files
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/server.ts ./server.ts
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nodejs:nodejs /app/src ./src
COPY --from=builder --chown=nodejs:nodejs /app/index.html ./index.html
COPY --from=builder --chown=nodejs:nodejs /app/vite.config.ts ./vite.config.ts
COPY --from=builder --chown=nodejs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nodejs:nodejs /app/models ./models
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/.env* ./

# Ensure data directory exists and has correct permissions
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# Entrypoint script to handle migrations and start the server
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'npx prisma db push --accept-data-loss' >> /app/entrypoint.sh && \
    echo 'npx tsx server.ts' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

USER nodejs

EXPOSE 3005

CMD ["sh", "/app/entrypoint.sh"]

