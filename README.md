# cupbored.ai

An AI-powered ingredient detection and recipe matching platform. Snap a photo of ingredients, and it uses Anthropic's Claude Vision to identify them, then surfaces trending community matches with fuzzy search, bookmarking, and cuisine preferences.

> The source code is in a private repository. This showcase highlights the architecture, tech stack, and API design.

## Tech Stack

| Layer | Technology |
|---|---|
| **API** | Ruby on Rails 8.1 (API-only mode) |
| **AI** | Anthropic Claude Vision API (ingredient detection from images) |
| **Database** | PostgreSQL with UUID primary keys, `pg_trgm` for fuzzy search |
| **Background Jobs** | Sidekiq + Redis |
| **Storage** | Active Storage with AWS S3 (image uploads) |
| **Auth** | Token-based authentication (`has_secure_password` + signed session tokens) |
| **API Docs** | OpenAPI 3.0 via rswag (auto-generated from request specs) |
| **Infrastructure** | Terraform → AWS (EC2, RDS, ElastiCache, ALB, ECR, S3) |
| **CI** | GitHub Actions (RSpec, RuboCop, Brakeman security scanning) |
| **Local Infra** | LocalStack for AWS service emulation |

## Architecture

```
cupbored.ai/
├── api/                  # Rails 8.1 API-only application
│   ├── app/
│   │   ├── controllers/api/v1/   # Versioned API controllers
│   │   ├── models/               # ActiveRecord models with PG enums
│   │   ├── services/             # Service objects (ApplicationService pattern)
│   │   │   └── scans/            # AI pipeline (DetectIngredients, ProcessImage, etc.)
│   │   └── jobs/                 # ScanProcessingJob, UpdateTrendingCountsJob
│   └── swagger/                  # OpenAPI spec (auto-generated)
├── terraform-setup/      # Full AWS infrastructure as code
└── mobile/               # React Native + Expo (planned)
```

## Core Domain

### Scan → Detect → Match → Explore

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  User snaps │────▶│  ScanProcessingJob   │────▶│  Match created  │
│  a photo    │     │  (Claude Vision AI)  │     │  (public/private)│
└─────────────┘     └──────────────────────┘     └─────────────────┘
                              │                           │
                    ┌─────────▼─────────┐        ┌───────▼────────┐
                    │  ScanIngredients  │        │  Explore page  │
                    │  (name, category, │        │  (trending,    │
                    │   confidence)     │        │   search,      │
                    └───────────────────┘        │   bookmarks)   │
                                                 └────────────────┘
```

1. User uploads an image via **Scans** endpoint
2. **ScanProcessingJob** dispatches to the AI service pipeline:
   - `Scans::DetectIngredients` — sends image to Claude Vision, parses structured JSON response
   - `Scans::ValidateDetection` — validates the image contains food/ingredients
   - `Scans::ProcessImage` — orchestrates detection, validation, and ingredient persistence
3. Detected ingredients are stored as **ScanIngredients** (name, raw_name, category, confidence)
4. User publishes a **Match** from a completed scan to share with the community
5. Community **explores** matches via trending scores, fuzzy ingredient search, and bookmarks

### Services Layer

All business logic lives in service objects following an `ApplicationService` base class with `.call(...)`:

| Service | Responsibility |
|---|---|
| `Scans::DetectIngredients` | Claude Vision API integration, JSON parsing, schema validation |
| `Scans::ValidateDetection` | Ensures scan contains valid food items (rejects non-food images) |
| `Scans::ProcessImage` | Orchestrates the full detection pipeline with state transitions |
| `Scans::PurgeImage` | Cleans up stored images on scan failure |

## API Design

All endpoints are versioned under `/api/v1/` with Bearer token authentication.

### Authentication

```bash
# Sign up
POST /api/v1/sign_up
{ "email": "user@example.com", "password": "..." }

# Sign in → returns session token
POST /api/v1/sign_in
→ { "data": { "session": {...}, "token": "eyJ..." } }

# Use token for authenticated requests
Authorization: Bearer eyJ...
```

### Core Resources

| Endpoint | Methods | Description |
|---|---|---|
| `/api/v1/scans` | GET, POST | Upload images for AI ingredient detection |
| `/api/v1/matches` | GET, POST | Publish scans and explore community matches |
| `/api/v1/bookmarks` | POST, DELETE | Save/unsave matches |
| `/api/v1/profile/cuisine_preferences` | GET, PUT | Manage cuisine preference list |
| `/api/v1/profile/cuisine_suggestions` | POST | Suggest new cuisines for the platform |
| `/api/v1/sessions` | GET, DELETE | Session management |
| `/api/v1/password` | PATCH | Password updates |
| `/api/v1/identity/email` | PATCH | Email updates with re-verification |

### Explore Page (Matches Index)

```bash
# Fuzzy ingredient search (pg_trgm trigram matching)
GET /api/v1/matches?q=tomato

# Sort options: trending (default), most_saved, latest
GET /api/v1/matches?sort=most_saved

# Filter by minimum bookmark count
GET /api/v1/matches?min_saves=5

# Paginated responses
→ {
    "matches": [{ "id": "...", "ingredients": [...], "saves_count": 12, "trending_score": 8.5 }],
    "pagination": { "page": 1, "pages": 5, "count": 47 }
  }
```

## Data Model

```
User
├── has_many :scans
│   └── has_many :scan_ingredients
├── has_many :matches (through scans)
├── has_many :bookmarks
└── has_many :cuisine_preferences

Scan (status enum: pending → detecting → completed/failed)
├── has_one_attached :image
├── has_many :scan_ingredients (name, raw_name, category, confidence)
└── has_one :match

Match (public boolean, saves_count counter cache, trending_score)
└── has_many :bookmarks
```

**PostgreSQL Features:**
- Native enums for scan status and rejection reasons (`create_enum`)
- `pg_trgm` extension for trigram-based fuzzy ingredient search
- Counter cache on `saves_count` for efficient sorting
- UUID primary keys on all tables

## Background Processing

| Job | Queue | Purpose |
|---|---|---|
| `ScanProcessingJob` | `:image_processing` | Runs AI detection pipeline after image upload |
| `UpdateTrendingCountsJob` | `:cron` | Recalculates trending scores from 7-day bookmark window |

Jobs are idempotent with automatic retries on transient API failures (timeout, connection errors).

## Infrastructure

Terraform manages the full AWS stack:

- **EC2** — containerised Rails + Sidekiq (Docker)
- **RDS** — PostgreSQL 15 with automated snapshots
- **ElastiCache** — Redis for Sidekiq and caching
- **S3** — Image storage via Active Storage
- **ALB** — Application Load Balancer with health checks
- **ECR** — Docker image registry
- **SSM** — Secrets management (Rails master key, Anthropic API key)
- **VPC** — Private subnets for database and Redis, public for API

## CI Pipeline

GitHub Actions runs on every PR and push to main:

1. **Lint** — RuboCop on changed files only (fast feedback)
2. **Security** — Brakeman static analysis for Rails vulnerabilities
3. **Test** — Full RSpec suite against PostgreSQL (100+ specs)

## API Documentation

Interactive API docs are available via Swagger UI at `/api-docs` when the server is running. The OpenAPI spec is auto-generated from rswag request specs, ensuring documentation stays in sync with the actual API behaviour.

## Planned

- React Native mobile app (Expo + TypeScript)
- OpenAPI contract sync between Rails and mobile via `openapi-typescript`
- Recipe suggestions based on detected ingredients + cuisine preferences

## Contact

Marcus Allen — marcusgrantee@gmail.com

## License

Proprietary. All rights reserved.
