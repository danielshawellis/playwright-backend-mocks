# Playwright Backend Mocks — Project Specification (v1)

## Purpose

This document provides design guidance for implementing the first version of **Playwright Backend Mocks**.

It is not intended to be treated as an inflexible implementation contract. Its purpose is to communicate the project’s vision, priorities, architectural direction, and intended developer experience.

The implementer should use engineering judgment throughout the project. If research or implementation work reveals a cleaner architecture, a better API, or a more maintainable approach, prefer that improvement over following a suggested implementation detail mechanically.

The high-level philosophy and product goals should remain consistent, but implementation details in this document should generally be treated as informed suggestions.

## High-Level Goal

Playwright Backend Mocks should allow Playwright tests to mock outbound HTTP and HTTPS requests made by one or more Node.js application processes.

The experience should feel like a natural extension of Playwright’s browser-side request routing.

Conceptually:

```ts
await backendMocks.route(
  "https://api.example.com/users",
  async (route) => {
    await route.fulfill({
      status: 200,
      json: [{ id: 1 }],
    });
  },
);
```

The test author should not need to think extensively about process boundaries, proxy protocols, transport internals, or which supported HTTP client originated the request.

The Node.js integration should use `@mswjs/interceptors`, or another comparably suitable low-level interception mechanism discovered during research, to intercept supported outbound HTTP traffic inside the application process.

This should allow the library to work more broadly than an injected Fetch-only solution while still exposing Fetch-standard `Request` and `Response` concepts internally.

## Guiding Philosophy

When tradeoffs exist, prioritize:

1. Excellent developer experience.
2. Simple and understandable implementation.
3. Clean, maintainable code.
4. Compatibility with common Playwright patterns.
5. Correct behavior for common Node.js HTTP clients.
6. Additional feature completeness.

Version 1 should solve the ordinary 95% use case extremely well.

Supporting more of Playwright, Fetch, or `@mswjs/interceptors` is desirable when doing so is straightforward. Do not substantially complicate the codebase to support uncommon edge cases.

Unsupported behavior should fail immediately with clear, actionable errors rather than behaving incorrectly or providing partial compatibility.

Avoid premature optimization and speculative abstractions. Build the smallest clean architecture that delivers the intended experience.

## Design-First Development

Do not begin production implementation immediately.

The project should begin with research and planning documented in a series of Markdown files.

### Research

Research at least:

* Playwright request routing and mocking APIs
* Common Playwright route usage
* Playwright fixtures and fixture composition
* `mergeTests()`
* Playwright worker and test lifecycles
* Playwright `webServer` configuration
* `@mswjs/interceptors`
* MSW’s Node.js architecture
* `BatchInterceptor`
* Fetch, XMLHttpRequest, and Node HTTP interception behavior
* Request and response normalization in `@mswjs/interceptors`
* `controller.respondWith()`
* `controller.errorWith()`
* Passthrough behavior
* Interceptor lifecycle and cleanup
* Supported and unsupported HTTP clients
* Async interceptor handlers
* Cancellation and abort propagation
* Native Node.js Fetch error behavior
* Axios and `node:http` error behavior
* Common network failures
* Buffered and streaming body behavior
* HTTP proxy and coordinator conventions
* WebSocket lifecycle and failure handling
* Runtime protocol validation
* pnpm workspaces
* npm package publishing through GitHub Actions and OIDC

A small technical spike should verify that the chosen interceptor approach can:

* Intercept the target HTTP clients
* Pause an intercepted request during a WebSocket round trip
* Return a mocked response
* Pass through an unmatched request
* Simulate supported failures
* Cleanly dispose without leaking interception state

The purpose of this research is not to justify implementing every available feature. It is to make deliberate API and architecture decisions.

### Public API plan

Before implementation, create a Markdown document proposing the complete public API.

It should cover:

* Exported functions
* Exported types
* Node.js interceptor setup
* Playwright fixtures
* Route handlers
* Request inspection
* Response fulfillment
* Passthrough
* Response modification
* Failure simulation
* Request spying and history
* Configuration
* Package boundaries
* CLI usage
* Unsupported behavior

The proposed API should be evaluated against common Playwright usage, common Node.js application structures, and the capabilities of `@mswjs/interceptors`.

### Protocol plan

Before implementation, create a dedicated Markdown document defining the cross-process protocol.

It should cover:

* Connection roles
* Handshake messages
* Protocol versioning
* Package-version compatibility
* Node-agent messages
* Playwright-worker messages
* Proxy responses
* Request and response serialization
* Header serialization
* Body encoding
* Error serialization
* Cancellation
* Heartbeats
* Disconnect handling
* Multiple-match failures
* Runtime validation
* Compatibility and migration strategy

Protocol integrity is a primary design requirement.

### Technical plan

Before implementation, create a Markdown document covering:

* Repository structure
* pnpm workspace structure
* Package structure
* Shared protocol package
* TypeScript configuration
* ESLint configuration
* Formatting
* Build tooling
* Module formats
* Test architecture
* CI
* Release workflow
* npm publishing
* Proxy lifecycle
* Node interceptor lifecycle
* WebSocket lifecycle
* Error handling
* Dashboard architecture

Production implementation should begin only after these plans exist and are internally coherent.

The plans may evolve as implementation teaches the developer more about the problem.

## Code Quality

Use strong, modern TypeScript throughout the repository.

Configure TypeScript in strict mode before beginning implementation.

Avoid:

* `any`
* Implicit `any`
* Weakly typed protocol messages
* Unvalidated `JSON.parse()` results
* Duplicated protocol definitions
* Unnecessary type assertions
* Unsafe casts used to bypass design problems
* Large, loosely typed configuration objects
* Clever abstractions that obscure control flow

Prefer:

* Discriminated unions
* Readonly types
* Explicit interfaces
* Exhaustive handling
* Small focused functions
* Immutable data where practical
* Clear ownership and lifecycle boundaries
* Runtime validation at process and network boundaries
* A single canonical source for protocol types and schemas

Any assertion used at an external-library compatibility boundary should be narrow, justified, and isolated.

Configure ESLint before production implementation. Linting, formatting, and type checking should be enforced in CI.

## Scope for Version 1

Version 1 supports:

* Node.js application processes
* Supported outbound HTTP and HTTPS traffic intercepted through `@mswjs/interceptors`
* Common clients such as Fetch, Axios, and Node HTTP clients where the interceptor library supports them
* Playwright-controlled route registration
* Mocked responses
* Passthrough requests
* Response inspection and modification for common cases
* Common network failure simulation
* Request spying and history
* Multiple Node.js client processes
* Multiple Playwright workers
* A standalone central proxy and coordinator
* A lightweight dashboard

Version 1 does not support:

* WebSockets as an application transport
* gRPC
* Arbitrary unsupported socket or native transports
* Traffic that bypasses the selected interceptor implementation
* Streaming request bodies
* Streaming response bodies
* Perfect emulation of every operating-system-level network failure

WebSockets may be used internally between Playwright workers, Node agents, and the proxy.

The project should accurately document which clients and transports are supported rather than claiming to intercept all process traffic.

## Runtime Support

Prioritize modern, widely used Node.js versions, especially the current LTS version.

Supporting additional older versions is desirable when it requires little effort. Do not compromise the design, introduce substantial compatibility code, or weaken the implementation to support obsolete runtimes.

Apply the same philosophy to Playwright and `@mswjs/interceptors` compatibility: prioritize current versions and support older versions where reasonably convenient.

## Buffered Request and Response Bodies

Version 1 should fully buffer request and response bodies when transmitting them through the distributed protocol.

This means the complete body is read into memory before it is sent between the Node agent, proxy, and Playwright worker.

Common buffered body types should be supported where practical, including:

* JSON
* Text
* `URLSearchParams`
* `FormData`
* `Blob`
* `ArrayBuffer`
* Typed arrays and ordinary binary bodies

The exact support matrix should be established during interceptor and Fetch research.

Streaming bodies should fail with a clear error explaining that distributed streaming is not supported in version 1.

Use native `Request`, `Response`, `Headers`, and related Web API implementations where possible.

Allow `@mswjs/interceptors` to handle translation between normalized Fetch-standard objects and the originating HTTP client rather than reproducing client-specific behavior manually.

## Intended Architecture

The expected architecture contains four logical components:

1. A Node.js interception agent.
2. A Playwright integration package.
3. A standalone proxy and coordinator server.
4. A shared protocol package.

These may become three or four published packages depending on which boundaries produce the clearest result.

```text
Node.js application processes
        │
        │ intercepted HTTP requests
        │ persistent WebSocket connections
        ▼
Standalone proxy and coordinator
        ▲
        │ route registration and handler dispatch
        │ persistent WebSocket connections
        │
Playwright workers
```

The proxy should have one stable configured URL for the entire Playwright run.

All participating Node.js processes and Playwright workers connect to the same proxy.

The proxy is the central source of truth for:

* Active route registrations
* Request matching
* Route ownership
* Request lifecycle state
* Multiple-match detection
* Passthrough coordination
* Request history
* Diagnostics

The Node and Playwright packages should remain comparatively thin.

## Component Responsibilities

### Node.js package

The Node.js package should:

* Install and dispose the interceptor
* Use `@mswjs/interceptors` to observe supported outbound HTTP traffic
* Normalize intercepted requests into shared protocol messages
* Send requests to the proxy
* Wait for proxy decisions
* Apply mocked responses through the interceptor controller
* Pass through requests when instructed
* Apply supported failures
* Propagate cancellation
* Identify the originating Node client
* Reconnect or fail clearly according to documented behavior

It should not own route matching.

It should not maintain an independent route registry.

It should not duplicate proxy coordination logic.

### Playwright package

The Playwright package should:

* Expose Playwright fixtures
* Connect Playwright workers or tests to the proxy
* Register and unregister route matchers
* Receive matched request events
* Execute user handlers
* Return fulfill, continue, fetch, abort, or other supported decisions
* Surface proxy failures in the affected test
* Clean up test-scoped registrations
* Provide spying and request-inspection APIs

It should not independently determine global route ownership.

It may perform local convenience validation, but the proxy remains authoritative.

### Proxy package

The proxy should:

* Authenticate or identify connections where appropriate
* Maintain active connections
* Maintain route registrations
* Match every intercepted request against active registrations
* Detect zero, one, or multiple matches
* Dispatch matched requests to the correct Playwright connection
* Coordinate responses and failures
* Coordinate passthrough
* Track pending requests
* Handle cancellations
* Clean up disconnected clients
* Record request and response history
* Produce diagnostics
* Expose health and REST observability endpoints

The proxy should contain most distributed coordination behavior.

### Protocol package

The protocol package should:

* Define every cross-process message
* Define request and response serialization
* Define error serialization
* Export runtime validators
* Export TypeScript types derived from those validators
* Define protocol-version constants
* Define shared parsing and serialization helpers
* Be consumed directly by the Node, Playwright, and proxy packages

No package should recreate protocol types locally.

## Expected Developer Experience

The following examples communicate the intended experience. They are illustrative rather than mandatory.

The implementer may improve on them if research or implementation reveals a better design.

### Server-side integration

The Node.js application should enable backend interception with a small amount of startup code.

Conceptually:

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

if (process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL !== undefined) {
  await startBackendMocks({
    proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
    clientId: "api-server",
  });
}
```

Outside the Playwright environment, the application should run normally without installing the interceptor.

The exact function and environment-variable names are not prescribed.

The common setup should require:

* A configured proxy URL during Playwright tests
* One small startup integration
* No replacement of Fetch
* No injection into every API client
* Normal production networking outside the test environment

The library should expose explicit lifecycle control when useful:

```ts
const backendMocks = await startBackendMocks({
  proxyUrl,
});

await backendMocks.stop();
```

Framework-specific initialization may require the interceptor to be installed before certain modules or clients are loaded. Research and documentation should clearly explain any ordering requirements.

### Multiple Node.js processes

Several application processes may connect to the same proxy:

```ts
await startBackendMocks({
  proxyUrl,
  clientId: "api-server",
});
```

```ts
await startBackendMocks({
  proxyUrl,
  clientId: "job-worker",
});
```

The client identifier should be optional and should have a sensible default.

Routes should apply across clients unless explicitly scoped to a client.

Request records should include the client identifier so tests and dashboard users can determine which process made a request.

### Proxy CLI

The proxy should run as a standalone command-line process.

Conceptually:

```bash
playwright-backend-mocks-proxy --port 4310
```

The precise command name and CLI options are left to the implementer.

The CLI should use sensible defaults and expose the configuration needed for common use cases without becoming overly broad.

Likely configuration areas include:

* Host
* Port
* Logging
* Request-history retention
* Health endpoint
* Authentication or connection token
* Heartbeat interval
* Connection timeout

### Playwright-managed web server

The expected default is for Playwright to start and stop the proxy using its existing `webServer` configuration.

Conceptually:

```ts
import { defineConfig } from "@playwright/test";

const proxyUrl = "http://127.0.0.1:4310";

export default defineConfig({
  webServer: [
    {
      command:
        "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
      url: `${proxyUrl}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run start:e2e",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      env: {
        PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: proxyUrl,
      },
    },
  ],
});
```

This allows Playwright to manage the proxy as another supporting test server.

The implementation should avoid requiring users to create their own custom process-management system.

### Playwright fixture integration

The Playwright package should export a fixture-enabled `test` module that users can compose with their own fixture modules through Playwright’s `mergeTests()`.

Conceptually, the package may expose:

```ts
import { test as base } from "@playwright/test";

export const test = base.extend({
  backendMocks: async ({}, use, testInfo) => {
    // Connect to the proxy and create a test-scoped controller.
  },
});
```

A consumer with existing fixtures could compose them:

```ts
import { mergeTests } from "@playwright/test";
import { test as applicationTest } from "./application-fixtures";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";

export const test = mergeTests(
  applicationTest,
  backendMocksTest,
);

export { expect } from "@playwright/test";
```

Tests would then import the project’s locally composed `test`:

```ts
import { test, expect } from "./fixtures";

test("handles a declined payment", async ({
  page,
  backendMocks,
}) => {
  await backendMocks.route(
    "https://payments.example.test/charges",
    async (route) => {
      await route.fulfill({
        status: 402,
        json: {
          error: "card_declined",
        },
      });
    },
  );

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(
    page.getByText("Your card was declined"),
  ).toBeVisible();
});
```

The package does not need to replace the user’s existing fixture ecosystem. It should provide a normal Playwright fixture module that composes through Playwright’s established fixture mechanisms.

### Playwright-side proxy configuration

The Playwright fixture must know how to connect to the standalone proxy.

A typed Playwright fixture option configured through `use` is a likely approach:

```ts
export default defineConfig({
  use: {
    backendMocksProxyUrl: "http://127.0.0.1:4310",
  },
});
```

Another simple configuration mechanism may be selected if it produces a better experience.

The Node interceptor and Playwright fixture are separate consumers, and both must know the proxy URL.

### Typical request lifecycle

The expected lifecycle is:

```text
1. A Playwright test registers a route.
2. The Playwright fixture sends the serializable matcher to the proxy.
3. The proxy associates the matcher with the test and WebSocket connection.
4. The Node process makes a supported outbound HTTP request.
5. @mswjs/interceptors captures and normalizes the request.
6. The Node agent sends the normalized request to the proxy.
7. The proxy evaluates all active matchers.
8. If exactly one matcher matches, the proxy sends the request to its worker.
9. The worker executes the route handler.
10. The worker returns fulfill, continue, fetch, abort, or another supported action.
11. The proxy returns the decision to the Node agent.
12. The Node agent applies the result through the interceptor controller.
13. The originating HTTP client observes the mocked response, passthrough, or failure.
14. The fixture removes its routes during test teardown.
```

If no route matches, the proxy instructs the Node agent to allow passthrough.

If multiple routes match, the proxy treats that as an ambiguity error.

## Proxy Behavior

The proxy is the central coordinator.

It should:

* Receive normalized requests from Node agents
* Preserve the original destination and relevant request information
* Maintain route registrations
* Associate registrations with Playwright connections and tests
* Match incoming requests
* Dispatch matching requests to Playwright workers
* Instruct Node agents to pass through unmatched requests
* Coordinate continued or upstream requests
* Return mocked responses
* Coordinate supported failures
* Record request and response history
* Expose health and REST observability endpoints
* Clean up disconnected workers, agents, and abandoned routes
* Track request cancellation and pending work
* Reject incompatible protocol versions

The Node integration should not function as an ordinary network proxy. It should intercept locally and communicate decisions through the coordinator protocol.

The proxy remains the conceptual proxy because it centrally controls routing and request outcomes, even though the actual low-level HTTP interception occurs inside each Node process.

## Node-Agent-to-Proxy Communication

Each participating Node process should maintain a persistent connection to the proxy, likely using WebSockets.

A Node-agent connection should support at least:

* Handshake
* Client registration
* Intercepted request submission
* Request cancellation
* Mocked response decisions
* Passthrough decisions
* Failure decisions
* Completion events
* Error propagation
* Ping and liveness checks
* Graceful disposal

The Node agent should remain thin and delegate matching and coordination to the proxy.

## Playwright-to-Proxy Communication

Playwright workers should use persistent WebSocket connections to communicate with the standalone proxy.

A connection should support at least:

* Handshake
* Test registration
* Route registration
* Route removal
* Incoming matched request events
* Handler results
* Test teardown
* Test failure propagation
* Error propagation
* Ping and liveness checks

The exact connection granularity—per test or per worker—may be chosen after considering simplicity and reliability.

Protocol messages should be strongly typed and runtime validated.

## Shared Protocol and Type Integrity

Cross-package protocol integrity is a first-class design goal.

The repository should contain one shared protocol package, likely:

```text
@playwright-backend-mocks/protocol
```

All WebSocket and cross-process messages must be defined there.

The Node, Playwright, and proxy packages must import protocol types, validators, and serialization helpers from that package.

They must not maintain independent copies.

Use discriminated unions for message families:

```ts
type NodeToProxyMessage =
  | {
      readonly type: "request:start";
      readonly requestId: string;
      readonly request: SerializedRequest;
    }
  | {
      readonly type: "request:cancel";
      readonly requestId: string;
    };
```

Incoming data must be runtime validated.

Do not write:

```ts
const message = JSON.parse(data) as NodeToProxyMessage;
```

Instead, parse through the canonical protocol schema:

```ts
const message = parseNodeToProxyMessage(
  JSON.parse(data),
);
```

The type should ideally be inferred from the runtime schema so that static and runtime definitions cannot drift.

The implementer may select a schema library or create small purpose-built validators, but there should be one source of truth.

The protocol should include:

* A protocol version
* Package versions in the handshake
* Explicit connection roles
* Stable message discriminants
* Shared request serialization
* Shared response serialization
* Shared header serialization
* Shared body encoding
* Shared error serialization
* Exhaustive handling requirements
* Clear compatibility failures

All participating packages should normally use the same release version.

Cross-package contract tests must prove that:

* Each sender can serialize messages accepted by the receiver
* Each receiver rejects invalid messages
* Built package outputs remain compatible
* Protocol-version mismatches fail clearly

## Route Matching and Ownership

Playwright workers register routes with the proxy and keep live matchers locally.

The proxy is solely authoritative for global route **ownership**: it broadcasts each request to every Playwright test with active routes, waits for all claim replies, then applies the zero / one / many rule. Matcher evaluation itself runs in the Playwright workers.

The Node package should never decide which Playwright registration owns a request.

For every incoming request:

* Zero matches: pass through by default.
* One match: dispatch to that route’s Playwright connection.
* Multiple matches: fail loudly.

Multiple-match diagnostics should identify all matching registrations, including available information such as:

* Matcher
* Test name
* Test file
* Worker
* Node client identifier
* Registration location

Every affected Playwright test should fail.

The corresponding Node request should fail with an actionable error indicating that backend mock routing was ambiguous.

Tests that run concurrently are responsible for registering mutually exclusive routes. Serial execution is an available fallback when this is impractical.

## Public Routing API

The exact public API should be designed after researching Playwright’s current surface.

The goal is to support the common Playwright routing experience without copying every advanced capability.

Likely concepts include:

* `route`
* `unroute`
* `fulfill`
* `continue`
* `fetch`
* `abort`
* Request inspection
* Request spying
* Waiting for requests
* Request history

Support the most valuable matcher forms and handler operations without substantially complicating the implementation.

Serializable matcher metadata may still be registered with the proxy for diagnostics and history filters.

Predicate functions are evaluated in Playwright workers during claim broadcast. The proxy never executes predicate bodies.

## Unmatched Requests

Unmatched requests should pass through by default.

The proxy should instruct the Node agent to let the intercepted request proceed normally.

Real external traffic should not require a separate opt-in.

The documentation should clearly warn users that unmatched requests may reach real services.

## Passthrough and Response Modification

`continue()` should allow the original request to reach the real upstream service through the originating Node process and HTTP client wherever practical.

This preserves the application process’s networking environment and lets `@mswjs/interceptors` observe the real response.

Support the common Playwright workflow in which a handler:

1. Requests the real upstream response.
2. Inspects or modifies it.
3. Fulfills the intercepted request using the modified response.

The exact distributed mechanics should be designed carefully because the upstream request occurs in the Node process while the handler executes in the Playwright process.

Follow Playwright’s naming and mental model where practical.

Do not implement obscure response-manipulation features if they would add substantial complexity.

## Failure Simulation

Support common network and client failure scenarios where practical.

Potential examples include:

* Generic network error
* Timeout
* Indefinitely pending request
* Explicit abort
* Connection refusal
* Connection reset
* DNS failure
* TLS failure

Research `@mswjs/interceptors`, Fetch, Axios, and Node HTTP behavior.

Use `controller.respondWith()`, `controller.errorWith()`, passthrough behavior, delayed resolution, and other supported mechanisms as appropriate.

Applications may observe different errors depending on the originating HTTP client. The goal is to reproduce each supported client’s behavior as accurately as reasonably possible rather than forcing every client to observe an identical custom error.

Perfect emulation of every operating system, transport, and Node version is not required.

The public failure API should remain stable and understandable even when underlying clients expose different error details.

## Route and Connection Lifecycle

Routes should be scoped to tests.

Normal Playwright teardown should:

* Unregister the test
* Remove its routes
* Reject or resolve pending work according to documented behavior
* Release associated resources

If a Playwright WebSocket disconnects unexpectedly:

* Remove its routes immediately
* Fail the associated test
* Reject pending requests routed to that connection
* Produce actionable diagnostics

If a Node-agent WebSocket disconnects unexpectedly:

* Mark the client as disconnected
* Reject pending coordination work associated with it
* Surface clear errors
* Avoid silently leaving intercepted requests unresolved

Use a simple ping or heartbeat mechanism and configurable inactivity timeouts to identify abandoned connections.

## Request Spying

The proxy naturally observes requests and should expose that information through the Playwright API.

Tests should be able to:

* Inspect requests received by a route
* Assert that a request occurred
* Inspect request method, URL, headers, and body
* Identify the originating Node client
* Count matching requests
* Wait for a matching request

The exact assertion API is left to the implementer.

Prefer APIs that feel familiar to Playwright users and integrate naturally with normal assertions.

## Dashboard

The proxy should expose a lightweight, read-only REST API for observability (for example `/api/history` and `/api/connections`). An optional dashboard UI may be shipped as a **separate package and process** that consumes that API, so installing the proxy does not require downloading UI assets.

The dashboard should show useful observability information, including:

* Request URL
* Method
* Node client identifier
* Timing
* Mocked, forwarded, or failed status
* Matching route
* Request headers and body
* Response status, headers, and body
* Errors
* Playwright test ownership
* Pending requests
* Connected Node agents and Playwright workers

The dashboard may allow downloading or exporting captured request data.

Keep the dashboard focused on read-only inspection.

The dashboard should not manage routes or mutate proxy state in version 1.

## Request History

Maintain request history in memory.

Use a high default retention limit. The exact default may be selected by the implementer.

Allow retention to be configured through the proxy CLI.

The implementation should prevent clearly unbounded memory growth while avoiding limits that interfere with ordinary test runs.

## Repository and Packages

Use a pnpm monorepo.

The repository should be capable of:

* Building all packages
* Sharing internal packages cleanly
* Testing packages together
* Publishing packages independently while sharing a version
* Running fixture applications
* Running real Playwright tests
* Enforcing linting and type checking
* Testing built package artifacts
* Preventing dependency and protocol drift

Likely package boundaries are:

* `@playwright-backend-mocks/playwright`
* `@playwright-backend-mocks/node`
* `@playwright-backend-mocks/proxy`
* `@playwright-backend-mocks/protocol`

The protocol package may remain internal if publishing it provides no user value, but all runtime packages must consume the same built protocol implementation.

Package boundaries should be selected for clarity rather than minimizing package count.

All public packages should use the `@playwright-backend-mocks` npm scope.

Use pnpm workspace dependencies so packages consume one another through explicit package boundaries rather than fragile source-level aliases.

## Module Formats

Published packages should support:

* ESM
* CommonJS

Ensure package exports, declarations, and build outputs work correctly in both environments.

Do not allow dual-package support to weaken type safety or produce duplicate runtime state.

Take special care that shared protocol constants and runtime validators are not duplicated in ways that create inconsistent behavior.

## Versioning

Version all published packages together.

All packages participating in the protocol should normally use the same version.

Document that mismatched versions may produce compatibility errors and that users should keep all `@playwright-backend-mocks` packages aligned.

Include a protocol version in cross-process handshakes so incompatible versions fail immediately and clearly.

## Testing Philosophy

Favor broad, real cross-process testing.

The most important tests should exercise the package exactly as users will:

```text
Playwright test
    → Playwright fixture
    → WebSocket
    → standalone proxy
    → WebSocket
    → Node interception agent
    → @mswjs/interceptors
    → application HTTP client
```

The repository should include small fixture processes such as:

* A web application using Fetch
* A web application or worker using Axios
* A process using `node:http` or another supported client
* A background worker
* A fake upstream HTTP server

Important cross-process scenarios should include:

* Basic mocked responses
* Dynamic route handlers
* Request inspection
* Spying and request counts
* Passthrough
* Response modification
* Failure simulation
* Abort behavior
* Multiple Node.js processes
* Multiple HTTP clients
* Multiple Playwright workers
* Multiple-match failures
* Route cleanup
* Unexpected Playwright disconnects
* Unexpected Node-agent disconnects
* Unsupported transport behavior
* Protocol validation
* Protocol-version mismatches
* Dashboard and history behavior

Everything should remain local. No test should depend on the public internet.

Tests should use the built package outputs in at least one end-to-end suite so source-level workspace behavior cannot hide packaging or protocol problems.

Focused unit tests are appropriate for modules with meaningful combinatorial or protocol complexity, such as:

* Matcher behavior
* Header normalization
* Protocol schemas
* Error serialization
* Body encoding
* Exhaustive message handling
* Interceptor compatibility helpers

Unit tests should supplement rather than replace confidence from broad tests.

## Continuous Integration

CI should require:

* Dependency installation succeeds
* pnpm workspace integrity is valid
* All packages build
* Type checking passes
* ESLint passes
* Formatting checks pass
* Protocol contract tests pass
* All unit and cross-process tests pass
* Built-package smoke tests pass

These checks should run for every pull request and be required before merging.

Test supported Node.js versions where practical, prioritizing the current LTS version.

## Publishing

Publish packages to npm when a GitHub Release is created.

Use npm trusted publishing through GitHub Actions and OIDC.

Avoid long-lived npm access tokens where trusted publishing is available.

All packages should be published together with the same version.

Publishing should fail safely if builds, tests, type checking, protocol validation, or package validation do not pass.

## License

MIT.

## Final Engineering Guidance

Treat this specification as a statement of intent, not a substitute for engineering judgment.

The implementer should research, prototype, measure, and learn during development.

When this document suggests an implementation detail, it should normally be understood as:

> This appears to be a straightforward way to deliver the intended experience, but use a better approach if one is discovered.

Preserve the central vision:

* Backend HTTP mocking controlled from Playwright
* Broad Node.js client support through low-level interception
* Familiar Playwright-like ergonomics
* Minimal application integration
* One shared standalone proxy and coordinator
* Centralized route matching
* Thin Node and Playwright clients
* One canonical, runtime-validated protocol
* Strong TypeScript
* A pnpm monorepo
* Broad cross-process testing
* Clear failures
* Simple, maintainable implementation

Within those boundaries, choose the architecture and API that produce the best library.
