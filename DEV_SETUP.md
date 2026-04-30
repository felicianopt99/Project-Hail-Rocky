# 🚀 Rocky Development Setup

## Quick Start (30 seconds)

```bash
# 1. Clean start
./dev.sh reset

# 2. Done! Dev server ready at:
#    - Frontend: http://127.0.0.1:5173
#    - Test page: http://127.0.0.1:5173/test-openclaw-v2.html
```

## What's Fixed

✅ **React/ReactDOM export error** - Node modules now properly isolated in container
✅ **Hot reload** - Source code changes sync instantly
✅ **Vite cache** - Dedicated volume prevents corruption
✅ **Health checks** - Services wait for dependencies
✅ **Volume caching** - Better performance with :cached mounts

## Commands

### `./dev.sh start` (default)
Starts development environment with watch mode.
- Automatically rebuilds on code changes
- Shows logs in real-time
- Press Ctrl+C to stop

### `./dev.sh stop`
Stop all containers without removing volumes.

### `./dev.sh logs`
Show logs from all services.

### `./dev.sh logs-frontend`
Show frontend logs only.

### `./dev.sh logs-gateway`
Show OpenClaw gateway logs.

### `./dev.sh reset`
Complete reset:
1. Stop containers
2. Remove all volumes
3. Clean Docker system
4. Rebuild images from scratch
5. Start fresh

Use when you encounter stuck state or cache corruption.

### `./dev.sh shell`
Open bash in frontend container for debugging.

### `./dev.sh npm [command]`
Run npm commands inside container.

Examples:
```bash
./dev.sh npm install
./dev.sh npm audit fix
./dev.sh npm run type-check
```

## Accessing Services

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://127.0.0.1:5173 | React dev server |
| Test Page | http://127.0.0.1:5173/test-openclaw-v2.html | OpenClaw testing |
| OpenClaw | ws://127.0.0.1:18789 | Gateway WebSocket |
| Home Assistant | http://127.0.0.1:8123 | HA admin panel |

## Architecture

```
Host Machine
├── frontend/src → (mounts as) → Container /app/src
├── frontend/public → (mounts as) → Container /app/public
└── frontend/node_modules → (isolated in container volume)

Container Volumes:
├── /app/node_modules (separate, not synced)
├── /app/.vite (Vite cache)
├── /app/dist (build output)
└── frontend-vite-cache (persistent cache)
```

This setup allows:
- **Fast hot reload** - Only source files sync
- **Clean environment** - No host node_modules pollution
- **Cache persistence** - Rebuild is faster on restart
- **Proper dependencies** - Container has correct Node version

## Troubleshooting

### React export error again?
```bash
./dev.sh reset
```

### Port 5173 already in use?
```bash
# Find and kill the process
lsof -i :5173
kill -9 <PID>

# Or just restart
./dev.sh reset
```

### Changes not reflecting?
1. Check logs: `./dev.sh logs-frontend`
2. If cache issue: `./dev.sh reset`
3. If stuck: Kill container and restart

### OpenClaw not responding?
```bash
./dev.sh logs-gateway
# Check if gateway is healthy
docker ps | grep rocky-gateway-dev
```

### Container keeps restarting?
```bash
# Check full logs
./dev.sh logs

# Try reset
./dev.sh reset
```

## Development Workflow

### 1. Start environment
```bash
./dev.sh start
```

### 2. Make code changes
```bash
# Edit frontend/src/App.tsx or any other file
# Changes auto-sync to container
# Vite hot reload triggers automatically
```

### 3. View in browser
- Open http://127.0.0.1:5173
- Refresh if needed
- Check browser console (F12) for errors

### 4. Test OpenClaw integration
- Open http://127.0.0.1:5173/test-openclaw-v2.html
- Run tests and capture results

### 5. Commit when ready
```bash
# Stop dev server first
Ctrl+C

# Then commit
git add .
git commit -m "..."
```

## Performance Tips

### Hot Reload Too Slow?
- Check logs: `./dev.sh logs-frontend`
- Vite should compile in < 500ms
- If slower, you may have infinite loops or expensive operations

### Container Using Too Much CPU?
- Node dev server is normal ~5-10% usage
- If >25%: something is wrong, check logs

### Disk Space Issues?
- `docker system prune -f --volumes` removes unused volumes
- `./dev.sh reset` also cleans up

## File Structure

```
Project Root
├── dev.sh              ← Your command
├── docker-compose.dev.yml
├── frontend/
│   ├── Dockerfile     ← Multi-stage: base, deps, dev, prod
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
└── brain/
    └── .openclaw/     ← Gateway config
```

## Network

**Development** uses `network_mode: host` because:
- ✅ OpenClaw gateway needs TCP socket (port 10400)
- ✅ Home Assistant WebSocket integration
- ✅ Easier debugging (no port mapping complexity)

**Production** should use bridge networking (separate task).

## Next Steps

1. **Test OpenClaw**
   ```bash
   open http://127.0.0.1:5173/test-openclaw-v2.html
   ```

2. **Fill test results**
   ```bash
   # Document your findings
   vim TEST_RESULTS_TEMPLATE.md
   ```

3. **Fix socket.ts if needed**
   Based on test findings, update `frontend/src/lib/socket.ts`

4. **Add persistence**
   Implement chat history localStorage

---

**Everything clear?** Start dev with: `./dev.sh start` 🚀
