import {
  matchSerializedMatcher,
  type SerializedRequest,
} from "@playwright-backend-mocks/protocol";
import { toSerializedMatcher, type RouteMatcherInput } from "./types.js";

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
  return matchSerializedMatcher(
    toSerializedMatcher(input, methodFilter),
    matchInput,
  );
}
