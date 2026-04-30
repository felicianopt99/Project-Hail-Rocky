# Docker Setup - Latest Technologies

Project Hail Rocky is fully containerized with modern Docker best practices.

## Latest Docker Technologies Implemented

### 1. **BuildKit** (Modern Build System)
- Syntax: `syntax=docker/dockerfile:1.4`
- Faster builds with layer caching
- Inline cache for better CI/CD integration
- Security scanning with `SBOM` support

```bash
# Enable BuildKit
export DOCKER_BUILDKIT=1

# Or use docker buildx
docker buildx bake -f docker-bake.hcl all
```

### 2. **Multi-Target Builds**
Separate optimized images for development and production:

```dockerfile
FROM node:22 AS base
FROM base AS dev      # Development with hot reload
FROM base AS prod     # Production with minimal footprint
```

**Development Target (`dev`)**
- 400MB+ (includes node_modules, source code)
- Vite dev server with HMR
- Full debugging capabilities
- Used locally: `docker-compose.dev.yml`

**Production Target (`prod`)**
- 100MB+ (minimal, only dist/ and serve)
- Precompiled bundle via `serve`
- Security hardening (read-only root filesystem)
- Used in deployment: `docker-compose.prod.yml`

### 3. **Docker Compose Watch** (Hot Reload)
Real-time file syncing with automatic restart:

```yaml
develop:
  watch:
    - action: sync+restart
      path: ./frontend/src
      target: /app/src
    - action: rebuild
      path: ./frontend/package.json
```

Run: `docker compose -f docker-compose.dev.yml up`

When you save a file in `./frontend/src`, it's instantly synced into the container and the app reloads.

### 4. **Health Checks**
Automatic container health monitoring:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5173/"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 5s
```

Check health: `docker ps` shows `(healthy)` or `(unhealthy)`

### 5. **Advanced Caching Strategies**
Multiple cache backends:

- **Inline Cache**: Built into image, good for registries
- **GitHub Actions Cache**: Free cache for CI/CD
- **Registry Cache**: Persistent cache in Docker registry
- **BuildKit Local Cache**: Local disk cache for repeatable builds

```hcl
# docker-bake.hcl
cache-from = ["type=gha"]  # GitHub Actions
cache-to   = ["type=gha,mode=max"]
```

### 6. **Profiles** (Selective Service Startup)
Run only what you need:

```bash
# Start only frontend
docker compose --profile frontend up

# Start all services
docker compose --profile full up

# Or use compose files
docker compose -f docker-compose.dev.yml up
```

### 7. **Security Hardening** (Production)
```yaml
security_opt:
  - no-new-privileges:true
read_only_root_filesystem: true
tmpfs:
  - /tmp
  - /var/cache
```

### 8. **Tini Process Manager**
Proper signal handling and zombie process cleanup:

```dockerfile
RUN apt-get install -y tini
ENTRYPOINT ["/sbin/tini", "--"]
```

### 9. **BuildKit Inline Cache**
Enable BuildKit and inline cache in Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1.4
RUN --mount=type=cache,target=/root/.npm npm ci
```

---

## Quick Start

### Development (Hot Reload)
```bash
# Option 1: Using docker-compose.dev.yml
docker compose -f docker-compose.dev.yml up

# Option 2: Using Makefile
make docker-dev

# Option 3: Pure BuildKit
make docker-build
```

File changes in `src/` reload instantly in the browser at `http://127.0.0.1:5173`

### Production
```bash
# Using docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up

# Or with Makefile
make docker-prod
```

Serves at `http://127.0.0.1:3000`

---

## Available Make Commands

```bash
make docker-dev           # Start with hot reload
make docker-prod          # Start production build
make docker-build         # Build dev image
make docker-bake          # Build all with buildx
make docker-push          # Push to registry
make docker-clean         # Clean containers & images
make docker-logs          # Stream container logs
make docker-shell         # Open shell in frontend
buildkit-setup            # Initialize BuildKit builder
validate                  # Validate compose files
```

---

## Environment Configuration

### Required Environment Variables
Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
# Edit .env with your actual values:
# - NVIDIA_API_KEY
# - GROQ_API_KEY
# - GEMINI_API_KEY
# - HA_ACCESS_TOKEN
```

### Environment Files
- `.env` - Local secrets (not committed)
- `.env.example` - Template for required variables
- `docker-compose.yml` - Default (uses profiles)
- `docker-compose.dev.yml` - Development override
- `docker-compose.prod.yml` - Production override

---

## Image Optimization

### Frontend Image Sizes

**Development (`dev` target)**
- Base: node:22-bookworm-slim (400MB)
- With node_modules + src: ~400MB total
- Purpose: Fast iteration, debugging

**Production (`prod` target)**
- Base: node:22-bookworm-slim (100MB)
- Only prebuilt dist: ~100MB total
- Uses `serve` instead of Vite
- Security hardened (no root, read-only FS)

### Cache Efficiency
1. Dependencies changed → `npm ci` (3-5s cached)
2. Source code changed → Sync only (`<1s` via watch)
3. package.json changed → Full rebuild (~30s)

---

## Docker Buildx Bake

Advanced multi-platform builds:

```bash
# Build for multiple architectures
docker buildx bake -f docker-bake.hcl --push

# Build specific target
docker buildx bake -f docker-bake.hcl frontend-dev

# Load to local Docker (instead of registry)
docker buildx bake -f docker-bake.hcl frontend-prod --load
```

**Bake targets:**
- `frontend-dev` - Development image
- `frontend-prod` - Production image
- `all` - Both targets
- `prod` - Production only
- `dev` - Development only

---

## Networking

### Local Development
All services use `network_mode: host` for direct host access:
- Frontend: `http://127.0.0.1:5173`
- OpenClaw Gateway: `ws://127.0.0.1:18789`
- Home Assistant: `http://127.0.0.1:8123`

### Production Network
For containerized networks (future), use:
```yaml
networks:
  rocky-net:
    driver: bridge

services:
  frontend:
    networks:
      - rocky-net
    environment:
      - VITE_BACKEND_URL=ws://openclaw-gateway:18789
```

---

## Troubleshooting

### Build Issues
```bash
# Clear build cache
docker builder prune -f

# Rebuild without cache
docker build --no-cache -f frontend/Dockerfile -t rocky-frontend:dev ./frontend

# Inspect build layers
docker history rocky-frontend:dev
```

### Container Issues
```bash
# Check logs
docker logs rocky-frontend-dev

# Inspect container
docker inspect rocky-frontend-dev

# Check health
docker ps | grep rocky-frontend
```

### Hot Reload Not Working
```bash
# Restart with watch rebuild
docker compose -f docker-compose.dev.yml up --build

# Check file sync
docker exec rocky-frontend-dev ls -la src/
```

---

## CI/CD Integration

### GitHub Actions
Uses `type=gha` cache:
```bash
docker buildx build --cache-from type=gha --cache-to type=gha,mode=max
```

### Container Registry
For Docker Hub, GitHub Container Registry, etc:
```bash
# Push to registry
docker buildx bake --push -f docker-bake.hcl

# Pull from registry
docker pull myregistry.azurecr.io/rocky-frontend:latest
```

---

## References

- [Docker Buildx Documentation](https://docs.docker.com/engine/reference/commandline/buildx/)
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Docker Compose Watch](https://docs.docker.com/compose/file-watch/)
- [BuildKit Secrets & Cache Mounts](https://docs.docker.com/build/building/secrets/)
