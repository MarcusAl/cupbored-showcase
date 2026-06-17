# cupbored.app

A Rails 8 API for AI-powered ingredient detection and recipe matching. Background pipeline ingests source videos through discovery → channel quality filtering → transcript fetch → asynchronous batched LLM parsing → output validation → source-span grounding → catalog persistence.

> Source is in a private repository. This showcase highlights the architecture, tech stack, and API design.

## Tech Stack

| Layer | Technology |
|---|---|
| **API** | Ruby on Rails 8.1 (API-only) |
| **AI** | LLM (image ingredient detection, asynchronous batch transcript parsing) |
| **Database** | PostgreSQL — UUID PKs, `pg_trgm`, native enums, counter caches |
| **Background Jobs** | Sidekiq + Redis (sidekiq-cron, sidekiq-throttled) |
| **Storage** | Active Storage on AWS S3 |
| **Auth** | Token-based (`has_secure_password` + signed session tokens) |
| **Email** | Third-party transactional provider |
| **API Docs** | OpenAPI 3.0, generated from request specs via rspec-openapi |
| **Infrastructure** | Terraform → AWS (EC2, RDS, ElastiCache, ALB, ECR, S3, SSM, VPC) |
| **Deployment** | Kamal 2 — zero-downtime Docker deploys to EC2 |
| **CI/CD** | GitHub Actions: RSpec + RuboCop + Brakeman → auto-deploy on merge |
| **Local Infra** | LocalStack for AWS emulation |

## Architecture

```
api/
├── controllers/api/v1/   # Versioned API endpoints
├── models/               # ActiveRecord (PG enums + UUID PKs) + immutable value objects
├── types/                # Custom ActiveRecord::Type for jsonb ⇄ value-object casting
├── clients/              # Provider-agnostic external API wrappers
├── services/             # ApplicationService objects (one public method per class)
└── jobs/                 # Sidekiq jobs (find AR object, delegate to service)
```

### Request pipeline

User upload → background detection job → background matching job → ranked recommendations. Each stage runs in its own Sidekiq queue with explicit state transitions on the parent record.

### Background ingest pipeline (LLM batch)

```
Discovery (cron) ──▶ Channel filter ──▶ Transcript fetch ──▶ PendingParse buffer
                                                                    │
                                                                    ▼
                                  Async LLM batch submit (cron) ──▶ Poll + retrieve (cron)
                                                                    │
                                                                    ▼
                                       Validate ──▶ Ground source spans ──▶ Persist
```

- **Cost**: batching cuts LLM spend ~50% vs synchronous calls.
- **Quality gate**: every emitted `source_span` is substring-matched against the original transcript before persistence. Hallucinated ingredients/steps fail grounding and never reach the catalog.
- **Multilingual**: prompt is translation-aware — output text fields are normalised regardless of source language while `source_span` stays verbatim, so grounding still validates.
- **Tunable**: enqueue spacing is a Redis-backed knob — operators can throttle without redeploying.

## Service Layer

Business logic lives in `ApplicationService` objects with a single public `.call(...)` method (≤3 public methods per class, no god classes). Examples:

- **Scans** — `DetectIngredients`, `ProcessImage`, `PurgeImage`
- **Recipes** — `DiscoverVideos`, `FilterByChannel`, `ParseTranscript`, `ValidateParsedData`, `VerifyGrounding`, `ProcessBatchResult`, `CreateFromParsed`, `RecomputeIdf`
- **Matches** — `FindRecipes` (IDF-weighted scoring with core gating + preference boost), `AllocateCourses`

## API Design

Versioned under `/api/v1/` with Bearer token auth. Consistent response shape: `{ "data": ... }` for success, `{ "errors": [...] }` for failures, `head :no_content` for destroys. Pagination via `pagy`.

**[Browse the interactive API docs →](https://marcusal.github.io/cupbored-showcase/)**

## Data Model

Native PG enums, UUID primary keys on every table, counter caches on hot read columns, `pg_trgm` for trigram fuzzy search, composite indexes on lookup paths. Cascade rules enforced at the database, not Rails. State transitions for long-running operations live in enum columns rather than booleans.

A layer of immutable value objects (Ruby `Data`) wraps parsed external/AI payloads — each is the single source of truth for one shape, owning its own coercion and validation so raw primitives never leak across service boundaries; one round-trips through a `jsonb` column via a custom `ActiveRecord::Type`.

## Background Processing

Seven Sidekiq jobs across `:image_processing`, `:recipe_processing`, `:default`, `:mailers`, and `:cron` queues. Jobs find AR objects by ID then delegate to services. All jobs are idempotent with automatic retries on transient external failures only (timeout, connection errors) — never on logical errors.

## Infrastructure

Terraform manages the full AWS stack: EC2 + RDS Postgres + ElastiCache Redis + ALB + ECR + S3 + SSM SecureString secrets + scoped VPC. Kamal handles container orchestration. HCP Terraform Cloud for production workspace state.

## Security

- Application-level rate limiting via `rack-attack` (per-IP throttling, per-token burst protection, Redis-backed IP blocklist, per-user daily quota), fail-open under Redis outage
- Trusted proxy configuration for accurate client IP behind ALB
- IDOR prevention enforced via scoped queries (`current_user.association` + `.sole` lookups)
- SSM SecureString for all secrets, scoped IAM `ssm:GetParameter` per parameter ARN
- TLS termination at ALB, private subnets for RDS + Redis, no public DB access
- Static analysis on every PR — zero Brakeman warnings policy, no Semgrep exceptions

## CI Pipeline

GitHub Actions on every PR + merge: RuboCop (full codebase), Brakeman (zero warnings), Bundler Audit, full RSpec suite against real Postgres + Redis (~490 specs), Bullet detects N+1s, auto-deploy to production on merge to main.

## Planned

- React Native mobile app (Expo + TypeScript)
- OpenAPI contract sync via `openapi-typescript`

## Contact

Marcus Allen — marcusgrantee@gmail.com

## License

Proprietary. All rights reserved.
