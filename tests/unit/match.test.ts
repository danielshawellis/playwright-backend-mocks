import { describe, expect, it } from "vitest";
import { matchSerializedMatcher, matchUrlGlob } from "@playwright-backend-mocks/protocol";

describe("matchUrlGlob", () => {
  it("matches exact URLs", () => {
    expect(matchUrlGlob("https://api.test/users", "https://api.test/users")).toBe(true);
  });

  it("matches single-segment wildcards", () => {
    expect(matchUrlGlob("https://api.test/*", "https://api.test/users")).toBe(true);
    expect(matchUrlGlob("https://api.test/*", "https://api.test/users/1")).toBe(false);
  });

  it("matches multi-segment wildcards", () => {
    expect(matchUrlGlob("https://api.test/**", "https://api.test/users/1")).toBe(true);
  });
});

describe("matchSerializedMatcher", () => {
  const request = {
    url: "https://payments.example.test/charges",
    method: "POST",
    headers: {},
    bodyBase64: null,
  };

  it("filters by method", () => {
    expect(
      matchSerializedMatcher(
        { urlGlob: "https://payments.example.test/**", methods: ["GET"] },
        { request, clientId: "api-server" },
      ),
    ).toBe(false);

    expect(
      matchSerializedMatcher(
        { urlGlob: "https://payments.example.test/**", methods: ["POST"] },
        { request, clientId: "api-server" },
      ),
    ).toBe(true);
  });

  it("filters by client id", () => {
    expect(
      matchSerializedMatcher(
        {
          urlGlob: "https://payments.example.test/**",
          clientIds: ["job-worker"],
        },
        { request, clientId: "api-server" },
      ),
    ).toBe(false);
  });

  it("supports regex matchers", () => {
    expect(
      matchSerializedMatcher(
        { urlRegex: { source: "charges$", flags: "" } },
        { request, clientId: "api-server" },
      ),
    ).toBe(true);
  });

  it("never matches serialized predicate markers", () => {
    expect(
      matchSerializedMatcher({ predicate: true }, { request, clientId: "api-server" }),
    ).toBe(false);
  });
});
