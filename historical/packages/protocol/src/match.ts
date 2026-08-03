import type { SerializedMatcher, SerializedRequest } from "./schemas.js";

export interface MatchInput {
  readonly request: SerializedRequest;
  readonly clientId: string;
}

/**
 * Playwright-like URL glob matching.
 * - `*` matches within a path segment
 * - `**` matches across segments
 * Full URLs are matched against the absolute request URL.
 */
export function matchUrlGlob(glob: string, url: string): boolean {
  if (glob === url) {
    return true;
  }

  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "@@GLOBSTAR@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@GLOBSTAR@@/g, ".*");

  return new RegExp(`^${escaped}$`).test(url);
}

export function matchSerializedMatcher(
  matcher: SerializedMatcher,
  input: MatchInput,
): boolean {
  // Predicate bodies only exist in Playwright workers. A serialized marker must
  // not behave like an unconstrained matcher in the proxy or other processes.
  if (matcher.predicate === true) {
    return false;
  }

  const { request, clientId } = input;

  if (matcher.methods !== undefined && matcher.methods.length > 0) {
    const method = request.method.toUpperCase();
    const allowed = matcher.methods.map((m) => m.toUpperCase());
    if (!allowed.includes(method)) {
      return false;
    }
  }

  if (matcher.clientIds !== undefined && matcher.clientIds.length > 0) {
    if (!matcher.clientIds.includes(clientId)) {
      return false;
    }
  }

  if (matcher.urlRegex !== undefined) {
    try {
      const regex = new RegExp(matcher.urlRegex.source, matcher.urlRegex.flags);
      if (!regex.test(request.url)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (matcher.urlGlob !== undefined) {
    if (!matchUrlGlob(matcher.urlGlob, request.url)) {
      return false;
    }
  }

  // A matcher with no URL constraint still matches (method/client filters only).
  return true;
}

export function serializeRegExp(regex: RegExp): { source: string; flags: string } {
  return { source: regex.source, flags: regex.flags };
}
