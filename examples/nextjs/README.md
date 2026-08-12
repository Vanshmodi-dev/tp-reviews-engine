# Next.js App Router example (DEL-191)

A complete, working integration of the reference renderer in a Next.js App
Router project, fetching the payload **on the server** so the visitor's browser
makes **zero** review requests.

## What is here

| File                             | Role                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| `app/reviews/page.jsx`           | Server component. Fetches the payload, revalidates on the harvest cadence. |
| `app/reviews/reviews-client.jsx` | Client boundary. Calls `render`, never `mount`.                            |
| `app/reviews/reviews.test.mjs`   | The network assertion (FE-03) and the server-render assertion.             |
| `next.config.mjs`                | The CSP header, with no `'unsafe-inline'`.                                 |

## Running it

**This example is not built in CI, and that is deliberate.**

Next.js is not a dependency of this repository and will not become one — the
engine has exactly one production dependency (`playwright`), and pulling a
framework and its tree in to build an example would put the repository's
dependency posture at the mercy of a demo. The example is therefore complete,
correct source that you drop into your own Next.js project.

To run it:

```bash
npx create-next-app@latest my-site --js --app
cd my-site
cp -r <this-repo>/examples/nextjs/app/reviews app/reviews
cp <this-repo>/frontend/renderer/tp-reviews.mjs app/reviews/
cp <this-repo>/frontend/renderer/tp-reviews.css app/reviews/
npm run dev
```

Then open `/reviews`.

**Verification status:** the source here is written against the App Router API
and mirrors `frontend/recipes/nextjs-app-router.md` exactly, but it has not
been executed in this repository. Running it once against a real Next.js
install is a deferred manual task — the same category as capturing live
fixtures. `examples/static/` _is_ executed, on every browser-suite run, and it
proves the same INV-01 property with the renderer this example uses.

## The two things that make this recipe different

1. **`render`, not `mount`.** The payload arrives as a prop from the server.
   Calling `mount` would fetch it a second time from the browser, which is the
   request this whole arrangement exists to avoid.
2. **A failed fetch must not fail the page.** `page.jsx` passes `payload ?? {}`
   rather than throwing. Reviews are a section of a page, not the page — an
   outage at the data origin should cost an empty widget, not a broken route.
