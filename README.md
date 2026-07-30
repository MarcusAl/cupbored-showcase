# cupbored.app

A full-stack social recipe iOS/android app for AI-powered ingredient detection and recipe matching — a Rails 8 API consumed by a React Native mobile client. The backend pipeline ingests source videos through discovery → channel quality filtering → transcript fetch → asynchronous batched LLM parsing → output validation → catalog persistence. The mobile client takes a photo of your fridge or cupboard, identifies the ingredients, and surfaces matched recipes with a guided cooking walkthrough.

> Source is in a private repository. This showcase highlights the architecture, tech stack, and API design.

<img width="180" alt="Screenshot 2026-07-31 at 17 11 00" src="https://github.com/user-attachments/assets/156d8bbb-bd7c-49ca-b448-4b0ae9d63f18" />
<img width="180" alt="Screenshot 2026-07-31 at 17 17 34" src="https://github.com/user-attachments/assets/be70ff1d-bdb7-42e9-bed2-aa21ee0a1b88" />
<img width="180" alt="Screenshot 2026-07-31 at 17 11 43" src="https://github.com/user-attachments/assets/d24786c4-4c01-4c0b-bbc4-d26918f4bd28" />
<img width="180" alt="Screenshot 2026-07-31 at 17 12 24" src="https://github.com/user-attachments/assets/bcaed1d1-58f0-4ada-a5f2-881b4a50e152" />
<img width="180" alt="Screenshot 2026-07-31 at 17 13 27" src="https://github.com/user-attachments/assets/4b7b1fcf-54ec-4f99-8ae8-2b378b26561d" />




## Tech Stack

| Layer | Technology |
|---|---|
| **API** | Ruby on Rails 8.1 (API-only) |
| **AI** | LLM (image ingredient detection, asynchronous batch transcript parsing) |
| **Database** | PostgreSQL — UUID PKs, `pg_trgm`, native enums, counter caches |
| **Background Jobs** | Sidekiq + Redis (sidekiq-cron, sidekiq-throttled) |
| **Storage** | Active Storage on AWS S3 |
| **Auth** | Token-based (`has_secure_password` + signed session tokens); Sign in with Apple & Google |
| **Email** | Third-party transactional provider |
| **API Docs** | OpenAPI 3.0, generated from request specs via rspec-openapi |
| **Infrastructure** | Terraform → AWS (EC2, RDS, ElastiCache, ALB, ECR, S3, SSM, VPC) |
| **Deployment** | Kamal 2 — zero-downtime Docker deploys to EC2 |
| **CI/CD** | GitHub Actions: RSpec + RuboCop + Brakeman → auto-deploy on merge |
| **Local Infra** | LocalStack for AWS emulation |
| **Mobile** | React Native (Expo SDK 56, Expo Router v4, TypeScript strict) |
| **Mobile state** | TanStack Query; end-to-end generated API types (OpenAPI → openapi-typescript) |

## Architecture

```
api/
├── controllers/api/v1/   # Versioned API endpoints
├── models/               # ActiveRecord (PG enums + UUID PKs) + immutable value objects
├── types/                # Custom ActiveRecord::Type for jsonb ⇄ value-object casting
├── clients/              # Provider-agnostic external API wrappers
├── services/             # ApplicationService objects (one public method per class)
└── jobs/                 # Sidekiq jobs (find AR object, delegate to service)

mobile/
├── src/app/              # Expo Router v4 file-based routes
├── src/screens/          # Screen bodies (co-located tests)
├── src/components/       # Primitives (Screen, Box, Text, Button, Card, Input, …)
├── src/lib/api/          # TanStack Query hooks + generated schema types
└── src/theme/            # Design tokens (colour, spacing, typography)
```

### Request pipeline

User upload → background detection job → background matching job → ranked recommendations. Each stage runs in its own Sidekiq queue with explicit state transitions on the parent record.

### Background ingest pipeline (LLM batch)

```
Multi-source discovery (cron) ──▶ Acceptance filters ──▶ Transcript fetch ──▶ PendingParse buffer
                                                                                     │
                                                                                     ▼
                                                   Async LLM batch submit (cron) ──▶ Poll + retrieve (cron)
                                                                                     │
                                                                                     ▼
                                                        Validate ──▶ Persist
```

- **Cost**: cheap pre-filters run before any paid API call, and parsing is batched — spend scales with viable candidates, not raw volume.
- **Quality gate**: parsed output is validated against the original source before persistence; unsupported content is rejected rather than trusted.
- **Multilingual**: parsing is translation-aware, normalising output across source languages while preserving verbatim source references for validation.
- **Operable**: runtime controls pause processing and expose per-stage throughput without a redeploy.
- **Presentation-ready**: each recipe's thumbnail is selected and normalised at ingest, and its dimensions recorded, so clients can lay out media without reflow.

## Mobile Client

A full React Native app (Expo SDK 56, Expo Router v4, TypeScript strict) that consumes the Rails API. Types are generated end-to-end: the OpenAPI spec is itself generated from request specs via rspec-openapi, and `openapi-typescript` turns it into typed client hooks — the spec and the API cannot drift independently.

**Core flow:** photograph a fridge or cupboard → AI ingredient detection → ranked recipe matches → recipe detail with flavor profile, difficulty, and guided cooking stages. A persistent walkthrough video plays through the recipe screen and into cook mode without restarting across swipes.

**Discovery surfaces:** home feed with recent matches, a two-mode explore screen (a paginated community match feed and a recipe browser, each with search), saved/history views, and per-user cuisine and dietary preference management (dietary preferences drive a hard ingredient-based exclusion in matching, so a vegan is never served a meat recipe).

**Auth:** email/password and OAuth (Sign in with Apple, Sign in with Google) using a verify-and-mint flow — the native SDK returns an identity token; the backend verifies and mints the session.

**Account management:** profile editing (display name and a customizable avatar — uploaded, cropped to a square, and resized client-side; author avatars surface on match cards across the feeds), active session management, and in-app account deletion.

**Compliance & safety:** content reporting, user blocking (blocked authors are excluded from feeds), in-app community guidelines, and App Store-compliant in-app account deletion. Scan images are served through an authorized, access-controlled endpoint.

## Service Layer

Business logic lives in `ApplicationService` objects with a single public `.call(...)` method (≤3 public methods per class, no god classes). Examples:

- **Scans** — `DetectIngredients`, `ProcessImage`, `PurgeImage`
- **Recipes** — `DiscoverVideos`, `FilterByChannel`, `ParseTranscript`, `ValidateParsedData`, `ProcessBatchResult`, `CreateFromParsed`, `SelectBestThumbnail`, `ResolveThumbnail`
- **Matches** — `FindRecipes`, `AllocateCourses`, `DietViolations` (hard dietary exclusion; forbidden-ingredient vocabulary seeded from the Open Food Facts taxonomy)

## API Design

Versioned under `/api/v1/` with Bearer token auth (email/password plus Sign in with Apple/Google). Consistent response shape: `{ "data": ... }` for success, `{ "errors": [...] }` for failures, `head :no_content` for destroys. Pagination via `pagy`.

**[Browse the interactive API docs →](https://marcusal.github.io/cupbored-showcase/)**

## Data Model

Native PG enums, UUID primary keys on every table, counter caches on hot read columns, `pg_trgm` for trigram fuzzy search, composite indexes on lookup paths. Cascade rules enforced at the database, not Rails. State transitions for long-running operations live in enum columns rather than booleans.

A layer of immutable value objects (Ruby `Data`) wraps parsed external/AI payloads — each is the single source of truth for one shape, owning its own coercion and validation so raw primitives never leak across service boundaries; one round-trips through a `jsonb` column via a custom `ActiveRecord::Type`.

## Background Processing

Seven Sidekiq jobs across `:image_processing`, `:recipe_processing`, `:default`, `:mailers`, and `:cron` queues. Jobs find AR objects by ID then delegate to services. All jobs are idempotent with automatic retries on transient external failures only (timeout, connection errors) — never on logical errors.

## Infrastructure

Terraform manages the full AWS stack: EC2 + RDS Postgres + ElastiCache Redis + ALB + ECR + S3 + SSM SecureString secrets + scoped VPC. Kamal handles container orchestration. HCP Terraform Cloud for production workspace state.

## Security

- Application-level rate limiting via `rack-attack` (per-IP throttling, per-account login throttle, per-token burst protection, Redis-backed IP blocklist, per-user daily quota; standard `RateLimit-*` / `Retry-After` headers), fail-open under Redis outage
- Trusted proxy configuration for accurate client IP behind ALB
- IDOR prevention enforced via scoped queries (`current_user.association` + `.sole` lookups)
- SSM SecureString for all secrets, scoped IAM `ssm:GetParameter` per parameter ARN
- TLS termination at ALB, private subnets for RDS + Redis, no public DB access
- Static analysis on every PR — zero Brakeman warnings policy, no Semgrep exceptions
- Authorized media access: scan images are served through a scoped endpoint; un-publishing a match revokes photo access
- App Store-compliant in-app account deletion with re-authentication and OAuth identity revocation

## CI Pipeline

GitHub Actions on every PR + merge:

**Backend:** RuboCop (full codebase), Brakeman (zero warnings), Bundler Audit, full RSpec suite against real Postgres + Redis (~740 specs), Bullet detects N+1s, auto-deploy to production on merge to main.

**Mobile:** TypeScript strict (`tsc --noEmit`), ESLint (zero warnings), full RNTL test suite (~460 specs), Semgrep custom security rules (HTTPS-only deep links, EXIF stripping, no secrets in env, token-only storage access), `expo export` bundle validation.

## Contact

Marcus Allen — marcusgrantee@gmail.com

## License

Proprietary. All rights reserved.

Dietary filtering is powered in part by data from [Open Food Facts](https://world.openfoodfacts.org), © Open Food Facts contributors, used under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
