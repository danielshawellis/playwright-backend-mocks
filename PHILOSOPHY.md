# Development Philosophy

How this repository is developed. Product intent lives in [`SPECIFICATION.md`](./SPECIFICATION.md); this document is the developer’s north star.

Further assertions will be added over time. Start here.

---

## 1. Playwright is the oracle

We practice test-driven development against **Playwright itself**.

Before (and while) implementing this library, we write an end-to-end suite that exercises Playwright’s own network DX — HTTP route interception and browser-side WebSockets: matching, fulfill / continue / fetch / abort, inspection and spying, record / replay, and the rest of the surface we intend to mirror.

That suite is the contract. It pins Playwright’s developer experience in executable form. Our library’s job is to make the same contract pass when the downstream actor is a Node process instead of a browser page.

The living suite is [`tests/parity/`](./tests/parity/). Details: [`research/playwright-parity-tdd.md`](./research/playwright-parity-tdd.md).

---

## 2. Code tracks Playwright one-to-one

The public API aims for near one-to-one parity with Playwright’s analogous APIs. The implementation should too.

Playwright’s structure makes that feasible. When working on any feature, keep the analogous Playwright core code in view and align naming, layering, and control flow with it deliberately. Do not invent a parallel design where a Playwright-shaped one exists.

Do not vendor Playwright source. Reimplement, with reference paths documented beside our modules. Parity research: [`research/playwright-network-parity.md`](./research/playwright-network-parity.md).
