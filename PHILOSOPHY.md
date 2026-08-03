# Development Philosophy

How this repository is developed. Product intent lives in [`SPECIFICATION.md`](./SPECIFICATION.md); this document is the developer’s north star.

Further assertions will be added over time. Start here.

---

## 1. Playwright is the oracle

We practice test-driven development against **Playwright itself**.

Before (and while) implementing this library, we write a **complete** end-to-end suite against Playwright’s own network DX — for every API we intend to mirror: matching, fulfill / continue / fetch / abort, inspection and spying, record / replay, WebSockets, and the rest.

Completeness is the point. Happy paths are not enough. Edge cases, awkward semantics, and lesser-used options belong in the suite too. Sparse coverage defeats oracle TDD.

That suite is the developer-experience contract. It pins Playwright’s behavior in executable form. The same tests are reused as we implement the library: only the downstream actor changes (browser → Node). The library is done for a surface when those tests pass against it.

Scope the suite to the APIs we will develop analogously — not all of Playwright, but all of the contract we claim.

The living suite is [`tests/parity/`](./tests/parity/). Details: [`research/playwright-parity-tdd.md`](./research/playwright-parity-tdd.md).

---

## 2. Code tracks Playwright one-to-one

The public API aims for near one-to-one parity with Playwright’s analogous APIs. The implementation should too.

Playwright’s structure makes that feasible. When working on any feature, keep the analogous Playwright core code in view and align naming, layering, and control flow with it deliberately. Do not invent a parallel design where a Playwright-shaped one exists.

Do not vendor Playwright source. Reimplement, with reference paths documented beside our modules. Parity research: [`research/playwright-network-parity.md`](./research/playwright-network-parity.md).
