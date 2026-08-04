// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/isomorphic/urlMatch.ts
import type { SerializedMatcher, SerializedRequest } from "./schemas.js";

export interface MatchInput {
  readonly request: SerializedRequest;
  readonly clientId: string;
  // DIVERGENCE: optional baseURL so serialized glob matching can resolve relative patterns
  // the same way Playwright's client-side `urlMatches(baseURL, …)` does.
  readonly baseURL?: string;
  // DIVERGENCE END
}

/**
 * Duck-typed URLPattern shape (Playwright `@isomorphic/urlMatch` URLPattern).
 * Node may lack a global URLPattern; callers may pass urlpattern-polyfill instances.
 */
export type URLPatternLike = {
  test(input: string | URL): boolean;
  hash: string;
  hostname: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  username: string;
};

export type URLMatch = string | RegExp | ((url: URL) => boolean) | URLPatternLike;

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions#escaping
const escapedChars = new Set([
  "$",
  "^",
  "+",
  ".",
  "*",
  "(",
  ")",
  "|",
  "\\",
  "?",
  "{",
  "}",
  "[",
  "]",
]);

/**
 * Convert a Playwright URL glob to a regex source string.
 * Throws on nested / unmatched braces (eager validation at registration).
 */
export function globToRegexPattern(glob: string): string {
  const tokens = ["^"];
  let inGroup = false;
  for (let i = 0; i < glob.length; ++i) {
    const c = glob[i]!;
    if (c === "\\" && i + 1 < glob.length) {
      const char = glob[++i]!;
      tokens.push(escapedChars.has(char) ? "\\" + char : char);
      continue;
    }
    if (c === "*") {
      const charBefore = glob[i - 1];
      let starCount = 1;
      while (glob[i + 1] === "*") {
        starCount++;
        i++;
      }
      if (starCount > 1) {
        const charAfter = glob[i + 1];
        // Match either /..something../ or /.
        if (charAfter === "/") {
          if (charBefore === "/") {
            tokens.push("((.+/)|)");
          } else {
            tokens.push("(.*/)");
          }
          ++i;
        } else {
          tokens.push("(.*)");
        }
      } else {
        tokens.push("([^/]*)");
      }
      continue;
    }

    switch (c) {
      case "{":
        if (inGroup) {
          throw new Error(
            `Invalid glob pattern ${JSON.stringify(glob)}: nested '{' is not supported`,
          );
        }
        inGroup = true;
        tokens.push("(");
        break;
      case "}":
        if (!inGroup) {
          throw new Error(`Invalid glob pattern ${JSON.stringify(glob)}: unmatched '}'`);
        }
        inGroup = false;
        tokens.push(")");
        break;
      case ",":
        if (inGroup) {
          tokens.push("|");
          break;
        }
        tokens.push("\\" + c);
        break;
      default:
        tokens.push(escapedChars.has(c) ? "\\" + c : c);
    }
  }
  if (inGroup) {
    throw new Error(`Invalid glob pattern ${JSON.stringify(glob)}: unmatched '{'`);
  }
  tokens.push("$");
  return tokens.join("");
}

function isRegExp(obj: unknown): obj is RegExp {
  return (
    obj instanceof RegExp || Object.prototype.toString.call(obj) === "[object RegExp]"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" || value instanceof String;
}

/**
 * Playwright `isURLPattern` plus duck-type for urlpattern-polyfill instances.
 * DIVERGENCE: Playwright uses only `instanceof globalThis.URLPattern`.
 * We also accept objects with `.test` and pathname/hostname so polyfill
 * instances work when the global constructor differs or is absent.
 */
export function isURLPatternLike(v: unknown): v is URLPatternLike {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  if (typeof (v as { test?: unknown }).test !== "function") {
    return false;
  }
  const URLPatternCtor = (
    globalThis as { URLPattern?: new (...args: never[]) => unknown }
  ).URLPattern;
  if (typeof URLPatternCtor === "function" && v instanceof URLPatternCtor) {
    return true;
  }
  return "pathname" in v && "hostname" in v;
}

export function resolveGlobToRegexPattern(
  baseURL: string | undefined,
  glob: string,
  webSocketUrl?: boolean,
): string {
  if (webSocketUrl) {
    baseURL = toWebSocketBaseUrl(baseURL);
  }
  glob = resolveGlobBase(baseURL, glob);
  return globToRegexPattern(glob);
}

function toWebSocketBaseUrl(baseURL: string | undefined): string | undefined {
  // Allow http(s) baseURL to match ws(s) urls. Schemes are case-insensitive,
  // same as elsewhere in this file, so 'HTTP://...' should be rewritten too.
  if (baseURL && /^https?:\/\//i.test(baseURL)) {
    baseURL = baseURL.replace(/^https?/i, (scheme) =>
      scheme.toLowerCase() === "https" ? "wss" : "ws",
    );
  }
  return baseURL;
}

function resolveGlobBase(baseURL: string | undefined, match: string): string {
  if (!match.startsWith("*")) {
    const tokenMap = new Map<string, string>();
    function mapToken(original: string, replacement: string): string {
      if (original.length === 0) {
        return "";
      }
      tokenMap.set(replacement, original);
      return replacement;
    }
    // Escaped `\\?` behaves the same as `?` in our glob patterns.
    match = match.replaceAll(/\\\\\?/g, "?");
    // Special case about: URLs as they are not relative to baseURL
    if (
      match.startsWith("about:") ||
      match.startsWith("data:") ||
      match.startsWith("chrome:") ||
      match.startsWith("edge:") ||
      match.startsWith("file:")
    ) {
      return match;
    }
    // Glob symbols may be escaped in the URL and some of them such as ? affect resolution,
    // so we replace them with safe components first.
    const relativePath = match
      .split("/")
      .map((token, index) => {
        if (token === "." || token === ".." || token === "") {
          return token;
        }
        // Handle special case of http*://, note that the new schema has to be
        // a web schema so that slashes are properly inserted after domain.
        if (index === 0 && token.endsWith(":")) {
          // Replace any pattern with http:
          if (token.indexOf("*") !== -1 || token.indexOf("{") !== -1) {
            return mapToken(token, "http:");
          }
          // Preserve explicit schema as is as it may affect trailing slashes after domain.
          return token;
        }
        // Components without glob metacharacters are literal, so let them round-trip
        // through new URL() to preserve normalization (default ports such as :80/:443,
        // percent-encoding, IDN hosts). Only opaque tokens defeat that normalization.
        if (!/[*?{}\\]/.test(token)) {
          return token;
        }
        const questionIndex = token.indexOf("?");
        if (questionIndex === -1) {
          return mapToken(token, `$_${index}_$`);
        }
        const newPrefix = mapToken(token.substring(0, questionIndex), `$_${index}_$`);
        const newSuffix = mapToken(token.substring(questionIndex), `?$_${index}_$`);
        return newPrefix + newSuffix;
      })
      .join("/");
    const result = resolveBaseURL(baseURL, relativePath);
    let resolved = result.resolved;
    for (const [token, original] of tokenMap) {
      const normalize = result.caseInsensitivePart?.includes(token);
      const replacement = normalize ? original.toLowerCase() : original;
      // '$$', '$&', '$`' and "$'" are special in String.prototype.replace with a string argument.
      // Instead, use the function argument form that treats the string argument literally.
      resolved = resolved.replace(token, () => replacement);
    }
    match = resolved;
  }
  return match;
}

function parseURL(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function resolveBaseURL(
  baseURL: string | undefined,
  givenURL: string,
): { resolved: string; caseInsensitivePart?: string } {
  try {
    const url = new URL(givenURL, baseURL);
    const resolved = url.toString();
    // Schema and domain are case-insensitive.
    const caseInsensitivePrefix = url.origin;
    return { resolved, caseInsensitivePart: caseInsensitivePrefix };
  } catch {
    return { resolved: givenURL };
  }
}

/**
 * Playwright `urlMatches` — empty string matches all; globs resolve against baseURL.
 */
export function urlMatches(
  baseURL: string | undefined,
  urlString: string,
  match: URLMatch | undefined,
  webSocketUrl?: boolean,
): boolean {
  if (match === undefined || match === "") {
    return true;
  }
  if (isString(match)) {
    match = new RegExp(resolveGlobToRegexPattern(baseURL, match, webSocketUrl));
  }
  if (isRegExp(match)) {
    match.lastIndex = 0;
    return match.test(urlString);
  }
  const url = parseURL(urlString);
  if (!url) {
    return false;
  }
  if (isURLPatternLike(match)) {
    return match.test(url.href);
  }
  if (typeof match !== "function") {
    throw new Error("url parameter should be string, RegExp, URLPattern or function");
  }
  return match(url);
}

/**
 * Playwright-shaped URL glob matching (convenience wrapper around `urlMatches`).
 */
export function matchUrlGlob(glob: string, url: string, baseURL?: string): boolean {
  return urlMatches(baseURL, url, glob);
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

  const { request, clientId, baseURL } = input;

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
      regex.lastIndex = 0;
      if (!regex.test(request.url)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (matcher.urlGlob !== undefined) {
    if (!urlMatches(baseURL, request.url, matcher.urlGlob)) {
      return false;
    }
  }

  // A matcher with no URL constraint still matches (method/client filters only).
  return true;
}

export function serializeRegExp(regex: RegExp): { source: string; flags: string } {
  return { source: regex.source, flags: regex.flags };
}
