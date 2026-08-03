import {
  matchSerializedMatcher,
  type SerializedRequest,
} from "@playwright-backend-mocks/protocol";
import {
  getRouteUrlPredicate,
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
 */
export function matchRouteMatcher(
  input: RouteMatcherInput,
  matchInput: LocalMatchInput,
  methodFilter?: string,
): boolean {
  const predicate = getRouteUrlPredicate(input);
  if (predicate !== undefined) {
    const filters = toSerializedMatcher(stripUrl(input), methodFilter);
    if (!matchSerializedMatcher(filters, matchInput)) {
      return false;
    }
    const url = tryParseUrl(matchInput.request.url);
    return url !== null && predicate(url);
  }

  return matchSerializedMatcher(toSerializedMatcher(input, methodFilter), matchInput);
}

function stripUrl(input: RouteMatcherInput): RouteMatcherInput {
  if (typeof input === "function") {
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
