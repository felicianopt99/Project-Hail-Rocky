# 🐳 Docker Setup Complete - Latest Technologies

Project Hail Rocky is now fully containerized with cutting-edge Docker technologies.

## ✅ What Was Implemented

### 1. **Modern Multi-Stage Dockerfile** (`frontend/Dockerfile`)
- `syntax=docker/dockerfile:1.4` (latest BuildKit syntax)
- **3 targets**: `base`, `deps-builder`, `dev`, `prod`
- BuildKit optimizations (caching, parallel layers)
- Tini process manager (proper signal handling)
- Health checks for container monitoring

```
Dev Target:   Vite dev server with hot reload
Prod Target:  Minimal production image with `serve`
```

### 2. **Docker Buildx Bake** (`docker-bake.hcl`)
Advanced multi-target, multi-platform builds:
- Targets: `frontend-dev`, `frontend-prod`, `all`, `prod`, `dev`
- Multi-platform support: `linux/amd64`, `linux/arm64`
- Registry caching for faster CI/CD builds
- Usage: `docker buildx bake -f docker-bake.hcl all`

### 3. **Three Compose Environments**
- **`docker-compose.yml`** - Default with profiles
- **`docker-compose.dev.yml`** - Development with hot reload
- **`docker-compose.prod.yml`** - Production hardened

#### Key Features:
- ✅ Docker Compose Watch (file sync + auto-restart)
- ✅ Health checks on all services
- ✅ Proper environment variable management
- ✅ Security capabilities dropped (prod)
- ✅ tmpfs for /tmp and /var/cache (prod)
- ✅ Service profiles for selective startup

### 4. **Advanced Caching**
Multiple cache strategies supported:
- **GitHub Actions**: `type=gha` (free in CI/CD)
- **Registry Cache**: `type=registry` (persistent)
- **Inline Cache**: Built into image
- **BuildKit Local**: Fast local rebuild

### 5. **Optimized .dockerignore Files**
- Root-level `.dockerignore` for all Docker operations
- `frontend/.dockerignore` for frontend-specific builds
- Excludes: node_modules, dist, .git, .vscode, etc.

### 6. **Makefile for Easy Management**
```bash
make docker-dev          # Start development
make docker-prod         # Start production
make docker-build        # Build dev image
make docker-bake         # Build all with buildx
make docker-logs         # View container logs
make buildkit-setup      # Initialize BuildKit
```

### 7. **GitHub Actions Workflow** (`.github/workflows/docker-build.yml`)
Automated Docker builds on:
- Push to `main` and `develop`
- Pull requests (build only, no push)
- Manual trigger with `workflow_dispatch`

Features:
- Multi-platform builds (amd64 + arm64)
- GitHub Actions cache for fast CI/CD
- Metadata extraction (tags, semver)
- Auto-push to GitHub Container Registry

### 8. **Documentation** (`DOCKER.md`)
Complete guide covering:
- Latest Docker technologies explained
- Quick start commands
- Environment configuration
- Image optimization details
- Troubleshooting guide
- CI/CD integration examples

---

## 🚀 Quick Start

### Development (Hot Reload)
```bash
# Option 1: Using dedicated dev compose
docker compose -f docker-compose.dev.yml up

# Option 2: Using Makefile
make docker-dev

# Option 3: Using BuildKit directly
make docker-build
```

Changes in `frontend/src/` reload **instantly** at `http://127.0.0.1:5173`

### Production
```bash
# Using production compose
docker compose -f docker-compose.prod.yml up

# Or with Makefile
make docker-prod
```

Serves at `http://127.0.0.1:3000`

---

## 📊 Image Specifications

### Development Image (`dev`)
- **Size**: ~477MB (with node_modules)
- **Base**: `node:22-bookworm-slim` + dependencies
- **Command**: `npm run dev -- --host 0.0.0.0`
- **Port**: 5173
- **Features**: HMR, debugging, full source

### Production Image (`prod`)
- **Size**: ~491MB (with dist/)
- **Base**: `node:22-bookworm-slim` + serve
- **Command**: `serve -s dist -l 3000`
- **Port**: 3000
- **Features**: Hardened, minimal, ready for deployment

---

## 🔒 Security Hardening (Production)

```yaml
# Capabilities
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE

# Security options
security_opt:
  - no-new-privileges:true

# tmpfs for sensitive files
tmpfs:
  - /tmp
  - /var/cache
```

---

## 🔧 Available Commands

```bash
# Development
make docker-dev              # Start with hot reload
make docker-build           # Build dev image

# Production
make docker-prod            # Start production
make docker-prod-build      # Build prod image

# Advanced
make docker-bake            # Build all targets
make docker-push            # Push to registry
make buildkit-setup         # Initialize BuildKit
make buildkit-inspect       # Show BuildKit status

# Utilities
make docker-logs            # Stream logs
make docker-shell           # Shell in container
make docker-clean           # Remove containers/images
make validate               # Validate all compose files
```

---

## 📁 New Files Added

```
.github/workflows/docker-build.yml    ← CI/CD automation
.dockerignore                         ← Updated root ignore
frontend/.dockerignore                ← Frontend-specific ignore
frontend/Dockerfile                   ← Multi-target (updated)
docker-bake.hcl                       ← BuildKit bake config
docker-compose.dev.yml                ← Development override
docker-compose.prod.yml               ← Production override
docker-compose.yml                    ← Default (with profiles)
Makefile                              ← Easy command shortcuts
DOCKER.md                             ← Full documentation
DOCKER_SETUP.md                       ← This file
```

---

## 🔄 Docker Compose Watch (Hot Reload)

Real-time file syncing without rebuilding:

```yaml
develop:
  watch:
    - action: sync+restart
      path: ./frontend/src
      target: /app/src
    - action: rebuild
      path: ./frontend/package.json
```

When you save in `src/`, the file syncs instantly to the container and the dev server reloads. Package.json changes trigger a full rebuild.

---

## 🎯 Workflow Examples

### Local Development
```bash
# Start with hot reload
docker compose -f docker-compose.dev.yml up

# Edit a component
vim frontend/src/App.tsx

# Browser auto-refreshes (HMR active)
# Changes are visible in ~200ms
```

### Building for Production
```bash
# Build optimized image
docker buildx bake -f docker-bake.hcl frontend-prod

# Start production container
docker compose -f docker-compose.prod.yml up

# Serve at http://localhost:3000
```

### CI/CD Pipeline
```bash
# GitHub Actions automatically:
# 1. Detects push to main
# 2. Builds dev and prod images
# 3. Uses GitHub Actions cache (fast)
# 4. Pushes to ghcr.io (GitHub Container Registry)
```

---

## 🛠️ Troubleshooting

### Port Already in Use
```bash
# Kill container using port
docker compose -f docker-compose.dev.yml down

# Or change port in compose file
```

### Hot Reload Not Working
```bash
# Rebuild with fresh cache
docker compose -f docker-compose.dev.yml up --build

# Check if files are syncing
docker exec rocky-frontend-dev ls -la src/
```

### Build Cache Issues
```bash
# Clear all Docker cache
docker builder prune -f
docker system prune -f

# Rebuild without cache
docker build --no-cache -f frontend/Dockerfile -t rocky-frontend:latest ./frontend
```

### Container Won't Start
```bash
# Check logs
docker logs rocky-frontend-dev

# Inspect container
docker inspect rocky-frontend-dev

# Check compose file
docker compose -f docker-compose.dev.yml config
```

---

## 📚 Next Steps

1. **Update documentation**: Add Docker commands to team wiki
2. **CI/CD secrets**: Configure GitHub secrets for `NVIDIA_API_KEY`, etc.
3. **Registry setup**: Configure Docker registry if pushing to private registry
4. **Monitoring**: Add Prometheus/Grafana for container metrics (optional)
5. **Networking**: Switch from `host` mode to bridge network if needed

---

## 🔗 References

- [DOCKER.md](./DOCKER.md) - Complete Docker guide
- [docker-compose.yml](./docker-compose.yml) - Default configuration
- [docker-compose.dev.yml](./docker-compose.dev.yml) - Development environment
- [docker-compose.prod.yml](./docker-compose.prod.yml) - Production environment
- [docker-bake.hcl](./docker-bake.hcl) - BuildKit configuration
- [Makefile](./Makefile) - Command shortcuts

---

## ✨ Summary

✅ **BuildKit** enabled for faster, more secure builds
✅ **Multi-target Dockerfile** for dev and production
✅ **Docker Compose Watch** for hot reload development
✅ **Health checks** for all services
✅ **Security hardening** in production
✅ **GitHub Actions** for automated builds
✅ **Advanced caching** for CI/CD speed
✅ **Makefile** for easy command shortcuts
✅ **Complete documentation** included

**Everything is containerized. Let's go! 🚀**
