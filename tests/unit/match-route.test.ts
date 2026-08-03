import { describe, expect, it } from "vitest";
import { matchRouteMatcher } from "@playwright-backend-mocks/playwright";

const request = {
  url: "https://payments.example.test/charges?debug=1",
  method: "POST",
  headers: {},
  bodyBase64: null,
};

describe("matchRouteMatcher", () => {
  it("matches Playwright-style URL predicates", () => {
    expect(
      matchRouteMatcher(
        (url) => url.hostname === "payments.example.test" && url.pathname === "/charges",
        { request, clientId: "api-server" },
      ),
    ).toBe(true);

    expect(
      matchRouteMatcher((url) => url.pathname === "/users", {
        request,
        clientId: "api-server",
      }),
    ).toBe(false);
  });

  it("applies method and clientId filters with predicates", () => {
    expect(
      matchRouteMatcher(
        {
          url: (url) => url.searchParams.get("debug") === "1",
          method: "POST",
          clientId: "api-server",
        },
        { request, clientId: "api-server" },
      ),
    ).toBe(true);

    expect(
      matchRouteMatcher(
        {
          url: (url) => url.searchParams.get("debug") === "1",
          method: "GET",
        },
        { request, clientId: "api-server" },
      ),
    ).toBe(false);

    expect(
      matchRouteMatcher(
        {
          url: (url) => url.searchParams.get("debug") === "1",
          clientId: "job-worker",
        },
        { request, clientId: "api-server" },
      ),
    ).toBe(false);
  });

  it("still matches globs and regexes", () => {
    expect(
      matchRouteMatcher("https://payments.example.test/**", {
        request,
        clientId: "api-server",
      }),
    ).toBe(true);

    expect(
      matchRouteMatcher(/charges$/, {
        request,
        clientId: "api-server",
      }),
    ).toBe(false);

    expect(
      matchRouteMatcher(/charges\?debug=1$/, {
        request,
        clientId: "api-server",
      }),
    ).toBe(true);
  });
});
