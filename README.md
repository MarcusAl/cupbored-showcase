# cupbored.ai

An AI-powered food and drink pairing engine. Give it an ingredient, and it uses Anthropic's Claude to find complementary pairings with strength scores, confidence ratings, and tasting notes.

> The source code is in a private repository. This showcase highlights the architecture, tech stack, and API design.

## Tech Stack

| Layer | Technology |
|---|---|
| **API** | Ruby on Rails 8 (API-only mode) |
| **AI** | Anthropic Claude API for pairing generation |
| **Database** | PostgreSQL with UUID primary keys |
| **Background Jobs** | Sidekiq + Redis |
| **Auth** | Token-based authentication (`has_secure_password` + signed session tokens) |
| **API Docs** | OpenAPI 3.0 via rswag (auto-generated from request specs) |
| **Infrastructure** | Terraform → AWS (EC2, RDS, ElastiCache, ALB, ECR) |
| **CI** | GitHub Actions (RSpec, RuboCop, Brakeman security scanning) |
| **Local Infra** | LocalStack for AWS service emulation |

## Architecture

```
cupbored.ai/
├── api/                  # Rails 8 API-only application
│   ├── app/
│   │   ├── controllers/api/v1/   # Versioned API controllers
│   │   ├── models/               # ActiveRecord models
│   │   ├── serializers/          # Custom serializer layer
│   │   ├── services/             # PairingService (Anthropic integration)
│   │   └── jobs/                 # PairingJob (async AI generation)
│   └── swagger/                  # OpenAPI spec (auto-generated)
├── terraform-setup/      # Full AWS infrastructure as code
└── mobile/               # React Native + Expo (planned)
```

## API Design

All endpoints are versioned under `/api/v1/` with Bearer token authentication.

### Authentication

```bash
# Sign up
POST /api/v1/sign_up
{ "email": "user@example.com", "password": "..." }

# Sign in → returns session token in response body
POST /api/v1/sign_in
→ { "data": { "session": {...}, "token": "eyJ..." } }

# Use token for authenticated requests
Authorization: Bearer eyJ...
```

### Core Resources

| Endpoint | Methods | Description |
|---|---|---|
| `/api/v1/items` | GET, POST, PATCH, DELETE | Manage food/drink ingredients |
| `/api/v1/pairings` | GET, POST, PATCH, DELETE | AI-generated pairing suggestions |
| `/api/v1/sessions` | GET, DELETE | Session management |
| `/api/v1/password` | PATCH | Password updates |
| `/api/v1/identity/email` | PATCH | Email updates with re-verification |
| `/api/v1/identity/email_verification` | GET, POST | Email verification flow |
| `/api/v1/identity/password_reset` | GET, POST, PATCH | Password reset flow |

### Filtering & Pagination

```bash
# Filter items by category and search
GET /api/v1/items?by_category=protein&search=steak

# Filter pairings by strength and visibility
GET /api/v1/pairings?by_strength=8&public_pairings=true

# All list endpoints return paginated responses
→ { "data": [...], "meta": { "page": 1, "pages": 5, "count": 47 } }
```

## How Pairings Work

1. User creates an **item** (e.g., "Wagyu Ribeye" with category "protein" and an image)
2. User requests a **pairing** for that item
3. A background job sends the item to **Anthropic's Claude** with a structured prompt
4. Claude returns complementary ingredients with:
   - **Strength score** (1-10) — how well the items pair together
   - **Confidence score** — model's confidence in the suggestion
   - **Pairing notes** — explanation of why the pairing works
5. Results are persisted and available via the API

## Serialization

Custom lightweight serializer layer (no gems) with a base class pattern:

```ruby
# Whitelist-only — new fields must be explicitly exposed
class UserSerializer < BaseSerializer
  attributes :id, :email, :verified, :created_at, :updated_at
end

# password_digest and other sensitive fields are never exposed
```

## Infrastructure

Terraform manages the full AWS stack:

- **EC2** — containerised Rails + Sidekiq (Docker)
- **RDS** — PostgreSQL 15 with automated snapshots
- **ElastiCache** — Redis for Sidekiq and caching
- **ALB** — Application Load Balancer with health checks
- **ECR** — Docker image registry
- **SSM** — Secrets management (Rails master key)
- **VPC** — Private subnets for database and Redis, public for API

CORS is configured via environment variables for multi-client support.

## CI Pipeline

GitHub Actions runs on every PR and push to main:

1. **Lint** — RuboCop on changed files only (fast feedback)
2. **Security** — Brakeman static analysis for Rails vulnerabilities
3. **Test** — Full RSpec suite against PostgreSQL

## API Documentation

Interactive API docs are available via Swagger UI at `/api-docs` when the server is running. The OpenAPI spec is auto-generated from rswag request specs, ensuring documentation stays in sync with the actual API behaviour.

## Planned

- React Native mobile app (Expo + TypeScript)
- OpenAPI contract sync between Rails and mobile via `openapi-typescript`
- Auth0 PKCE flow for mobile authentication

## Contact

Marcus Allen — marcusgrantee@gmail.com

## License

Proprietary. All rights reserved.
