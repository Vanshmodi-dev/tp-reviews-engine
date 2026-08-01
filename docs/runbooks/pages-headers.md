# Measured Pages Response Headers

**Measured 2026-08-01 · Origin `https://vanshmodi-dev.github.io/tp-reviews-engine/` · Pages `build_type: legacy`, source `data` branch root**

This file records what the static origin **actually returns**, not what we asked
it to return. TR-CI-160 makes this a blocker for client onboarding, and OIQ-04
made it an open question precisely because the answer could not be assumed.

Re-measure after any change to Pages configuration, custom domain, or build
type, and date the new dump. **Where this file and `data:/_headers` disagree,
this file is right.**

---

## The headline finding

**GitHub Pages ignores the `_headers` file.** It is a Netlify and Cloudflare
Pages convention; the legacy Pages builder does not read it. Every header below
is GitHub's, and none of ours.

Three requested headers are simply absent:

| Requested in `_headers`                                            | Actually returned            |
| ------------------------------------------------------------------ | ---------------------------- |
| `Cache-Control: public, max-age=300, stale-while-revalidate=86400` | `Cache-Control: max-age=600` |
| `X-Content-Type-Options: nosniff`                                  | **absent**                   |
| `Referrer-Policy: no-referrer`                                     | **absent**                   |

`_headers` is retained on the `data` branch as a statement of intent and because
a future migration to a host that honours it is a live option (§49). It is inert
today. Anyone reading it must read this file too.

## Literal dump — `GET /index.json`

```http
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 43
Server: GitHub.com
Content-Type: application/json; charset=utf-8
x-origin-cache: HIT
Last-Modified: Sat, 01 Aug 2026 03:24:38 GMT
Access-Control-Allow-Origin: *
Strict-Transport-Security: max-age=31556952
ETag: "6a6d66f6-2b"
expires: Sat, 01 Aug 2026 03:40:07 GMT
Cache-Control: max-age=600
x-proxy-cache: MISS
X-GitHub-Request-Id: DB98:60F00:A382EB:AD2DAB:6A6D683F
x-github-edge-region: iad
Accept-Ranges: bytes
Age: 0
Date: Sat, 01 Aug 2026 03:30:07 GMT
Via: 1.1 varnish
X-Served-By: cache-del-vibw2260037-DEL
X-Cache: MISS
X-Cache-Hits: 0
X-Timer: S1785555008.538056,VS0,VE302
Vary: Accept-Encoding
X-Fastly-Request-ID: ccc8c210d2f2900ccaed297bc91e957d62109f71
```

`GET /ping.txt` is identical except `Content-Type: text/plain; charset=utf-8`.

## What was verified, and what it means

| Property         | Result                                                                                | Consequence                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CORS**         | `Access-Control-Allow-Origin: *`, present with and without an `Origin` request header | A client website can `fetch()` the payload cross-origin with no proxy. This is the single header the whole integration depends on, and it is present unconditionally. |
| **Content type** | `application/json; charset=utf-8` on `.json`                                          | `response.json()` works without an override.                                                                                                                          |
| **Cache**        | `Cache-Control: max-age=600`, fixed                                                   | **Not configurable.** See below.                                                                                                                                      |
| **Revalidation** | `ETag` present; `If-None-Match` returns `304`                                         | After the 10-minute window a repeat fetch is a 304 with no body. Bandwidth cost of a frequent poller is near zero.                                                    |
| **HTTPS**        | `http://` returns `301` to `https://`; HSTS `max-age=31556952`                        | `https_enforced: true` confirmed at the wire, not just in the API response.                                                                                           |
| **Missing path** | `404`                                                                                 | A client slug or listing key that does not exist fails visibly rather than returning an empty body a renderer might treat as "no reviews".                            |
| **Compression**  | `Vary: Accept-Encoding`                                                               | Payload size budgets are pre-compression; the wire cost is lower.                                                                                                     |

## The ten-minute cache floor

`max-age=600` is fixed by GitHub and cannot be lowered. It sets the **minimum
staleness a visitor can observe**, and it is additive to harvest cadence:

```
visitor-observed staleness  =  time since last harvest  +  up to 10 minutes
```

Three consequences that belong in operational thinking, not in a config file:

1. **A publish is never instant.** After a payload commit, an edge that has
   already cached the old file keeps serving it for up to ten minutes. During an
   incident, "I pushed the fix and the site still shows the old data" is
   expected for ten minutes and is not evidence the fix failed.
2. **Post-deployment verification must defeat the cache** or wait it out. Use a
   cache-busting query string when checking a specific deployment.
3. **A cadence below ten minutes buys nothing a visitor can see.** The engine's
   `cadence_floor_hours` default of 6 is three orders of magnitude above this,
   so the floor is irrelevant in practice — worth stating so nobody argues for a
   faster cadence on freshness grounds.

## The two absent security headers

`nosniff` and `Referrer-Policy` cannot be set on this origin. Neither is
load-bearing here, and it is worth being precise about why rather than treating
their absence as an accepted risk:

- **`nosniff`** matters when a browser might sniff a response into a more
  dangerous type than declared. Every payload is served as
  `application/json; charset=utf-8`, is fetched by script rather than navigated
  to, and is never injected as HTML — `frontend/renderer/` uses text-only DOM
  APIs and forbids every HTML-injection API by lint rule and by test
  (TR-STD-002). The sniffing path does not exist.
- **`Referrer-Policy`** governs what a _navigation away_ leaks. This origin is
  fetched, not browsed; there is no outbound link on it.

The real defence is upstream regardless: normalisation removes markup rather
than escaping it (TRD §23.3), before any value reaches a payload.

**If a client's threat model requires these headers**, the migration path is a
host that honours `_headers` — Cloudflare Pages or Netlify, both free at this
volume, both fed from the same `data` branch. That is a hosting change, not an
engine change, which is the point of the payload being static files.

## How to re-measure

```sh
BASE=https://vanshmodi-dev.github.io/tp-reviews-engine

curl -sS -D - -o /dev/null "$BASE/index.json"
curl -sS -D - -o /dev/null -H 'Origin: https://example.com' "$BASE/index.json"

ETAG=$(curl -sSI "$BASE/index.json" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
curl -sS -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "$BASE/index.json"

curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' "http://vanshmodi-dev.github.io/tp-reviews-engine/ping.txt"
```

Paste the output here verbatim, with the date. A summarised dump is not a
measurement.
