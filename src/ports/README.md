# `ports/` — interface definitions only

**The rule: no executable behaviour lives here.**

Each file in this directory defines one interface — its operations, its record
types, the errors it may return, and the guarantees an implementation must
uphold. Types and documentation only. A default implementation, a helper, a
convenience wrapper, or "just one shared constant" turns a port into a base
class, and a base class is not a boundary.

**Why the discipline is worth it.** Eight ports define the entire surface across
which the engine touches the outside world: acquisition, state, publisher,
notifier, browser, clock, random, logger. Because they are behaviour-free, the
core and the application layer can be tested against test doubles with no
mocking framework, and swapping a review source or a publication target is a
change to one adapter rather than a change to the pipeline.

The `acquisition` port is the one that earns the architecture. Four adapters
implement it in v1.0 — DOM, two official APIs, and CSV — and the CSV adapter is
deliberately built *first*, before any browser code exists, because an interface
validated against a single implementation is a rename rather than an interface.

Adapters are constructed in exactly one place, `cli/composition.mjs`. Nothing
else may instantiate one.

Specified by TRD §6.4.1 and §5. Dependency rules DR-3 and DR-5.
