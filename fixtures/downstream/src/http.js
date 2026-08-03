/**
 * Shared outbound HTTP helper for browser and Node downstream hosts.
 * WHATWG fetch only — no Node-specific APIs.
 *
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [init]
 */
export async function triggerHttp(url, init = {}) {
  const method = init.method ?? "GET";
  const headers = init.headers ?? {};
  const body = init.body;
  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (error) {
    return {
      ok: false,
      error: String(error && error.message ? error.message : error),
    };
  }

  const responseHeaders = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name] = value;
  });

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  let data = null;
  if (contentType.includes("application/json") && raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    raw,
    data,
  };
}
