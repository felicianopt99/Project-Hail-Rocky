.PHONY: help up down logs build dev ha voice ovos letta full backend-shell frontend-shell hash-password download-models lint typecheck test

help:
	@echo "Project Hail Rocky"
	@echo "=================="
	@echo "--- Core ---"
	@echo "make up              - Start backend + frontend + redis"
	@echo "make down            - Stop all containers"
	@echo "make logs            - Tail all logs"
	@echo "make logs-backend    - Tail backend logs"
	@echo "make logs-frontend   - Tail frontend logs"
	@echo "make build           - Rebuild all images"
	@echo "make dev             - Start with hot reload (docker watch)"
	@echo "--- Profiles ---"
	@echo "make ha              - + Home Assistant"
	@echo "make ovos            - + OVOS skills engine (Phase 3)"
	@echo "make letta           - + Letta + Postgres + Qdrant (Phase 5)"
	@echo "make full            - Everything"
	@echo "--- Validation (run before declaring a task done) ---"
	@echo "make lint            - ruff (backend) + eslint (frontend)"
	@echo "make typecheck       - mypy (backend) + tsc (frontend)"
	@echo "make check           - Run comprehensive system health check"
	@echo "make test            - pytest (backend) + vitest (frontend)"
	@echo "make qa              - Run massive automated QA battery + generate reports"
	@echo "--- Utils ---"
	@echo "make hash-password   - Generate bcrypt hash for ADMIN_PASSWORD_HASH"
	@echo "make backend-shell   - Shell in backend container"
	@echo "make frontend-shell  - Shell in frontend container"
	@echo "make download-models - Download Vosk + Silero VAD models"

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

logs-backend:
	docker compose logs -f --tail=100 backend

logs-frontend:
	docker compose logs -f --tail=100 frontend

build:
	docker compose build

dev:
	docker compose up --watch

ha:
	docker compose --profile ha up -d

voice:
	docker compose --profile voice up -d

ovos:
	docker compose --profile ovos up -d

letta:
	docker compose --profile letta up -d

full:
	docker compose --profile full up -d

lint:
	docker compose exec backend ruff check app/
	cd frontend && npm run lint

typecheck:
	docker compose exec backend mypy app/ --ignore-missing-imports
	cd frontend && npx tsc --noEmit

test:
	docker compose exec -e PYTHONPATH=/app backend pytest tests/unit tests -v
	cd frontend && npm test -- --run

check:
	python3 scripts/system_check.py

hash-password:
	@read -p "Password: " pw; python3 -c "from passlib.context import CryptContext; print(CryptContext(['bcrypt']).hash('$$pw'))"

backend-shell:
	docker compose exec backend sh

frontend-shell:
	docker compose exec frontend sh

download-models:
	python3 scripts/download_models.py

qa:
	python3 scripts/qa_orchestrator.py
