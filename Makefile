.PHONY: dev-backend dev-frontend tunnel types lint test check

dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && pnpm dev

# Phones need HTTPS for camera and mic. Open the printed URL on the phone.
tunnel:
	cloudflared tunnel --url http://localhost:5173

# Regenerate frontend API types from the backend's OpenAPI spec. Run after changing Pydantic models.
types:
	cd backend && uv run python -c "import json; from app.main import app; print(json.dumps(app.openapi()))" > ../frontend/openapi.json
	cd frontend && pnpm exec openapi-typescript openapi.json --default-non-nullable false -o src/api-types.ts && rm openapi.json

# Backend tests against a throwaway Postgres (Docker) with the real migration and fake AI providers.
test:
	backend/tests/run_with_db.sh -q

# Live checks against Supabase, Meta, Gemini and SerpApi using real keys. Secrets are redacted.
check:
	cd backend && uv run python -m scripts.check_services

lint:
	cd backend && uv run ruff check app tests scripts && uv run ruff format --check app tests scripts
	cd frontend && pnpm exec tsc -b && pnpm lint
