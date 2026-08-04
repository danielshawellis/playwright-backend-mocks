// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/isomorphic/urlMatch.ts
import {
  matchSerializedMatcher,
  urlMatches,
  type SerializedRequest,
} from "@playwright-backend-mocks/protocol";
import {
  getRouteUrlPredicate,
  getRouteURLPattern,
  isURLPattern,
  toSerializedMatcher,
  type RouteMatcherInput,
} from "./types.js";

export interface LocalMatchInput {
  readonly request: SerializedRequest;
  readonly clientId: string;
  readonly baseURL?: string;
}

/**
 * Evaluate a public route matcher in the Playwright process.
 * This is the authoritative match path for backend mock routing.
 *
 * Mirrors Playwright `RouteHandler.matches` + `urlMatches` (glob / RegExp /
 * predicate / URLPattern), plus product method/clientId filters.
 */
export function matchRouteMatcher(
  input: RouteMatcherInput,
  matchInput: LocalMatchInput,
  methodFilter?: string,
): boolean {
  const predicate = getRouteUrlPredicate(input);
  const urlPattern = getRouteURLPattern(input);

  if (predicate !== undefined || urlPattern !== undefined) {
    const filters = toSerializedMatcher(stripUrl(input), methodFilter);
    if (
      !matchSerializedMatcher(filters, {
        request: matchInput.request,
        clientId: matchInput.clientId,
        baseURL: matchInput.baseURL,
      })
    ) {
      return false;
    }
    return urlMatches(
      matchInput.baseURL,
      matchInput.request.url,
      predicate ?? urlPattern,
    );
  }

  const urlPart = extractUrlMatch(input);
  if (urlPart !== undefined) {
    const filters = toSerializedMatcher(stripUrl(input), methodFilter);
    if (
      !matchSerializedMatcher(filters, {
        request: matchInput.request,
        clientId: matchInput.clientId,
        baseURL: matchInput.baseURL,
      })
    ) {
      return false;
    }
    return urlMatches(matchInput.baseURL, matchInput.request.url, urlPart);
  }

  return matchSerializedMatcher(toSerializedMatcher(input, methodFilter), {
    request: matchInput.request,
    clientId: matchInput.clientId,
    baseURL: matchInput.baseURL,
  });
}

function extractUrlMatch(input: RouteMatcherInput): string | RegExp | undefined {
  if (typeof input === "string" || input instanceof RegExp) {
    return input;
  }
  if (
    typeof input === "object" &&
    !(input instanceof RegExp) &&
    !isURLPattern(input) &&
    typeof input !== "function"
  ) {
    if (typeof input.url === "string" || input.url instanceof RegExp) {
      return input.url;
    }
  }
  return undefined;
}

function stripUrl(input: RouteMatcherInput): RouteMatcherInput {
  if (typeof input === "function" || isURLPattern(input)) {
    return {};
  }
  if (typeof input === "object" && !(input instanceof RegExp)) {
    return {
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
    };
  }
  return {};
}
