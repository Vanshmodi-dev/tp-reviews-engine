# `frontend/renderer/` — zero dependencies, no HTML injection

**The rule: no runtime dependency, ever, and no HTML-injection DOM API, ever.**

This code ships to client websites TradyPerch does not control and executes in
their visitors' browsers. Both rules follow from that one fact.

**Zero dependencies (DEP-6).** A supply-chain compromise here is not one
incident; it is one incident multiplied by every client site running the
renderer, on sites whose owners never agreed to the dependency and cannot patch
it. The budget is under 5 KB minified, which is achievable precisely because
nothing is imported. This is non-negotiable and is not subject to the usual
DEP-1 justification process — there is no justification that would be accepted.

**No HTML-injection DOM API (TR-STD-002).** `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, and `Element.setHTML` are prohibited and
are rejected by a lint rule and by `tests/security/renderer-api.test.mjs`. Text
reaches the DOM through `textContent` and attributes through `setAttribute`,
with URLs validated against a host allowlist.

**Why both layers exist when review text is already normalised.** Markup removal
in `core/normalize/markup.mjs` is the primary boundary and it is thorough. This
is the second one. Defence in depth is warranted here specifically because the
blast radius is every client simultaneously, and because the renderer will
eventually be handed to third parties who will modify it. A renderer that cannot
inject HTML stays safe even when someone downstream feeds it something the
engine never produced.

`SAFETY.md` in this directory records what must never be done and why, for that
future reader.

Specified by TRD §6.8 and §50. DEP-6, TR-STD-001, TR-STD-002.
