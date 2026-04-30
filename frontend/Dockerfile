# syntax=docker/dockerfile:1.4

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl tini && \
    rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/sbin/tini", "--"]

FROM base AS deps-builder
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

FROM deps-builder AS builder
COPY . .
RUN npm run build

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps-builder /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5173/ || exit 1
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM base AS prod
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
ENV NODE_ENV=production
RUN npm install -g serve
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1
CMD ["serve", "-s", "dist", "-l", "3000"]
