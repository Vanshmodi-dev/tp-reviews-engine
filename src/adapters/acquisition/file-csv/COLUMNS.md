# CSV column contract

The CSV adapter reads a file a client supplies — typically an export from a
previous vendor, or a hand-maintained sheet. It exists for two reasons: it lets
a client be onboarded before any browser automation is authorised, and it is
the second implementation that keeps `AcquisitionPort` honest.

## Required columns

| Column        | Type        | Notes                                                   |
| ------------- | ----------- | ------------------------------------------------------- |
| `author_name` | string      | As published. Never abbreviated by the engine.          |
| `rating`      | integer 1–5 | A row outside this range is rejected, not clamped.      |
| `date`        | string      | Any format `core/dates` can parse, or an RFC 3339 date. |

A row missing any required column is rejected. The rest of the file is still
read — see **per-row isolation** below.

## Optional columns

| Column               | Type    | Default  | Notes                                               |
| -------------------- | ------- | -------- | --------------------------------------------------- |
| `text`               | string  | `null`   | The review body. Absent means a rating-only review. |
| `author_initials`    | string  | derived  | Derived from `author_name` when absent.             |
| `author_avatar_url`  | string  | `null`   |                                                     |
| `author_profile_url` | string  | `null`   |                                                     |
| `language`           | string  | detected | A BCP 47 code. Detected from `text` when absent.    |
| `likes`              | integer | `null`   |                                                     |
| `photo_count`        | integer | `null`   |                                                     |
| `owner_reply_text`   | string  | `null`   |                                                     |
| `owner_reply_date`   | string  | `null`   |                                                     |
| `source_url`         | string  | `null`   |                                                     |
| `external_id`        | string  | `null`   | The source's own id, when the export carries one.   |

Unknown columns are **ignored, not rejected**. A client export routinely carries
columns the engine has no use for, and refusing the file because of them would
turn a five-minute onboarding into a spreadsheet-editing exercise.

## Per-row error isolation

**One bad row must never fail the file.** A hundred-row export with one
malformed date should yield ninety-nine reviews and one reported rejection, not
zero reviews and one error.

The reason is operational: these files are hand-maintained, so a bad row is the
normal case rather than the exceptional one. An all-or-nothing parser would mean
a client's entire review set disappears because somebody typed `2026-13-45` in
row 47, and the failure would recur on every run until a human found it.

Rejected rows are reported with their line number and the reason, and they count
toward the quarantine rate that gate rule G-06 watches. A file that is _mostly_
bad still fails — the isolation is per row, not a licence to publish rubbish.

## Completeness

The adapter reports `stop_reason: 'target_reached'` when it reaches the end of
the file, because it has genuinely seen everything the file contains. It reports
`cap_reached` when it stops at the configured ceiling first.

It never reports completeness directly — that is derived from the stop reason by
`core/validate/completeness.mjs` and nowhere else (VAL-01).

## Capabilities

The adapter declares only what the file format can carry. It cannot see a
verified-purchase flag or a local-guide status, so it does not claim them, and a
`null` in the payload for those fields is explained by the capability
declaration rather than looking like missing data.
