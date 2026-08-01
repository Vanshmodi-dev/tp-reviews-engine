# Security Policy

TP Reviews Engine publishes a static JSON payload that is embedded in client
websites. A defect here can reach every client site at once, so security
reports are treated as the highest-priority class of issue in this repository.

## Reporting a Vulnerability

**Use GitHub's private vulnerability reporting:**
<https://github.com/Vanshmodi-dev/tp-reviews-engine/security/advisories/new>

That channel is private, is not indexed, and creates a draft advisory that only
the maintainers can read. Please use it rather than a public issue.

If you cannot use it, open a public issue containing **no technical detail** —
just a request for a private channel — and a maintainer will open one.

### What to include

- What you observed, and the smallest input or sequence that reproduces it.
- Which component you believe is affected (a path under `src/` is ideal).
- The impact you believe it has, and on whom: the engine, a client's site, a
  reviewer whose data is processed, or the review source.
- Whether the issue is already public anywhere.

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement that a human has read it | 3 business days |
| Initial assessment, severity, and a plan | 10 business days |
| Fix for a confirmed high-severity issue | 30 days, or an explanation of why longer |
| Credit in the advisory and CHANGELOG | On request, by default |

Please give us the assessment window before public disclosure. If you believe an
issue is being actively exploited, say so — that changes the timeline.

## Scope

**In scope**

- The engine (`src/`), the reference renderer (`frontend/renderer/`), the
  published payload contract (`schemas/`), and the CI workflows
  (`.github/workflows/`).
- Anything that could place attacker-controlled markup or script into a
  published payload, and therefore into a client website. Review text is
  normalised by markup **removal**, not escaping — that boundary
  (`src/core/normalize/markup.mjs`) is the single most sensitive code path in
  the system.
- Anything that could cause a secret to be written to a log, a diagnostics
  bundle, an artifact, or a commit.
- Anything that could cause published review data to be silently wrong: an
  incorrect deletion, an inflated count, a mis-attributed author.

**Out of scope**

- The legal and terms-of-service posture of DOM-based acquisition. That is a
  known, documented, accepted product risk, analysed in SAD §15 — not a
  vulnerability report.
- Rate limits, quotas, or availability of any third-party review source.
- Findings that require an already-compromised maintainer account or runner.
- Reports generated solely by an automated scanner with no demonstrated impact.

## Design Commitments

These are properties the system is built to hold. A demonstrated breach of any
one of them is a valid, high-severity report.

| Commitment | Where it lives |
|---|---|
| No secret appears in any file in this repository, ever, in any branch | CON-17; enforced by push protection and secret scanning |
| Secrets are read once into a sealed object and seed the log redaction filter at that moment | TRD §48.4, TR-SEC-011 |
| Normalisation **removes** markup rather than escaping it, before any value reaches a payload | TRD §23.3 |
| The reference renderer uses no HTML-injection DOM API and has zero dependencies | TR-STD-001, TR-STD-002 |
| An adapter whose required secret is missing fails closed — it never falls back to DOM acquisition | TR-SEC-010 |
| A bot-detection challenge is terminal. No retry path exists | INV-07 |
| Every third-party GitHub Action is pinned to a full commit SHA | TR-CI-002 |
| No workflow uses `pull_request_target` | TR-CI-003 |

The full threat model is SAD §36; the security architecture is SAD §35 and
TRD §47–§54.

## Supported Versions

Pre-release. Until v1.0.0 ships, only the tip of `main` is supported.

## Safe Harbour

We will not pursue or support legal action against anyone who reports a
vulnerability in good faith, stays within the scope above, avoids privacy
violations and service degradation, and gives us reasonable time to respond.
