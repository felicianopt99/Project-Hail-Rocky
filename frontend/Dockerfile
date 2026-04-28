# Use latest Node.js as base
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Dependency stage
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Builder stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Runner stage
FROM base AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/index.html ./index.html

# Start the Vite dev server for now (as requested for dev environment)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
