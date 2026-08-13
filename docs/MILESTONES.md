# Milestone record

## MS-9 — reached on code-completion, 2026-08-13

**Declared by:** Engineering Manager · **Scope:** PH-00 … PH-25

All twenty-six phases are implemented and merged. The engine builds, validates,
type-checks, and passes its full gate: lint, format, types, schemas, the default
suite, the browser suite, the property laws, the chaos matrix, the security
scans, and every budget.

### The one remaining dependency is not technical

`compliance/authorizations/<slug>.md` — a written authorisation record from a
real business, per SAD §15.6 and §65.2 item 11.

It is tracked **separately from engineering**. It does not block hardening, it
does not block release engineering, and it cannot be worked around: V-3 and the
policy preflight both refuse a `google:dom` listing without it, mechanically, by
design (TR-CFG-041). `compliance/authorizations/TEMPLATE.md` is the format.

The Implementation Plan anticipated this state:

> **Stop Condition.** If the Commerce Insight authorisation record is not
> obtainable by the end of SP-6 (W13), raise it at DG-08. The engine ships
> regardless — but the first client becomes an internal scratch listing and the
> soak begins later. Building an unauthorised DOM client is not an available
> option (V-3, SAD §15).

### What "code-complete" does and does not claim

| Claim                                                      | Status                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Every phase's code is written, tested, and merged          | **Yes**                                                   |
| Every component in the TRD table has an owning file        | **Yes**, as of the SP-8 audit                             |
| The full CI gate is green                                  | **Yes**                                                   |
| A target can be taken end to end through the eleven stages | **No** — the stages exist; the composition does not       |
| A real client's reviews are on a real website              | **No** — T-338…T-342, blocked on the authorisation record |

The fourth row is the honest boundary of this declaration. MS-9's plan-level exit
criterion is _"a real client's reviews on a real website"_, and that is not met.
What is met is everything on this side of the external dependency.

---

## The SP-8 deliverable audit

Run at the start of the hardening allowance, against the TRD's thirty-component
table rather than against the phase checklists — the phase checklists are what
had already been marked complete, so re-reading them would have re-confirmed the
same answer.

Two components had been marked delivered and did not exist:

| Component                 | Owning file                                    | Phase that claimed it                                                                        | Consequence                                                                                                  |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **C-08 Listing Resolver** | `adapters/acquisition/google-dom/resolver.mjs` | PH-16, whose title reads _"google-dom adapter: **resolver**, consent, challenge, serialise"_ | Stage 1 absent. The root cause of `ERR-PIPELINE-INCOMPLETE` since PH-19, and of every blocked dispatch since |
| **C-20 Enricher**         | `app/enrich/index.mjs`                         | —                                                                                            | Stage 7 absent; `app/enrich/` held only a `.gitkeep`                                                         |

Two more differ from the TRD by path, with the functionality present and tested:

| Component            | TRD path                    | Actual                                            | Verdict                                                                                  |
| -------------------- | --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| C-03 Config Loader   | `app/config/loader.mjs`     | `app/config/index.mjs` (`loadConfig`)             | Path deviation                                                                           |
| C-25 Health Recorder | `infra/health/recorder.mjs` | `core/health/*` + persistence in `adapters/state` | Layer deviation — pure record construction in `core`, impure append in the state adapter |

**The lesson worth keeping:** a phase was marked complete with three of its four
named deliverables, and nothing detected it for nine phases. Every gate the
project has — lint, types, coverage, architecture tests — measures the code that
exists. None of them asks whether the code that was _specified_ exists. The audit
script that found this is worth re-running at every milestone.

Both gaps are now closed. Coverage of the new components is in the default
suite; the resolver's browser-driving half follows the established split, with
its decisions in pure siblings.
