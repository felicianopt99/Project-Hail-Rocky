.PHONY: help docker-build docker-dev docker-prod docker-push docker-bake docker-clean

DOCKER_REGISTRY := localhost:5000
FRONTEND_IMAGE := rocky-frontend
FRONTEND_TAG := latest

help:
	@echo "Project Hail Rocky - Docker Commands"
	@echo "===================================="
	@echo "make docker-dev      - Start development environment with hot reload"
	@echo "make docker-prod     - Start production environment"
	@echo "make docker-build    - Build Docker images with BuildKit"
	@echo "make docker-bake     - Build all targets with docker buildx bake"
	@echo "make docker-push     - Push images to registry"
	@echo "make docker-clean    - Clean up Docker resources"
	@echo "make docker-logs     - View container logs"
	@echo "make docker-shell    - Open shell in frontend container"

docker-dev:
	@echo "Starting development environment..."
	docker compose -f docker-compose.dev.yml up --build

docker-prod:
	@echo "Starting production environment..."
	docker compose -f docker-compose.prod.yml up --build

docker-build:
	@echo "Building with BuildKit..."
	DOCKER_BUILDKIT=1 docker build \
		--target dev \
		-f frontend/Dockerfile \
		-t $(FRONTEND_IMAGE):dev \
		./frontend

docker-bake:
	@echo "Building all targets with docker buildx bake..."
	docker buildx bake -f docker-bake.hcl all

docker-prod-build:
	@echo "Building production image..."
	DOCKER_BUILDKIT=1 docker build \
		--target prod \
		--cache-from type=registry,ref=$(DOCKER_REGISTRY)/$(FRONTEND_IMAGE):cache \
		--cache-to type=registry,ref=$(DOCKER_REGISTRY)/$(FRONTEND_IMAGE):cache,mode=max \
		-f frontend/Dockerfile \
		-t $(FRONTEND_IMAGE):prod \
		-t $(FRONTEND_IMAGE):$(FRONTEND_TAG) \
		./frontend

docker-push:
	@echo "Pushing images to registry..."
	docker tag $(FRONTEND_IMAGE):dev $(DOCKER_REGISTRY)/$(FRONTEND_IMAGE):dev
	docker tag $(FRONTEND_IMAGE):prod $(DOCKER_REGISTRY)/$(FRONTEND_IMAGE):prod
	docker push $(DOCKER_REGISTRY)/$(FRONTEND_IMAGE):dev
	docker push $(DOCKER_REGISTRY)/$(FRONTEND_IMAGE):prod

docker-clean:
	@echo "Cleaning Docker resources..."
	docker compose -f docker-compose.dev.yml down --volumes
	docker compose -f docker-compose.prod.yml down --volumes
	docker image prune -f
	docker builder prune -f

docker-logs:
	docker compose logs -f --tail=100

docker-shell:
	docker compose exec frontend sh

docker-inspect-frontend:
	docker inspect $$(docker ps -q -f "ancestor=$(FRONTEND_IMAGE):dev")

buildkit-setup:
	@echo "Setting up BuildKit builder..."
	docker buildx create --name rocky-builder --driver docker-container || true
	docker buildx use rocky-builder

buildkit-inspect:
	docker buildx inspect --bootstrap

validate:
	@echo "Validating docker-compose files..."
	docker compose -f docker-compose.yml config > /dev/null
	docker compose -f docker-compose.dev.yml config > /dev/null
	docker compose -f docker-compose.prod.yml config > /dev/null
	@echo "✓ All compose files are valid"
