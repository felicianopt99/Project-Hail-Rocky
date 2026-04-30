# Docker Buildx Bake - Latest BuildKit features
# Run: docker buildx bake -f docker-bake.hcl [target]

group "default" {
  targets = ["frontend-dev", "frontend-prod"]
}

group "all" {
  targets = ["frontend-dev", "frontend-prod"]
}

group "prod" {
  targets = ["frontend-prod"]
}

group "dev" {
  targets = ["frontend-dev"]
}

# Development target with hot reload
target "frontend-dev" {
  dockerfile = "frontend/Dockerfile"
  target = "dev"
  args = {
    BUILDKIT_INLINE_CACHE = "1"
  }
  cache-from = ["type=registry,ref=localhost:5000/rocky-frontend:cache"]
  cache-to   = ["type=registry,ref=localhost:5000/rocky-frontend:cache,mode=max"]
  tags = [
    "rocky-frontend:dev",
    "localhost:5000/rocky-frontend:latest"
  ]
  output = ["type=docker"]
}

# Production target with minimal footprint
target "frontend-prod" {
  dockerfile = "frontend/Dockerfile"
  target = "prod"
  args = {
    BUILDKIT_INLINE_CACHE = "1"
  }
  cache-from = ["type=registry,ref=localhost:5000/rocky-frontend:cache"]
  cache-to   = ["type=registry,ref=localhost:5000/rocky-frontend:cache,mode=max"]
  tags = [
    "rocky-frontend:prod",
    "rocky-frontend:latest",
    "localhost:5000/rocky-frontend:prod"
  ]
  output = ["type=docker"]
  platforms = ["linux/amd64", "linux/arm64"]
}
