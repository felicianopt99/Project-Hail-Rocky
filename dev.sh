#!/bin/bash

# Rocky Development Environment Starter
# Usage: ./dev.sh [command]
# Commands:
#   start    - Start development environment with hot reload
#   stop     - Stop all containers
#   logs     - Show logs
#   reset    - Full reset (clean + rebuild)
#   help     - Show this help

set -e

COMPOSE_FILE="docker-compose.dev.yml"
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"

echo "🚀 Rocky Development Environment"
echo ""

case "${1:-start}" in
  start)
    echo "📦 Starting containers with hot reload..."
    echo ""
    echo "✅ Frontend: http://127.0.0.1:5173"
    echo "✅ Test page: http://127.0.0.1:5173/test-openclaw-v2.html"
    echo "✅ OpenClaw: ws://127.0.0.1:18789"
    echo "✅ Home Assistant: http://127.0.0.1:8123"
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""

    if command -v docker &> /dev/null; then
      $COMPOSE_CMD up --watch
    else
      echo "❌ Docker not found. Please install Docker."
      exit 1
    fi
    ;;

  stop)
    echo "🛑 Stopping containers..."
    $COMPOSE_CMD down
    echo "✅ Stopped"
    ;;

  logs)
    echo "📊 Showing logs (Ctrl+C to exit)..."
    echo ""
    $COMPOSE_CMD logs -f
    ;;

  logs-frontend)
    echo "📊 Frontend logs only..."
    $COMPOSE_CMD logs -f rocky-frontend-dev
    ;;

  logs-gateway)
    echo "📊 OpenClaw gateway logs..."
    $COMPOSE_CMD logs -f rocky-gateway-dev
    ;;

  reset)
    echo "🔄 Full reset..."
    echo ""
    echo "1️⃣ Stopping containers..."
    $COMPOSE_CMD down || true

    echo "2️⃣ Removing volumes..."
    docker volume rm frontend-vite-cache ha-config-dev 2>/dev/null || true

    echo "3️⃣ Cleaning Docker..."
    docker system prune -f --volumes

    echo "4️⃣ Rebuilding..."
    $COMPOSE_CMD build --no-cache

    echo "5️⃣ Starting fresh..."
    $COMPOSE_CMD up --watch
    ;;

  shell)
    echo "🔧 Opening shell in frontend container..."
    $COMPOSE_CMD exec rocky-frontend-dev /bin/bash
    ;;

  npm)
    shift
    echo "📦 Running npm command: npm $@"
    $COMPOSE_CMD exec rocky-frontend-dev npm "$@"
    ;;

  help|--help|-h)
    cat "$0" | grep "^#" | tail -n +3
    ;;

  *)
    echo "❌ Unknown command: $1"
    echo ""
    cat "$0" | grep "^#" | tail -n +3
    exit 1
    ;;
esac
