# Concepts

::: tip Placeholder
High-level concepts only — details will be expanded in a later documentation pass.
:::

## Proxy

A standalone coordinator that brokers mock decisions between Playwright tests and Node agents. It also hosts a read-only dashboard.

## Node agent

A small library installed in your application process. It intercepts outbound HTTP/HTTPS and asks the proxy how each request should be handled.

## Playwright fixture

Test-side API (`backendMocks.route`, and related helpers) that registers matchers and fulfillments for the duration of a test.

## Protocol

A shared wire protocol between the proxy, Node agent, and Playwright fixture packages.
