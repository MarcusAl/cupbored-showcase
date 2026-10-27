# cupbored.app

A full-stack social recipe iOS/Android app: photograph your fridge or cupboard, get the ingredients identified, and cook something from what you already have. A Rails 8 API with a React Native client, backed by an asynchronous LLM pipeline that builds and curates the recipe catalog.

> Source is in a private repository. This page is a summary of the stack and the engineering practices behind it. Implementation details, algorithms and the API surface are deliberately not published.

<img width="180" alt="Screenshot 2026-10-27 at 12 29 00" src="https://github.com/user-attachments/assets/c580b500-1e3a-42b9-a49c-7f9d31d0c7f3" />
<img width="180" alt="Screenshot 2026-10-27 at 12 30 14" src="https://github.com/user-attachments/assets/48e579ef-71f6-4b89-8ff0-7357a7140132" />
<img width="180" alt="Screenshot 2026-10-27 at 12 32 05" src="https://github.com/user-attachments/assets/a8f401d3-cb8b-4283-8e16-1868b962721c" />


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
| **Subscriptions** | App Store & Google Play billing through RevenueCat; entitlements held server-side |

## What it does

Photograph a fridge or cupboard → ingredient detection → ranked recipe matches → a recipe with a
guided cooking walkthrough you can jump around in, step by step. Around that: a ranked home feed
that mixes recipes, other cooks' matches and the photos they post of what they cooked, ranked by how
well each dish fits what you have and like, and freshly shuffled when you come back to it; search
(several ingredients at once) and browse, with creators filterable by cuisine and diet; saved and history views, cuisine and dietary
preferences, cooks' profiles,
follows, comments and likes, push notifications, and full account management. A News tab carries
chef, restaurant and cooking stories from publishers and chefs' own accounts worldwide, each with its
own likes and comment thread.

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

**Deriving structure from unstructured sources.** Recipes come from video, so much of the catalogue's
structure is inferred rather than given. Dietary tags are derived from ingredients against a curated
vocabulary with per-ingredient component metadata, and the derivation is proof-based: an ingredient
the vocabulary cannot identify withholds every tag rather than guessing one, because a missing tag is
safe where a wrong one is not. Matching against that vocabulary resolves the most specific name in a
phrase, so an oyster mushroom is not a shellfish and rice flour is not gluten. Chapter markers are
parsed from creators' own descriptions, which follow no agreed format and are validated against the
video's runtime; where a video has none, the interface falls back to an estimate and says so rather
than presenting arithmetic as a marked moment.

**Aggregates that cannot drift.** Counts shown on cards are resolved once per page through a single
grouped query rather than cached in a column, wherever the thing being counted is a moderated subset
— a counter column counts rows, and a row that is pending or withdrawn is not the same as one that is
published. The cost is one query per page; the alternative is a number that is wrong in a way nothing
detects.

**Subscriptions the client cannot grant itself.** A paid tier raises daily allowances, lifts
the saved-recipe cap and unlocks the full nutrition breakdown. The API withholds that breakdown
from free accounts rather than the app hiding it; free users see the table's shape with its
figures blurred. Every limit is enforced by the API from an entitlement the server copies from
the billing provider, never from what the app reports, and every number is tunable at runtime from
one place that maps a tier to its allowance. Access is stored as an expiry rather than a flag, so it
lapses on schedule even if a notification from the store never arrives. Store screens (paywall,
manage, restore) are the provider's own, which keeps payment UI out of the codebase entirely.

**Privacy enforced in the payload, not the view.** A profile can show the recipes its owner saved
most recently, behind an owner switch that defaults on. Switched off, the API returns nothing rather
than the app declining to draw it. Each row also says whether the reader saved it too, so that
answer is served per reader on its own request and never folded into the profile everyone shares.

**Third-party content as data, never as markup.** News arrives from dozens of public feeds the app
does not control, so everything in one is treated as untrusted: it is reduced to plain text before it
is stored, links and images are admitted only in a safe form, and fetching itself is bounded in size,
time and destination. Sources, filters and the chefs a story can be tagged with live in reviewed
configuration rather than the database, and a story is a link to the publisher's own page with its
excerpt, never a copy of the article. Stories nobody reacted to age out, so the table holds about a
month of news plus whatever people are still talking about.

**Background processing.** Queues are named for who is waiting: a scan someone is watching outranks
moderation, follower fan-out and recipe ingestion, weighted so nothing starves. Push delivery runs on
its own Sidekiq capsule, one provider request per job so a retry can only repeat what was refused,
and delivery receipts are read back to forget uninstalled devices. Notifications that only announce
something count toward no badge and expire; ones that are owed a response opt in to the badge. Jobs
are idempotent, with retries on transient external failures only.

**Infrastructure as code.** Terraform manages the whole AWS stack with remote state, exercised
locally against an emulator before it reaches a real account. Kamal handles zero-downtime container
deploys with TLS terminated at the origin.

**Security.** Authorisation is enforced by construction rather than by review: user-owned resources
are only reachable through scoped queries. Secrets live in managed secure storage, never in the repo
or an image. Datastores sit on private subnets with no public access. Static analysis gates every PR
under a zero-warning, no-suppressions policy. Sign-in is hardened against credential stuffing as well as
guessing at one account: passwords known from public breaches are refused without the password leaving
the server, and failures that pile up bring in a human check. Keys the app never needs a person to know
are generated by the infrastructure itself and are held nowhere else. Specifics are deliberately not
documented here.

**Nutrition worked out the way a food lab does it.** Each recipe's figures follow the standard
published recipe-calculation approach (EuroFIR, USDA), counting what is eaten and working from the
weight of the finished dish rather than a guess. Checks that read only stored data flag figures that
look wrong, and the fixes are reviewed data kept under version control, so one correction applies to
every recipe it touches and recalculating costs nothing. The result was validated against a
hand-checked sample, and any re-run across the whole corpus is batched and reversible.

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
