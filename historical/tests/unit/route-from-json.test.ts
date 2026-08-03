import { describe, expect, it } from "vitest";
import { encodeBody } from "@playwright-backend-mocks/protocol";
import {
  findRouteFromJSONResponse,
  parseRouteFromJSONFile,
  type RouteFromJSONEntry,
} from "@playwright-backend-mocks/playwright";

function entry(
  request: Partial<RouteFromJSONEntry["request"]> &
    Pick<RouteFromJSONEntry["request"], "url" | "method">,
  response: Partial<RouteFromJSONEntry["response"]> &
    Pick<RouteFromJSONEntry["response"], "status">,
): RouteFromJSONEntry {
  return {
    request: {
      headers: {},
      bodyBase64: null,
      ...request,
    },
    response: {
      statusText: "",
      headers: {},
      bodyBase64: null,
      ...response,
    },
  };
}

describe("parseRouteFromJSONFile", () => {
  it("accepts a valid cassette", () => {
    const file = parseRouteFromJSONFile({
      version: 1,
      entries: [
        entry(
          { url: "https://api.test/users", method: "GET" },
          { status: 200, bodyBase64: encodeBody('{"ok":true}') },
        ),
      ],
    });
    expect(file.entries).toHaveLength(1);
  });

  it("rejects unsupported versions", () => {
    expect(() => parseRouteFromJSONFile({ version: 2, entries: [] })).toThrow(
      /unsupported version/,
    );
  });
});

describe("findRouteFromJSONResponse", () => {
  it("matches URL and method strictly", () => {
    const entries = [
      entry({ url: "https://api.test/users", method: "GET" }, { status: 200 }),
      entry({ url: "https://api.test/users", method: "POST" }, { status: 201 }),
    ];

    expect(
      findRouteFromJSONResponse(entries, {
        url: "https://api.test/users",
        method: "POST",
        headers: {},
        bodyBase64: null,
      })?.response.status,
    ).toBe(201);
  });

  it("matches POST bodies strictly", () => {
    const entries = [
      entry(
        {
          url: "https://api.test/charges",
          method: "POST",
          bodyBase64: encodeBody(JSON.stringify({ amount: 1 })),
        },
        { status: 201, bodyBase64: encodeBody('{"id":"a"}') },
      ),
      entry(
        {
          url: "https://api.test/charges",
          method: "POST",
          bodyBase64: encodeBody(JSON.stringify({ amount: 2 })),
        },
        { status: 201, bodyBase64: encodeBody('{"id":"b"}') },
      ),
    ];

    expect(
      findRouteFromJSONResponse(entries, {
        url: "https://api.test/charges",
        method: "POST",
        headers: {},
        bodyBase64: encodeBody(JSON.stringify({ amount: 2 })),
      })?.response.bodyBase64,
    ).toBe(encodeBody('{"id":"b"}'));
  });

  it("picks the entry with the most matching headers", () => {
    const entries = [
      entry(
        {
          url: "https://api.test/users",
          method: "GET",
          headers: { accept: "application/json" },
        },
        { status: 200, bodyBase64: encodeBody('"first"') },
      ),
      entry(
        {
          url: "https://api.test/users",
          method: "GET",
          headers: {
            accept: "application/json",
            "x-request-id": "abc",
          },
        },
        { status: 200, bodyBase64: encodeBody('"second"') },
      ),
    ];

    expect(
      findRouteFromJSONResponse(entries, {
        url: "https://api.test/users",
        method: "GET",
        headers: {
          accept: "application/json",
          "x-request-id": "abc",
          "user-agent": "test",
        },
        bodyBase64: null,
      })?.response.bodyBase64,
    ).toBe(encodeBody('"second"'));
  });

  it("does not consume entries for repeated identical requests", () => {
    const entries = [
      entry(
        { url: "https://api.test/users", method: "GET" },
        { status: 200, bodyBase64: encodeBody('"one"') },
      ),
      entry(
        { url: "https://api.test/users", method: "GET" },
        { status: 200, bodyBase64: encodeBody('"two"') },
      ),
    ];

    const request = {
      url: "https://api.test/users",
      method: "GET",
      headers: {},
      bodyBase64: null,
    };

    expect(findRouteFromJSONResponse(entries, request)?.response.bodyBase64).toBe(
      encodeBody('"one"'),
    );
    expect(findRouteFromJSONResponse(entries, request)?.response.bodyBase64).toBe(
      encodeBody('"one"'),
    );
  });

  it("follows redirects to a later entry", () => {
    const entries = [
      entry(
        { url: "https://api.test/old", method: "GET" },
        {
          status: 302,
          headers: { location: "https://api.test/new" },
        },
      ),
      entry(
        { url: "https://api.test/new", method: "GET" },
        { status: 200, bodyBase64: encodeBody('"redirected"') },
      ),
    ];

    expect(
      findRouteFromJSONResponse(entries, {
        url: "https://api.test/old",
        method: "GET",
        headers: {},
        bodyBase64: null,
      })?.response.bodyBase64,
    ).toBe(encodeBody('"redirected"'));
  });
});
