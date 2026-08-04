// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/harRouter.ts
// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/harBackend.ts
// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/har/harTracer.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  BackendRequest,
  BackendResponse,
  BackendRoute,
  RouteFromHAROptions,
  RouteHandler,
  RouteMatcherInput,
  RouteUrlPredicate,
} from "./types.js";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  encoding?: string;
  /** Playwright attach mode: body lives in a sibling file. */
  _file?: string;
}

export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: string;
  /** Playwright attach mode: body lives in a sibling file. */
  _file?: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion?: string;
  cookies?: unknown[];
  headers: HarHeader[];
  queryString?: Array<{ name: string; value: string }>;
  headersSize?: number;
  bodySize?: number;
  postData?: HarPostData;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion?: string;
  cookies?: unknown[];
  headers: HarHeader[];
  content: HarContent;
  redirectURL?: string;
  headersSize?: number;
  bodySize?: number;
  /** Playwright failure marker (aborted / reset traffic). */
  _failureText?: string;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
}

export interface HarFile {
  log: {
    version: string;
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

export interface RouteFromHARSession {
  readonly filePath: string;
  readonly options: ResolvedRouteFromHAROptions;
  readonly entries: HarEntry[];
  readonly update: boolean;
  readonly matcher: RouteMatcherInput;
  readonly handler: RouteHandler;
  /** Pending attach blobs keyed by relative `_file` name. */
  readonly pendingBlobs: Map<string, Buffer>;
}

interface ResolvedRouteFromHAROptions {
  readonly url?: string | RegExp | RouteUrlPredicate;
  readonly update: boolean;
  readonly notFound: "abort" | "fallback";
  readonly updateContent: "attach" | "embed";
  readonly updateMode: "minimal" | "full";
}

type HarLookupResult =
  | { action: "fulfill"; entry: HarEntry; body: Buffer }
  | { action: "noentry" }
  | { action: "error"; message: string };

export function resolveRouteFromHARPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function createRouteFromHARSession(
  filePath: string,
  options: RouteFromHAROptions = {},
): RouteFromHARSession {
  const resolvedPath = resolveRouteFromHARPath(filePath);
  const resolved: ResolvedRouteFromHAROptions = {
    ...(options.url !== undefined
      ? { url: options.url as ResolvedRouteFromHAROptions["url"] }
      : {}),
    update: options.update === true,
    notFound: options.notFound ?? "abort",
    // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/tracing.ts (_recordIntoHAR)
    updateContent: options.updateContent ?? "attach",
    updateMode: options.updateMode ?? "minimal",
  };

  // DIVERGENCE: zip HAR archives / navigation-only redirect rewrite are out of scope
  // for Node outbound traffic. Plain `.har` (+ sibling `_file` attach) is supported.
  // DIVERGENCE END

  const pendingBlobs = new Map<string, Buffer>();
  let entries: HarEntry[];
  if (resolved.update) {
    entries = [];
  } else {
    entries = loadHarEntriesForReplay(resolvedPath);
  }

  const matcher: RouteMatcherInput = resolved.url ?? "**/*";
  const baseDir = path.dirname(resolvedPath);

  const handler: RouteHandler = resolved.update
    ? createRecordHandler(entries, pendingBlobs, resolved)
    : createReplayHandler(entries, baseDir, resolved.notFound);

  return {
    filePath: resolvedPath,
    options: resolved,
    entries,
    update: resolved.update,
    matcher,
    handler,
    pendingBlobs,
  };
}

export function flushRouteFromHARSession(session: RouteFromHARSession): void {
  if (!session.update) {
    return;
  }
  writeHarFile(session.filePath, session.entries, session.pendingBlobs, session.options);
}

/**
 * Load entries for replay. Bad / incomplete HAR is treated as empty so the
 * HarRouter-style handler can fall through to notFound abort/fallback instead
 * of throwing at registration time.
 * Playwright: harOpen accepts parseable JSON; lookup errors surface as action "error".
 */
function loadHarEntriesForReplay(filePath: string): HarEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return extractHarEntries(parsed);
  } catch {
    return [];
  }
}

function extractHarEntries(value: unknown): HarEntry[] {
  if (!isRecord(value) || !isRecord(value.log)) {
    return [];
  }
  const entries = value.log.entries;
  if (!Array.isArray(entries)) {
    // `{ log: {} }` — Playwright lookup throws; we surface that as lookup error.
    return [];
  }
  return entries.filter(isHarEntry) as HarEntry[];
}

function isHarEntry(value: unknown): value is HarEntry {
  if (!isRecord(value) || !isRecord(value.request) || !isRecord(value.response)) {
    return false;
  }
  return (
    typeof value.request.method === "string" &&
    typeof value.request.url === "string" &&
    typeof value.response.status === "number"
  );
}

export function writeHarFile(
  filePath: string,
  entries: readonly HarEntry[],
  pendingBlobs: Map<string, Buffer>,
  options: Pick<ResolvedRouteFromHAROptions, "updateMode">,
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const resourcesDir = path.dirname(filePath);
  for (const [name, buffer] of pendingBlobs) {
    writeFileSync(path.join(resourcesDir, name), buffer);
  }
  const har: HarFile = {
    log: {
      version: "1.2",
      creator: { name: "playwright-backend-mocks", version: "0.1.0" },
      entries: entries.map((entry) =>
        options.updateMode === "minimal" ? slimEntry(entry) : entry,
      ),
    },
  };
  writeFileSync(filePath, `${JSON.stringify(har, null, 2)}\n`, "utf8");
}

function slimEntry(entry: HarEntry): HarEntry {
  // Playwright slimMode omits cookies / timing / sizes / pages / server IP.
  return {
    startedDateTime: entry.startedDateTime,
    time: entry.time,
    request: {
      method: entry.request.method,
      url: entry.request.url,
      httpVersion: entry.request.httpVersion ?? "HTTP/1.1",
      cookies: [],
      headers: entry.request.headers,
      queryString: entry.request.queryString ?? [],
      headersSize: -1,
      bodySize: entry.request.bodySize ?? -1,
      ...(entry.request.postData !== undefined
        ? { postData: entry.request.postData }
        : {}),
    },
    response: {
      status: entry.response.status,
      statusText: entry.response.statusText,
      httpVersion: entry.response.httpVersion ?? "HTTP/1.1",
      cookies: [],
      headers: entry.response.headers,
      content: entry.response.content,
      redirectURL: entry.response.redirectURL ?? "",
      headersSize: -1,
      bodySize: entry.response.bodySize ?? -1,
      ...(entry.response._failureText !== undefined
        ? { _failureText: entry.response._failureText }
        : {}),
    },
    cache: {},
    timings: { send: -1, wait: -1, receive: -1 },
  };
}

/**
 * Playwright HarBackend.lookup + HarRouter._handle control flow (sans navigation redirect).
 */
export function lookupHarResponse(
  entries: readonly HarEntry[],
  baseDir: string,
  request: {
    url: string;
    method: string;
    headers: HarHeader[];
    postData: Buffer | undefined;
  },
): HarLookupResult {
  let entry: HarEntry | undefined;
  try {
    entry = harFindResponse(entries, baseDir, request);
  } catch (error) {
    return {
      action: "error",
      message: `HAR error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (entry === undefined) {
    return { action: "noentry" };
  }

  try {
    const body = loadHarContent(entry.response.content, baseDir);
    return { action: "fulfill", entry, body };
  } catch (error) {
    return {
      action: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/harBackend.ts (_harFindResponse)
 */
export function harFindResponse(
  entries: readonly HarEntry[],
  baseDir: string,
  request: {
    url: string;
    method: string;
    headers: HarHeader[];
    postData: Buffer | undefined;
  },
): HarEntry | undefined {
  let url = request.url;
  let method = request.method;
  const headers = request.headers;
  const postData = request.postData;
  const visited = new Set<HarEntry>();

  while (true) {
    const matches: HarEntry[] = [];
    for (const candidate of entries) {
      if (candidate.request.url !== url || candidate.request.method !== method) {
        continue;
      }
      if (method === "POST" && postData && candidate.request.postData) {
        const buffer = loadHarContent(candidate.request.postData, baseDir);
        if (!buffer.equals(postData)) {
          const boundary = multipartBoundary(headers);
          if (boundary === undefined) {
            continue;
          }
          const candidateBoundary = multipartBoundary(candidate.request.headers);
          if (candidateBoundary === undefined) {
            continue;
          }
          // Match multipart/form-data ignoring boundary as it changes between requests.
          if (
            postData.toString("utf8").split(boundary).join("") !==
            buffer.toString("utf8").split(candidateBoundary).join("")
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
      throw new Error(`Found redirect cycle for ${url}`);
    }
    visited.add(entry);

    const locationHeader = entry.response.headers.find(
      (h) => h.name.toLowerCase() === "location",
    );
    if (REDIRECT_STATUS.has(entry.response.status) && locationHeader !== undefined) {
      const locationURL = new URL(locationHeader.value, url);
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

function createReplayHandler(
  entries: readonly HarEntry[],
  baseDir: string,
  notFound: "abort" | "fallback",
): RouteHandler {
  return async (route, request) => {
    // Bad HAR with missing entries: surface as lookup error → notFound path
    // (Playwright iterates `harLog.entries` and throws when undefined).
    const result = lookupHarResponse(entries, baseDir, {
      url: request.url(),
      method: request.method(),
      headers: headersToArray(request.headers()),
      postData: request.postDataBuffer() || undefined,
    });

    if (result.action === "fulfill") {
      // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/harRouter.ts
      // status -1 → stall (do not fulfill / abort / fallback).
      if (result.entry.response.status === -1) {
        return;
      }
      await fulfillFromHar(route, result.entry, result.body);
      return;
    }

    if (result.action === "error") {
      // Report the error, but fall through to the default handler (Playwright).
    }

    if (notFound === "abort") {
      await route.abort();
      return;
    }
    await route.fallback();
  };
}

function createRecordHandler(
  entries: HarEntry[],
  pendingBlobs: Map<string, Buffer>,
  options: ResolvedRouteFromHAROptions,
): RouteHandler {
  return async (route, request) => {
    try {
      const response = await route.fetch();
      entries.push(buildHarEntryFromExchange(request, response, pendingBlobs, options));
      await route.fulfill({ response });
    } catch (error) {
      // Playwright records aborted/reset traffic with status -1 + _failureText.
      const failureText = error instanceof Error ? error.message : String(error);
      entries.push(buildHarFailureEntry(request, failureText, options));
      await route.abort();
    }
  };
}

function buildHarEntryFromExchange(
  request: BackendRequest,
  response: BackendResponse,
  pendingBlobs: Map<string, Buffer>,
  options: ResolvedRouteFromHAROptions,
): HarEntry {
  const requestHeaders = headersToArray(request.headers());
  const responseHeaders = headersToArray(response.headers());
  const postBuffer = request.postDataBuffer();
  const body = response.bodyBuffer;
  const contentType =
    response.headerValue("content-type") ??
    responseHeaders.find((h) => h.name.toLowerCase() === "content-type")?.value ??
    "x-unknown";

  const content = storeContent(body, contentType, options.updateContent, pendingBlobs);
  const postData =
    postBuffer !== null && postBuffer.length > 0
      ? storePostData(
          postBuffer,
          request.headers()["content-type"],
          options.updateContent,
          pendingBlobs,
        )
      : postBuffer !== null
        ? storePostData(
            postBuffer,
            request.headers()["content-type"],
            options.updateContent,
            pendingBlobs,
          )
        : undefined;

  return {
    startedDateTime: new Date().toISOString(),
    time: options.updateMode === "minimal" ? -1 : 0,
    request: {
      method: request.method(),
      url: request.url(),
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: requestHeaders,
      queryString: queryStringFromUrl(request.url()),
      headersSize: -1,
      bodySize: postBuffer?.length ?? 0,
      ...(postData !== undefined ? { postData } : {}),
    },
    response: {
      status: response.status(),
      statusText: response.statusText(),
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: responseHeaders,
      content,
      redirectURL: response.headerValue("location") ?? "",
      headersSize: -1,
      bodySize: body.length,
    },
    cache: {},
    timings: { send: -1, wait: -1, receive: -1 },
  };
}

function buildHarFailureEntry(
  request: BackendRequest,
  failureText: string,
  options: ResolvedRouteFromHAROptions,
): HarEntry {
  const postBuffer = request.postDataBuffer();
  const postData =
    postBuffer !== null
      ? ({
          mimeType: request.headers()["content-type"] ?? "application/octet-stream",
          text: options.updateContent === "embed" ? postBuffer.toString("utf8") : "",
        } satisfies HarPostData)
      : undefined;

  return {
    startedDateTime: new Date().toISOString(),
    time: -1,
    request: {
      method: request.method(),
      url: request.url(),
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToArray(request.headers()),
      queryString: queryStringFromUrl(request.url()),
      headersSize: -1,
      bodySize: postBuffer?.length ?? -1,
      ...(postData !== undefined ? { postData } : {}),
    },
    response: {
      status: -1,
      statusText: "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: [],
      content: {
        size: -1,
        mimeType: "x-unknown",
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
      _failureText: failureText,
    },
    cache: {},
    timings: { send: -1, wait: -1, receive: -1 },
  };
}

function storeContent(
  buffer: Buffer,
  mimeType: string,
  updateContent: "attach" | "embed",
  pendingBlobs: Map<string, Buffer>,
): HarContent {
  const content: HarContent = {
    size: buffer.length,
    mimeType,
  };
  if (updateContent === "embed") {
    if (isTextualMimeType(mimeType)) {
      content.text = buffer.toString("utf8");
    } else {
      content.text = buffer.toString("base64");
      content.encoding = "base64";
    }
    return content;
  }

  // attach — sibling file next to the HAR (zip attach remains OOS).
  const ext = extensionForMime(mimeType);
  const name = `${sha1Hex(buffer)}.${ext}`;
  content._file = name;
  pendingBlobs.set(name, buffer);
  return content;
}

function storePostData(
  buffer: Buffer,
  contentType: string | undefined,
  updateContent: "attach" | "embed",
  pendingBlobs: Map<string, Buffer>,
): HarPostData {
  const mimeType = contentType ?? "application/octet-stream";
  if (updateContent === "embed") {
    return {
      mimeType,
      text: mimeType === "application/octet-stream" ? "" : buffer.toString("utf8"),
    };
  }
  const ext = extensionForMime(mimeType);
  const name = `${sha1Hex(buffer)}.${ext}`;
  pendingBlobs.set(name, buffer);
  return { mimeType, text: "", _file: name };
}

async function fulfillFromHar(
  route: BackendRoute,
  entry: HarEntry,
  body: Buffer,
): Promise<void> {
  // Playwright merges multiple set-cookie headers with `\n`.
  const headers = entry.response.headers.reduce(
    (headersMap, { name, value }) => {
      if (name.toLowerCase() !== "set-cookie") {
        headersMap[name] = value;
      } else if (!headersMap["set-cookie"]) {
        headersMap["set-cookie"] = value;
      } else {
        headersMap["set-cookie"] += `\n${value}`;
      }
      return headersMap;
    },
    {} as Record<string, string>,
  );

  await route.fulfill({
    status: entry.response.status,
    headers,
    body,
  });
}

export function loadHarContent(
  content: { text?: string; encoding?: string; _file?: string },
  baseDir: string,
): Buffer {
  const file = content._file;
  if (file) {
    // DIVERGENCE: zip `_file` attach via ZipFile is out of scope; only sibling files.
    const resolved = path.resolve(baseDir, file);
    if (!isPathInside(baseDir, resolved)) {
      throw new Error(`HAR entry _file escapes base directory: ${file}`);
    }
    return readFileSync(resolved);
  }
  return Buffer.from(
    content.text || "",
    content.encoding === "base64" ? "base64" : "utf8",
  );
}

function countMatchingHeaders(harHeaders: HarHeader[], headers: HarHeader[]): number {
  const set = new Set(headers.map((h) => `${h.name.toLowerCase()}:${h.value}`));
  let matches = 0;
  for (const h of harHeaders) {
    if (set.has(`${h.name.toLowerCase()}:${h.value}`)) {
      matches += 1;
    }
  }
  return matches;
}

function multipartBoundary(headers: HarHeader[]): string | undefined {
  const contentType = headers.find((h) => h.name.toLowerCase() === "content-type");
  if (contentType === undefined || !contentType.value.includes("multipart/form-data")) {
    return undefined;
  }
  const boundary = contentType.value.match(/boundary=(\S+)/);
  return boundary?.[1];
}

function headersToArray(headers: Record<string, string>): HarHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function queryStringFromUrl(url: string): Array<{ name: string; value: string }> {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function isTextualMimeType(mimeType: string): boolean {
  const type = mimeType.split(";", 1)[0]!.trim().toLowerCase();
  if (type.startsWith("text/")) {
    return true;
  }
  return (
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "application/javascript" ||
    type === "application/xml" ||
    type.endsWith("+xml") ||
    type === "application/xhtml+xml"
  );
}

function extensionForMime(mimeType: string): string {
  const type = mimeType.split(";", 1)[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    "application/json": "json",
    "text/plain": "txt",
    "text/html": "html",
    "application/javascript": "js",
    "application/octet-stream": "dat",
  };
  return map[type] ?? "dat";
}

function sha1Hex(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
