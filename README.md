# cupbored.app

A full-stack social recipe iOS/Android app: photograph your fridge or cupboard, get the ingredients identified, and cook something from what you already have. A Rails 8 API with a React Native client, backed by an asynchronous LLM pipeline that builds and curates the recipe catalog.

> Source is in a private repository. This page is a summary of the stack and the engineering practices behind it. Implementation details, algorithms and the API surface are deliberately not published.

<img width="180" alt="Screenshot 2026-08-28 at 17 38 20" src="https://github.com/user-attachments/assets/b6f4ed64-67ac-4c4a-870b-f20e3ff37593" />
<img width="180" alt="Screenshot 2026-08-28 at 17 36 03" src="https://github.com/user-attachments/assets/562a4bcc-e1df-4cb5-8059-0f0cc75e44ee" />
<img width="180" alt="Screenshot 2026-08-28 at 17 36 30" src="https://github.com/user-attachments/assets/4af67307-3eb0-4622-baba-667d81b44e73" />
<img width="180" alt="Screenshot 2026-08-28 at 17 37 24" src="https://github.com/user-attachments/assets/39a3fbf0-add2-4534-a56c-b5eccebd3a74" />
<img width="180" alt="Screenshot 2026-08-28 at 17 38 51" src="https://github.com/user-attachments/assets/90aa7a50-7c4d-4e5b-808d-83567c32d591" />
<img width="180" alt="Screenshot 2026-08-28 at 17 39 51" src="https://github.com/user-attachments/assets/1bc6ec5e-8d75-4248-9b4b-0b1d96222a58" />

## Tech Stack

| Layer | Technology |
|---|---|
| **API** | Ruby on Rails 8.1 (API-only) |
| **AI** | LLM image understanding and asynchronous batch text parsing |
| **Database** | PostgreSQL |
| **Background Jobs** | Sidekiq + Redis |
| **Storage** | Active Storage on AWS S3 |
| **Auth** | Token-based sessions; Sign in with Apple & Google |
| **API Docs** | OpenAPI 3.0, generated from request specs |
| **Infrastructure** | Terraform → AWS, Cloudflare edge |
| **Deployment** | Kamal 2 — zero-downtime Docker deploys |
| **CI/CD** | GitHub Actions: RSpec + RuboCop + Brakeman → auto-deploy on merge |
| **Mobile** | React Native (Expo SDK 57, Expo Router v4, TypeScript strict) |
| **Mobile state** | TanStack Query; end-to-end generated API types |

## What it does

Photograph a fridge or cupboard → ingredient detection → ranked recipe matches → a recipe with a
guided cooking walkthrough. Around that: a ranked home feed, search and browse, saved and history
views, cuisine and dietary preferences, cooks' profiles, follows, comments and likes, push
notifications, and full account management.

Shipped to TestFlight on iOS.

## Engineering

**Service layer.** Business logic lives in single-responsibility service objects with one public
method, namespaced by domain, with collaborators injected through the constructor so they are
visible and substitutable. Jobs find records and delegate; services receive objects, never IDs.
External integrations sit behind provider-agnostic client classes, so a provider can be swapped
without touching the logic around it.

**API design.** Versioned and token-authenticated, with one consistent response envelope across
every endpoint and a pagination strategy chosen per surface rather than globally.

**Type safety end to end.** The OpenAPI spec is generated from the API's own request specs, and the
mobile client's types are generated from that spec — so the client and the server cannot drift
apart without CI noticing.

**Background processing.** Work is split across dedicated queues so slow media and ingest work can
never starve interactive requests. Jobs are idempotent, with retries on transient external failures
only.

**Infrastructure as code.** Terraform manages the whole AWS stack with remote state, exercised
locally against an emulator before it reaches a real account. Kamal handles zero-downtime container
deploys with TLS terminated at the origin.

**Security.** Authorisation is enforced by construction rather than by review: user-owned resources
are only reachable through scoped queries. Secrets live in managed secure storage, never in the repo
or an image. Datastores sit on private subnets with no public access. Static analysis gates every PR
under a zero-warning, no-suppressions policy. Specifics are deliberately not documented here.

## CI Pipeline

GitHub Actions on every PR and merge.

**Backend:** RuboCop across the whole codebase, Brakeman at zero warnings, dependency audit, the
full RSpec suite against real Postgres and Redis, N+1 detection failing the build, and auto-deploy
on merge to main.

**Mobile:** TypeScript strict, ESLint at zero warnings, the full test suite, custom Semgrep security
rules, and bundle validation.

## Contact

Marcus Allen — marcusgrantee@gmail.com

## License

Proprietary. All rights reserved.

Dietary filtering is powered in part by data from [Open Food Facts](https://world.openfoodfacts.org), © Open Food Facts contributors, used under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
