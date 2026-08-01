# `tests/live/` — OPT-IN ONLY. NEVER IN DEFAULT CI.

**The rule: these tests are excluded from the default runner configuration and
must stay excluded.**

```sh
npm test        # default project — never runs anything in this directory
npm run test:live   # this directory, deliberately, by a human
```

Everything here touches the network and therefore fails for reasons that have
nothing to do with the change under test: a review source is slow, a listing was
edited, a runner has no egress, a rate limit was hit.

**Why exclusion is structural rather than a convention.** A network-dependent
test in the blocking path trains engineers to re-run CI until it passes. Once
that habit exists, it is applied to *every* red build, which destroys the value
of every other test in the repository — including the property laws and the
Publish Gate's coverage obligation, which are the tests the whole architecture
is shaped around. The cost is not the flaky test; it is what the flaky test
teaches people to do with real failures.

The exclusion is proved, not assumed: a deliberately failing test was added here
and `npm test` was confirmed to stay green.

If you are tempted to move a test out of this directory to get it running in
CI, the answer is a fixture. `fixtures/server/serve.mjs` serves the corpus over
HTTP with no internet, and the integration suite runs the whole pipeline against
it.

Specified by TRD §6.7 and §61. TR-TEST-010, TR-TEST-021, IR-18.
