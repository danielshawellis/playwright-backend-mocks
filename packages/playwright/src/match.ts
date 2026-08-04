// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
import {
  matchSerializedMatcher,
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
    if (!matchSerializedMatcher(filters, matchInput)) {
      return false;
    }
    const url = tryParseUrl(matchInput.request.url);
    if (url === null) {
      return false;
    }
    if (predicate !== undefined) {
      return predicate(url);
    }
    // URLPattern.test accepts a string or URLPatternInit.
    return urlPattern!.test(matchInput.request.url);
  }

  return matchSerializedMatcher(toSerializedMatcher(input, methodFilter), matchInput);
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

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
