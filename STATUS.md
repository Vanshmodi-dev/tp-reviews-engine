# TP Reviews Engine — status and handover

**As of 2026-08-13 · all code complete · one external dependency outstanding**

---

## What this engine does

It keeps a client's website showing their real Google reviews, automatically,
with no monthly cost and no third-party widget.

On a schedule, it opens the client's listing, reads the reviews, works out what
has changed since last time, and commits an updated JSON file to a `data`
branch. The client's website loads that JSON from their own origin. **The
visitor's browser never contacts Google** — that single property is what the
whole architecture is built around.

The other property worth knowing: **it refuses far more readily than it
publishes.** If the source changes its markup, if the review count drops
suspiciously, if a harvest looks partial — it publishes nothing and keeps
serving the last good payload. A red badge in this system usually means a
safety mechanism worked, not that something is broken.

---

## Run it locally

```bash
npm ci
npm run verify        # lint, format, types, and the full test suite
```

That is the one-liner that proves the engine works on your machine. It runs
2,082 tests and needs no network, no browser and no credentials. (The 54
browser tests are separate — `npm run test:browser`, and they need Chromium.)

Then, to see the pipeline actually produce a payload:

```bash
npx vitest run --project default tests/integration/csv-end-to-end.test.mjs
```

That harvests a real CSV, normalises it, reconciles it, passes it through the
publish gate, and writes four artifacts to a temporary directory. It is the
whole pipeline end to end, in about a second.

### The commands

| Command                                 | Does                                                                 | Touches the network |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| `npx tpre doctor`                       | Reports on the environment. Fixes nothing.                           | no                  |
| `npx tpre validate-config`              | Validates client configs. `--explain` shows how each value resolved. | no                  |
| `npx tpre plan --shards 2`              | Prints what is due and how it would be split. Writes nothing.        | no                  |
| `npx tpre harvest --shard 0 --shards 2` | Runs the due targets and publishes what the gate accepts.            | **yes**             |
| `npx tpre project`                      | Rebuilds payloads from the ledger. Never acquires.                   | no                  |

Add `--output json` to any of them for machine-readable output.

**Exit codes 0, 4, 5, 6 and 7 are all successes.** 5 means the gate refused to
publish; 6 means policy blocked the run; 7 means a bot challenge was hit. Only
1, 2 and 3 mean something is actually broken.

---

## Configure a client

Two files. Both are reviewed and merged like code.

### 1. `compliance/authorizations/<slug>.md` — the authorisation record

**Merge this first.** The engine mechanically refuses to harvest a `google:dom`
listing without it, and there is no override.

Copy `compliance/authorizations/TEMPLATE.md`, and fill it from the client's
**written** instruction — an email or a signed order form. The five fields that
matter:

| Field                | What goes in it                                                     |
| -------------------- | ------------------------------------------------------------------- |
| `authorized_by`      | Name and role of the person who gave the instruction                |
| `authorization_date` | Date of that written instruction                                    |
| `relationship`       | `owner` or `authorized_agent` — nothing else is accepted            |
| `evidence_ref`       | Path to this file                                                   |
| `scope_ack`          | `true`, only after you have confirmed the scope checklist with them |

### 2. `clients/<slug>.config.json` — the client config

```json
{
  "config_version": 1,
  "slug": "commerce-insight",
  "display_name": "Commerce Insight",
  "enabled": true,
  "profile": "standard",
  "tier": "premium",
  "authorization": {
    "authorized_by": "Founder, Commerce Insight",
    "authorization_date": "2026-07-22",
    "relationship": "owner",
    "evidence_ref": "compliance/authorizations/commerce-insight.md",
    "scope_ack": true
  },
  "listings": [
    {
      "key": "main",
      "adapter": "google:dom",
      "source": "google",
      "identity": { "place_id": "ChIJ..." },
      "expected_name": "Commerce Insight"
    }
  ]
}
```

**Two fields you cannot change later.** `slug` and `listings[].key` appear in
the ledger path, the payload URL, and every review's identity hash. Choosing
badly is a migration, not an edit.

**`expected_name` is a safety check, not a label.** Every run compares the name
on the page against it. If a listing is renamed, merged, or repointed, the run
aborts rather than harvesting someone else's reviews.

Open the config as a pull request. `validate-config.yml` will comment on it with
the _effect_ — which targets it would schedule — because a config can be
perfectly valid and still point at the wrong business.

---

## Where the client signature goes

The signature itself — the email, the signed order form — stays wherever you
normally keep client agreements. **Do not commit it.**

What goes in the repository is the _record_ of it:
`compliance/authorizations/<slug>.md`, with `evidence_ref` pointing at where the
original is held and the operative sentence quoted verbatim.

That record is checked two ways, both mechanical:

- `validate-config` refuses to let the config **merge** without a complete block
- the policy preflight refuses to let the target **run** without one

---

## Run the first harvest

In order. Do not skip 1 or 2.

1. **Merge the authorisation record.** Nothing else works without it.
2. **Merge the client config.** Read the PR comment showing which targets it
   schedules, and check them against the businesses you intended.
3. **Dispatch the canary.** Actions → Canary → Run workflow. It never publishes;
   it only tells you whether the source is readable today.
4. **Dispatch one harvest manually.** Actions → Harvest → Run workflow, with
   `shards: 1`. Watch it complete.
5. **Check the payload.** A `reviews.json` should appear on the `data` branch
   under `<slug>/<key>/`. Sanity-check the count and the mean rating against the
   client's live listing.
6. **Dispatch the same harvest again.** It should produce **zero** commits. If
   it produces four, hash gating has regressed — stop and investigate.
7. **Add the renderer to the client's site.** `frontend/README.md` picks the
   right recipe for their stack.
8. **Do the four go-live checks** in `frontend/README.md` — one request to their
   own origin, clean empty state when blocked, no layout shift, keyboard
   pagination.
9. **Enable the schedules** and confirm they are active.
10. **Start the soak.** `docs/runbooks/soak-tracking.md`, S1–S8.

---

## Where to look when something happens

|                                    |                                                                 |
| ---------------------------------- | --------------------------------------------------------------- |
| Something is red                   | `docs/runbooks/workflows.md` — what each failure actually means |
| Day-to-day operation               | `docs/runbooks/maintenance.md`                                  |
| Explaining this to a client        | `docs/client-explainer.md`                                      |
| Adding the widget to a site        | `frontend/README.md`                                            |
| Never change these rules           | `frontend/SAFETY.md`                                            |
| Moving a client to an official API | `docs/runbooks/migration-drill.md`                              |

---

## What is actually built

|                         |                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phases                  | PH-00 … PH-25, all merged                                                                                          |
| Components              | All 30 in the TRD's table exist, asserted by an architecture test                                                  |
| Adapters                | 4 — `csv:file`, `google:dom`, `google:places-api`, `google:business-profile-api` — all passing one shared contract |
| Workflows               | 8, all with explicit minimum permissions, all SHA-pinned                                                           |
| Tests                   | 2,136 — 2,062 default · 20 budgets · 54 browser                                                                    |
| Production dependencies | 1 (`playwright`)                                                                                                   |
| Renderer                | 4,967 bytes of a 5,120-byte budget, zero dependencies                                                              |

---

## Deferred manual tasks

Everything below needs a human, a real client, or a real deploy. None of it is
code, and none of it can be done from this repository alone.

### Blocking — the first client cannot go live without these

| #   | Task                                              | Why it blocks                                                                                                   | Reference                |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | **Commerce Insight written authorisation record** | V-3 and the policy preflight both refuse a `google:dom` listing without it. No override exists.                 | T-335, §65.2 item 11     |
| 2   | **Offsite clone verification**                    | A system with no offsite copy has no disaster-recovery path. No record of this exists yet. Costs about an hour. | §49.1 step 12, TR-CI-161 |
| 3   | **Privacy notice given to the client**            | Reviewer names are personal data; the notice is how a reviewer requests removal. Template is written and ready. | §65.2 item 14            |
| 4   | **Business Profile API offer recorded**           | The client must be offered the sanctioned adapter and the answer written into their config `notes`.             | T-337, SAD §15.3.1       |

### Verification that needs a real run

| #   | Task                                                        | Note                                                                                                                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5   | **A dispatched harvest produces a `data` commit**           | The §48 exit criterion. Provable only against a real repository with a configured client.                                                                                      |
| 6   | **Each of the eight workflows triggered once and observed** | `ci.yml` runs constantly; the other seven have never fired in anger.                                                                                                           |
| 7   | **The four go-live checks on the client's site**            | Network waterfall screenshot, blocked-payload empty state, CLS, keyboard pagination. §65.4 items 21–27.                                                                        |
| 8   | **S7 migration drill, live half**                           | The identity property is proven and permanently tested. Steps 1, 2 and 4 need a real OAuth consent — and the "under one hour" figure is from the SAD, not from a run. Time it. |

### Quality tasks with no deadline

| #   | Task                                              | Note                                                                                                                                                                                   |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | **Replace synthetic fixtures with real captures** | The extraction fixtures were written to the documented shape rather than captured from live pages. Swapping them is file-for-file.                                                     |
| 10  | **Execute `examples/nextjs/`**                    | Complete, correct source, never run — Next.js is deliberately not a dependency of this repo. `examples/static/` runs on every browser-suite build and proves the same INV-01 property. |
| 11  | **Start the 30-day soak**                         | Sheet is initialised with owners and measurement methods. Every row currently reads `not started`, which is deliberately not the same as `passing`.                                    |

---

## The one thing to remember

If anything ever looks wrong in production: **disable the Harvest workflow
first, diagnose second.** It costs nothing — every published payload keeps
serving exactly as it is — and it buys unlimited time to think.
