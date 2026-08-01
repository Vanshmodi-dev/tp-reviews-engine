# Deferred Manual Tasks

Work that cannot be completed from an automated environment because it requires
a human at a console, a second account, credentials that must not be committed,
or a third-party consent flow.

**Nothing here is abandoned.** Each entry names the task, why it is blocked,
what was scaffolded so that development continues unblocked, and exactly what a
human must do to close it.

Automated work does **not** wait on these. Where an interface is affected, a
local scaffold satisfies the contract so that tests keep running.

| Status         | Meaning                                                       |
| -------------- | ------------------------------------------------------------- |
| **OPEN**       | Blocked, not started                                          |
| **SCAFFOLDED** | Blocked externally; a local stand-in keeps development moving |
| **CLOSED**     | A human completed it; the date and evidence are recorded      |

---

## OPEN — T-012 · Offsite repository mirror

**Phase** PH-00 · **Requirement** TR-CI-161, §11.1 step 12, §11.6

**Blocked because** §11.6 requires the mirror to live on a _different account or
host_ than the primary. Only one GitHub account is authenticated in this
environment, and a same-account mirror fails the whole purpose — account
suspension or compromise takes both copies at once.

**Impact if left open** The repository has no disaster-recovery copy. This is a
real exposure, not a formality: the `state` branch holds the only durable ledger,
and nothing regenerates a ledger.

**Human action**

```sh
# On a second GitHub account, or GitLab, or an external drive:
git clone --mirror https://github.com/Vanshmodi-dev/tp-reviews-engine.git
cd tp-reviews-engine.git
git remote set-url --push origin <mirror-url>
git push --mirror
```

Then record the mirror location in `docs/runbooks/disaster-recovery.md` and
verify by cloning **from** the mirror.

---

## OPEN — Repository variables for the policy kill switches

**Phase** PH-00 (§23) / consumed from PH-09 · **Requirement** TR-ENV-001

**Blocked because** TR-ENV-001 requires these to be repository **variables**
rather than secrets, so that flipping one is a two-click operation visible in
the audit log. Setting them is a deliberate operational act, not something an
automated run should decide.

**Human action** — Settings → Secrets and variables → Actions → Variables:

| Variable                  | Set to  | Purpose                                             |
| ------------------------- | ------- | --------------------------------------------------- |
| `TPRE_POLICY_ENABLED`     | `true`  | Global kill switch. `false` blocks all acquisition. |
| `TPRE_POLICY_DOM_ENABLED` | `true`  | Blocks DOM acquisition only; API clients continue   |
| `TPRE_POLICY_ROBOTS_MODE` | `warn`  | `block` / `warn` / `ignore`                         |
| `TPRE_MAINTENANCE_MODE`   | `false` | Suppresses non-critical alerts                      |

**Scaffold** `src/app/config/defaults.mjs` (PH-09) carries a code default for
every one of these, so absence is safe and the engine behaves as though the
documented defaults were set.

---

## OPEN — Google API credentials

**Phase** PH-22 · **Requirement** TRD §9.6, TR-SEC-010

**Blocked because** these are third-party credentials obtained through consent
flows and billing-enabled projects. They must never be committed (CON-17).

| Secret                                            | Needed when                                   |
| ------------------------------------------------- | --------------------------------------------- |
| `GOOGLE_PLACES_API_KEY`                           | Any client uses `google:places-api`           |
| `GBP_OAUTH_CLIENT_ID` / `GBP_OAUTH_CLIENT_SECRET` | Any client uses `google:business-profile-api` |
| `GBP_REFRESH_TOKEN__<SLUG_UPPER>`                 | Per client, via that client's OAuth grant     |

**Scaffold** The API adapters are developed against recorded fixtures under
`fixtures/api/`, so parsing, mapping, and error classification are fully testable
offline. TR-SEC-010 is explicit that a missing secret **fails closed** with
`ERR-CONFIG-SECRET-MISSING` and never falls back to DOM acquisition — that
behaviour is itself tested, without a credential.

---

## OPEN — Written client authorisation, Commerce Insight

**Phase** PH-25 · **Requirement** SAD §15, `compliance/authorizations/`

**Blocked because** it is a signed statement from a business owner. It cannot be
generated; it must be obtained.

**Human action** Obtain written authorisation and record it at
`compliance/authorizations/commerce-insight.md`: who authorised, date,
relationship to the business, evidence reference, scope acknowledgement. Offer
the Business Profile API adapter first — it is strictly superior on every axis
and is the recommended path (SAD §15.3.1).

A client config using `google:dom` without a matching authorisation record fails
validation by design.

---

## OPEN — Canary reference listing

**Phase** PH-19 · **Requirement** OPQ-02

**Blocked because** it is a product judgement about which public, high-volume,
non-client listing to monitor for structural breakage.

**Human action** Choose one and record the choice and its provenance in
`selectors/google-maps/assertions.json`.

---

## Notes on scaffolding policy

A scaffold exists so that **development is not blocked**, never so that a gate
appears to pass. Specifically:

- No scaffold returns fabricated review data into a payload path.
- No scaffold satisfies the Publish Gate.
- No scaffold weakens `ERR-CONFIG-SECRET-MISSING` into a fallback (SEC-4).
- Every scaffold is confined to the adapter or config layer and is replaced by
  the real credential without touching `core/`.
