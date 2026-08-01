# TP Reviews Engine

**TradyPerch** · Engine v1.0.0 (in development) · Node ESM, no build step

A reusable, zero-recurring-cost platform that keeps client websites synchronised
with their published customer reviews — without paid widgets, and without the
website ever contacting a review source.

---

## Status

**Pre-release. Phase PH-00 (repository, toolchain, CI).** No engine code exists
yet. The architecture, technical specification, and implementation plan are
baselined and approved; see [`docs/`](docs/).

Progress is tracked against the 342 tasks in the implementation plan. A merged
branch named `t/<task-id>-<slug>` maps a commit to its task.

## What It Does

A scheduled job collects a client's published reviews, reconciles them against a
durable private ledger, and writes a small static JSON payload to a public
branch served over HTTPS. The client's website reads that JSON. Nothing else.

```
review source ──► scheduled harvest ──► ledger (private, `state` branch)
                                          │
                                          ▼
                             payload (public, `data` branch) ──► client website
```

## The Five Decisions That Define the System

1. **The website never contacts a review source.** All acquisition is offline
   and scheduled. A visitor's browser talks to a static JSON file and nothing
   else. *(SAD §16, ADR-001)*
2. **Acquisition is a pluggable adapter, not the product.** Four adapters ship
   in v1.0, so losing one is a configuration change. *(SAD §17.17, ADR-002)*
3. **The private Ledger and the public Payload are different things.** Every
   payload is regenerable from durable state without touching the network.
   *(SAD §20.11, ADR-006)*
4. **Publication is gated on invariants, not on job success.** No failure mode
   in the system reaches a visitor. *(SAD §27.3, ADR-011)*
5. **A bot-detection challenge is a stop signal, not a puzzle.** The engine
   never attempts to defeat anti-automation measures. *(SAD §29, ADR-010)*

## Read Before Using This

**SAD §15 (Legal & Ethical Considerations) is not optional reading.** The
default v1.0 DOM acquisition method reads publicly rendered Google Maps pages,
which is contrary to Google's Terms of Service. The architecture document states
that plainly, quantifies the risk, and specifies two fully-built sanctioned
alternatives that any client can be migrated to in under an hour.

**For any client willing to grant OAuth access to their own Google Business
Profile, the Business Profile API adapter is strictly superior on every axis** —
free, sanctioned, complete, and stable. The DOM adapter exists for clients who
will not complete that grant. *(SAD §15.3.1)*

Every DOM-acquired listing requires a recorded written authorisation from the
business that owns it, under `compliance/authorizations/`.

## Documentation

Four baselined documents govern this repository. Start with
[`docs/README.md`](docs/README.md).

| Document | Answers |
|---|---|
| [AI Development Playbook](docs/TP-AI-Development-Playbook-v1.0.md) | How does TradyPerch build software? |
| [SAD/TDD](docs/TP-Reviews-Engine-SAD-v1.0.md) | What is the system, and why? |
| [TRD](docs/TP-Reviews-Engine-TRD-v1.0.md) | How, exactly, is it built? |
| [Implementation Plan](docs/TP-Reviews-Engine-IMPL-PLAN-v1.0.md) | In what order, by when, verified how? |

Precedence: the Playbook sits above the three project documents. The SAD wins on
architecture; the TRD wins on implementation detail; the plan governs sequencing
only. A published JSON Schema in `schemas/` beats all prose at runtime.

## Requirements

| | |
|---|---|
| Node.js | The major pinned in [`.nvmrc`](.nvmrc) — LTS, ≥ 20 |
| Modules | ESM only, `.mjs`. No transpiler, no bundler, no build step. |
| OS | Linux x64 in production; macOS and Windows for development |

## Getting Started

```sh
nvm use          # matches .nvmrc
npm ci           # installs from the committed lockfile, never resolves ranges
npm run verify   # lint + format:check + typecheck + test
```

`npm test` requires no network access.

## Repository Layout

`main` holds source, configuration, and documentation. Two orphan branches with
no shared history hold machine-written data:

| Branch | Holds | Written By |
|---|---|---|
| `main` | Engine, client configs, selector packs, schemas, docs | Humans, via reviewed pull requests |
| `data` | Published payloads. This is the static site root. | The engine only |
| `state` | Ledgers, health series, caches, run manifests | The engine only |

Never hand-edit `data` or `state` outside a documented recovery procedure
(TRD §60).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Code standards are TRD §67–§69 and are
enforced mechanically by ESLint, Prettier, the type checker, and CI — not by
review comments.

## Security

See [SECURITY.md](SECURITY.md). This repository is public and, by construction,
contains no secret in any file at any time.

## Licence

Proprietary. All rights reserved. See [LICENSE](LICENSE).
