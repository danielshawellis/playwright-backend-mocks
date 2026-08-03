import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  decodeBody,
  encodeBody,
  type SerializedRequest,
  type SerializedResponse,
} from "@playwright-backend-mocks/protocol";
import type {
  BackendRequest,
  BackendResponse,
  BackendRoute,
  RouteFromJSONOptions,
  RouteHandler,
  RouteMatcherInput,
} from "./types.js";

export const ROUTE_FROM_JSON_VERSION = 1 as const;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface RouteFromJSONEntry {
  readonly request: SerializedRequest;
  readonly response: SerializedResponse;
}

export interface RouteFromJSONFile {
  readonly version: typeof ROUTE_FROM_JSON_VERSION;
  readonly entries: RouteFromJSONEntry[];
}

export interface RouteFromJSONSession {
  readonly filePath: string;
  readonly options: ResolvedRouteFromJSONOptions;
  readonly entries: RouteFromJSONEntry[];
  readonly update: boolean;
  readonly matcher: RouteMatcherInput;
  readonly handler: RouteHandler;
}

interface ResolvedRouteFromJSONOptions {
  readonly url?: string | RegExp;
  readonly update: boolean;
  readonly notFound: "abort" | "fallback";
}

export function resolveRouteFromJSONPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function createRouteFromJSONSession(
  filePath: string,
  options: RouteFromJSONOptions = {},
): RouteFromJSONSession {
  const resolvedPath = resolveRouteFromJSONPath(filePath);
  const resolved: ResolvedRouteFromJSONOptions = {
    ...(options.url !== undefined ? { url: options.url } : {}),
    update: options.update === true,
    notFound: options.notFound ?? "abort",
  };

  const entries = resolved.update ? [] : loadRouteFromJSONFile(resolvedPath).entries;
  const matcher: RouteMatcherInput = resolved.url ?? "**/*";

  const handler: RouteHandler = resolved.update
    ? createRecordHandler(entries)
    : createReplayHandler(entries, resolved.notFound);

  return {
    filePath: resolvedPath,
    options: resolved,
    entries,
    update: resolved.update,
    matcher,
    handler,
  };
}

export function flushRouteFromJSONSession(session: RouteFromJSONSession): void {
  if (!session.update) {
    return;
  }
  writeRouteFromJSONFile(session.filePath, {
    version: ROUTE_FROM_JSON_VERSION,
    entries: session.entries,
  });
}

export function loadRouteFromJSONFile(filePath: string): RouteFromJSONFile {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `routeFromJSON: failed to read ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `routeFromJSON: invalid JSON in ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return parseRouteFromJSONFile(parsed, filePath);
}

export function writeRouteFromJSONFile(filePath: string, file: RouteFromJSONFile): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export function parseRouteFromJSONFile(
  value: unknown,
  filePath = "<memory>",
): RouteFromJSONFile {
  if (!isRecord(value)) {
    throw new Error(`routeFromJSON: expected an object in ${filePath}`);
  }
  if (value.version !== ROUTE_FROM_JSON_VERSION) {
    throw new Error(
      `routeFromJSON: unsupported version ${String(value.version)} in ${filePath}`,
    );
  }
  if (!Array.isArray(value.entries)) {
    throw new Error(`routeFromJSON: expected entries array in ${filePath}`);
  }

  const entries = value.entries.map((entry, index) =>
    parseEntry(entry, `${filePath} entries[${index}]`),
  );

  return {
    version: ROUTE_FROM_JSON_VERSION,
    entries,
  };
}

export function findRouteFromJSONResponse(
  entries: readonly RouteFromJSONEntry[],
  request: Pick<SerializedRequest, "url" | "method" | "headers" | "bodyBase64">,
): RouteFromJSONEntry | undefined {
  let url = request.url;
  let method = request.method;
  const headers = request.headers;
  const postData = decodeBody(request.bodyBase64);
  const visited = new Set<RouteFromJSONEntry>();

  while (true) {
    const matches: RouteFromJSONEntry[] = [];
    for (const candidate of entries) {
      if (candidate.request.url !== url || candidate.request.method !== method) {
        continue;
      }

      if (
        method === "POST" &&
        postData !== null &&
        candidate.request.bodyBase64 !== null
      ) {
        const candidateBody = decodeBody(candidate.request.bodyBase64);
        if (candidateBody === null) {
          continue;
        }
        if (!candidateBody.equals(postData)) {
          const boundary = multipartBoundary(headers);
          if (boundary === undefined) {
            continue;
          }
          const candidateBoundary = multipartBoundary(candidate.request.headers);
          if (candidateBoundary === undefined) {
            continue;
          }
          if (
            postData.toString("utf8").split(boundary).join("") !==
            candidateBody.toString("utf8").split(candidateBoundary).join("")
          ) {
            continue;
          }
        }
      }

      matches.push(candidate);
    }

    if (matches.length === 0) {
      return undefined;
    }

    let entry = matches[0]!;
    if (matches.length > 1) {
      const ranked = matches.map((candidate) => ({
        candidate,
        matchingHeaders: countMatchingHeaders(candidate.request.headers, headers),
      }));
      ranked.sort((a, b) => b.matchingHeaders - a.matchingHeaders);
      entry = ranked[0]!.candidate;
    }

    if (visited.has(entry)) {
      throw new Error(`routeFromJSON: found redirect cycle for ${url}`);
    }
    visited.add(entry);

    const locationHeader = Object.entries(entry.response.headers).find(
      ([name]) => name.toLowerCase() === "location",
    )?.[1];

    if (REDIRECT_STATUS.has(entry.response.status) && locationHeader !== undefined) {
      const locationURL = new URL(locationHeader, url);
      url = locationURL.toString();
      if (
        ((entry.response.status === 301 || entry.response.status === 302) &&
          method === "POST") ||
        (entry.response.status === 303 && !["GET", "HEAD"].includes(method))
      ) {
        method = "GET";
      }
      continue;
    }

    return entry;
  }
}

export function serializeBackendRequest(request: BackendRequest): SerializedRequest {
  return {
    url: request.url,
    method: request.method,
    headers: { ...request.headers },
    bodyBase64: encodeBody(request.postDataBuffer),
  };
}

export function serializeBackendResponse(response: BackendResponse): SerializedResponse {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: { ...response.headers },
    bodyBase64: encodeBody(response.body),
  };
}

function createRecordHandler(entries: RouteFromJSONEntry[]): RouteHandler {
  return async (route, request) => {
    const response = await route.fetch();
    entries.push({
      request: serializeBackendRequest(request),
      response: serializeBackendResponse(response),
    });
    await route.fulfill({ response });
  };
}

function createReplayHandler(
  entries: readonly RouteFromJSONEntry[],
  notFound: "abort" | "fallback",
): RouteHandler {
  return async (route, request) => {
    const entry = findRouteFromJSONResponse(entries, {
      url: request.url,
      method: request.method,
      headers: { ...request.headers },
      bodyBase64: encodeBody(request.postDataBuffer),
    });

    if (entry === undefined) {
      if (notFound === "abort") {
        await route.abort();
        return;
      }
      await route.continue();
      return;
    }

    await fulfillFromEntry(route, entry);
  };
}

async function fulfillFromEntry(
  route: BackendRoute,
  entry: RouteFromJSONEntry,
): Promise<void> {
  const body = decodeBody(entry.response.bodyBase64) ?? Buffer.alloc(0);
  await route.fulfill({
    status: entry.response.status,
    headers: { ...entry.response.headers },
    body,
  });
}

function parseEntry(value: unknown, label: string): RouteFromJSONEntry {
  if (!isRecord(value)) {
    throw new Error(`routeFromJSON: expected entry object at ${label}`);
  }
  return {
    request: parseSerializedRequest(value.request, `${label}.request`),
    response: parseSerializedResponse(value.response, `${label}.response`),
  };
}

function parseSerializedRequest(value: unknown, label: string): SerializedRequest {
  if (!isRecord(value)) {
    throw new Error(`routeFromJSON: expected request object at ${label}`);
  }
  if (typeof value.url !== "string" || value.url.length === 0) {
    throw new Error(`routeFromJSON: invalid url at ${label}`);
  }
  if (typeof value.method !== "string" || value.method.length === 0) {
    throw new Error(`routeFromJSON: invalid method at ${label}`);
  }
  if (!isStringRecord(value.headers)) {
    throw new Error(`routeFromJSON: invalid headers at ${label}`);
  }
  if (value.bodyBase64 !== null && typeof value.bodyBase64 !== "string") {
    throw new Error(`routeFromJSON: invalid bodyBase64 at ${label}`);
  }
  return {
    url: value.url,
    method: value.method,
    headers: value.headers,
    bodyBase64: value.bodyBase64,
  };
}

function parseSerializedResponse(value: unknown, label: string): SerializedResponse {
  if (!isRecord(value)) {
    throw new Error(`routeFromJSON: expected response object at ${label}`);
  }
  if (
    typeof value.status !== "number" ||
    !Number.isInteger(value.status) ||
    value.status < 0 ||
    value.status > 599
  ) {
    throw new Error(`routeFromJSON: invalid status at ${label}`);
  }
  if (typeof value.statusText !== "string") {
    throw new Error(`routeFromJSON: invalid statusText at ${label}`);
  }
  if (!isStringRecord(value.headers)) {
    throw new Error(`routeFromJSON: invalid headers at ${label}`);
  }
  if (value.bodyBase64 !== null && typeof value.bodyBase64 !== "string") {
    throw new Error(`routeFromJSON: invalid bodyBase64 at ${label}`);
  }
  return {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
    bodyBase64: value.bodyBase64,
  };
}

function countMatchingHeaders(
  entryHeaders: Record<string, string>,
  requestHeaders: Record<string, string>,
): number {
  const set = new Set(
    Object.entries(requestHeaders).map(
      ([name, value]) => `${name.toLowerCase()}:${value}`,
    ),
  );
  let matches = 0;
  for (const [name, value] of Object.entries(entryHeaders)) {
    if (set.has(`${name.toLowerCase()}:${value}`)) {
      matches += 1;
    }
  }
  return matches;
}

function multipartBoundary(headers: Record<string, string>): string | undefined {
  const contentType = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  if (contentType === undefined || !contentType.includes("multipart/form-data")) {
    return undefined;
  }
  const boundary = contentType.match(/boundary=(\S+)/);
  return boundary?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}
