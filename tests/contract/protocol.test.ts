import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  parseClientToProxyMessage,
  parseProxyToClientMessage,
  safeParseClientToProxyMessage,
  stringifyMessage,
} from "@playwright-backend-mocks/protocol";

describe("protocol contract", () => {
  it("round-trips a request:start message", () => {
    const message = {
      type: "request:start" as const,
      requestId: "req-1",
      clientId: "api-server",
      request: {
        url: "https://api.example.com/users",
        method: "GET",
        headers: { accept: "application/json" },
        bodyBase64: null,
      },
    };

    const parsed = parseClientToProxyMessage(JSON.parse(stringifyMessage(message)));
    expect(parsed).toEqual(message);
  });

  it("round-trips a decision:fulfill message", () => {
    const message = {
      type: "decision:fulfill" as const,
      requestId: "req-1",
      response: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from("[]").toString("base64"),
      },
    };

    const parsed = parseProxyToClientMessage(JSON.parse(stringifyMessage(message)));
    expect(parsed).toEqual(message);
  });

  it("rejects invalid messages", () => {
    const result = safeParseClientToProxyMessage({ type: "nope" });
    expect(result.success).toBe(false);
  });

  it("exposes protocol version 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it("round-trips request:claim and request:claim-result", () => {
    const claim = {
      type: "request:claim" as const,
      requestId: "req-1",
      clientId: "api-server",
      request: {
        url: "https://api.example.com/users",
        method: "GET",
        headers: {},
        bodyBase64: null,
      },
    };
    expect(parseProxyToClientMessage(JSON.parse(stringifyMessage(claim)))).toEqual(
      claim,
    );

    const result = {
      type: "request:claim-result" as const,
      requestId: "req-1",
      testId: "test-1",
      matches: [{ routeId: "route-1" }],
    };
    expect(parseClientToProxyMessage(JSON.parse(stringifyMessage(result)))).toEqual(
      result,
    );
  });

  it("rejects protocol hello without role", () => {
    const result = safeParseClientToProxyMessage({
      type: "hello",
      protocolVersion: 2,
      packageVersion: "0.1.0",
    });
    expect(result.success).toBe(false);
  });
});
