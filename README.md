# cupbored.app

A full-stack social recipe iOS/Android app for AI-powered ingredient detection and recipe matching — a Rails 8 API consumed by a React Native mobile client. The mobile client takes a photo of your fridge or cupboard, identifies the ingredients, and surfaces matched recipes with a guided cooking walkthrough. Behind it, an asynchronous LLM pipeline builds and curates the recipe catalog.

> Source is in a private repository. This showcase highlights the architecture, tech stack, and API design.

<img width="180" alt="Screenshot 2026-08-12 at 18 32 08" src="https://github.com/user-attachments/assets/364c9dc7-3dab-4a8e-8f44-a01cadf96321" />
<img width="180" alt="Screenshot 2026-08-12 at 18 32 30" src="https://github.com/user-attachments/assets/3e978419-ddcf-4cdd-bd81-28c78dab6ffb" />
<img width="180" alt="Screenshot 2026-08-12 at 18 32 46" src="https://github.com/user-attachments/assets/8edd19cd-6042-4426-8dd1-d1f89df70ecd" />
<img width="180" alt="Screenshot 2026-08-12 at 18 33 08" src="https://github.com/user-attachments/assets/17b3d862-ee31-4470-83ea-daa4fb00408b" />
<img width="180" alt="Screenshot 2026-08-12 at 18 33 31" src="https://github.com/user-attachments/assets/82b6c1dd-550f-4ee3-a3a9-c8c417c23bfa" />
<img width="180" alt="Screenshot 2026-08-04 at 13 40 15" src="https://github.com/user-attachments/assets/47f62e31-df99-4abd-a5b7-7121b9d517fc" />







## Tech Stack

| Layer | Technology |
|---|---|
| **API** | Ruby on Rails 8.1 (API-only) |
| **AI** | LLM (image ingredient detection, asynchronous batch transcript parsing) |
| **Database** | PostgreSQL — UUID PKs, `pg_trgm`, native enums, counter caches |
| **Background Jobs** | Sidekiq + Redis (sidekiq-cron, sidekiq-throttled) |
| **Storage** | Active Storage on AWS S3 |
| **Auth** | Token-based sessions; Sign in with Apple & Google |
| **Email** | Third-party transactional provider |
| **API Docs** | OpenAPI 3.0, generated from request specs via rspec-openapi |
| **Infrastructure** | Terraform → AWS (EC2, RDS, ElastiCache, ALB, ECR, S3, SSM, VPC) |
| **Deployment** | Kamal 2 — zero-downtime Docker deploys to EC2 |
| **CI/CD** | GitHub Actions: RSpec + RuboCop + Brakeman → auto-deploy on merge |
| **Local Infra** | floci for local AWS emulation |
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
Scheduled discovery ──▶ Filtering ──▶ Buffer ──▶ Async LLM batch ──▶ Validate ──▶ Persist
```

A cron-driven, fully asynchronous pipeline: candidates are filtered before any paid API call, parsing
runs as batched LLM work rather than per-item requests, and output is validated against its source
before it is allowed into the catalog. Multilingual sources are normalised on the way in. Per-stage
throughput is observable and processing can be paused at runtime without a redeploy.

## Mobile Client

A full React Native app (Expo SDK 56, Expo Router v4, TypeScript strict) that consumes the Rails API. Types are generated end-to-end: the OpenAPI spec is itself generated from request specs via rspec-openapi, and `openapi-typescript` turns it into typed client hooks — the spec and the API cannot drift independently.

**Core flow:** photograph a fridge or cupboard → AI ingredient detection → ranked recipe matches → recipe detail with flavor profile, difficulty, and guided cooking stages. A persistent walkthrough video plays through the recipe screen and into cook mode without restarting across swipes.

**Discovery surfaces:** home feed with recent matches, a two-mode explore screen (a paginated community match feed and a recipe browser, each with search), saved/history views, and per-user cuisine and dietary preference management, which feeds directly into matching.

**Auth:** email/password and OAuth (Sign in with Apple, Sign in with Google), with the backend as the sole issuer of application sessions.

**Account management:** profile editing (display name and a customizable avatar — uploaded, cropped to a square, and resized client-side; author avatars surface on match cards across the feeds), active session management, and in-app account deletion.

**Compliance & safety:** content reporting, user blocking, in-app community guidelines, App Store-compliant in-app account deletion, and access-controlled delivery of user-uploaded images.

## Service Layer

Business logic lives in `ApplicationService` objects with a single public `.call(...)` method — one
responsibility per class, no god classes, dependencies injected through the constructor so
collaborators are visible and substitutable. Services are namespaced by domain (scans, recipes,
matches, notifications) and receive objects; jobs find records and delegate.

External integrations sit behind provider-agnostic client classes that return generic data
structures, so a provider can be swapped without touching service logic.

## API Design

Versioned under `/api/v1/` with Bearer token auth (email/password plus Sign in with Apple/Google). Consistent response shape: `{ "data": ... }` for success, `{ "errors": [...] }` for failures, `head :no_content` for destroys. Pagination via `pagy` — offset for feeds, keyset (opaque cursor, no page numbers) for comment threads, where an infinite-scrolling list mutates under the reader and OFFSET would skip and repeat rows.

**[Browse the interactive API docs →](https://marcusal.github.io/cupbored-showcase/)**

The published spec is a curated subset — enough to show the conventions above, not the full
surface. `openapi.yaml` here is trimmed by hand after each regeneration from the private repo;
re-copying the generated spec wholesale would republish every endpoint.

## Data Model

Native PG enums, UUID primary keys on every table, counter caches on hot read columns, `pg_trgm` for trigram fuzzy search, composite indexes on lookup paths. Cascade rules enforced at the database, not Rails. State transitions for long-running operations live in enum columns rather than booleans.

A layer of immutable value objects (Ruby `Data`) wraps parsed external/AI payloads — each is the single source of truth for one shape, owning its own coercion and validation so raw primitives never leak across service boundaries; one round-trips through a `jsonb` column via a custom `ActiveRecord::Type`.

## Moderated User Content

Comments on matches and recipes are screened before they are stored, so a comment that passes is
live before the keyboard closes and one that doesn't is refused as a validation error rather than
persisted. Bodies are normalised ahead of the check, so what gets reviewed is what a reader will
actually see.

The check sits behind a single injected seam, so the strategy can be replaced without touching the
pipeline around it, and a takedown path stands ready behind a job for a strategy slow enough to
belong off the request.

Threads are keyset-paginated and read through one shared client component, so a comment reads
identically on a match and on a recipe, with replies and likes.

## Background Processing

Work is split across dedicated Sidekiq queues so slow media and ingest work can never starve interactive requests. Jobs find AR objects by ID then delegate to services. All jobs are idempotent with automatic retries on transient external failures only (timeout, connection errors) — never on logical errors.

## Infrastructure

Terraform manages the full AWS stack — compute, managed Postgres and Redis, load balancing, object storage, secret storage and a scoped VPC — with remote state in HCP Terraform Cloud. Kamal handles zero-downtime container deploys. The same Terraform configuration is exercised locally against an AWS emulator before it reaches a real account.

## Security

- Layered application-level rate limiting and abuse controls, with standard `RateLimit-*` /
  `Retry-After` headers so clients can self-regulate
- Authorisation enforced by construction: every user-owned resource is reached through a scoped
  query, so an unscoped lookup is a review failure rather than a latent IDOR
- Secrets held in managed secure storage with least-privilege access per secret — never in the repo,
  never in an image
- TLS terminated at the load balancer; datastores on private subnets with no public access
- Timing-safe authentication with uniform failure responses, so auth outcomes don't enumerate accounts
- Static analysis gates every PR: zero-warning policy, no suppressions
- Account deletion re-authenticates and revokes federated identities

Specific thresholds, rules and control internals are deliberately not documented here.

## CI Pipeline

GitHub Actions on every PR + merge:

**Backend:** RuboCop (full codebase), Brakeman (zero warnings), dependency audit, full RSpec suite against real Postgres + Redis, N+1 detection failing the build, auto-deploy on merge to main.

**Mobile:** TypeScript strict (`tsc --noEmit`), ESLint (zero warnings), full RNTL test suite, custom Semgrep security rules, and bundle validation via `expo export`.

## Contact

Marcus Allen — marcusgrantee@gmail.com

## License

Proprietary. All rights reserved.

Dietary filtering is powered in part by data from [Open Food Facts](https://world.openfoodfacts.org), © Open Food Facts contributors, used under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
