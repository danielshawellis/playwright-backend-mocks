/**
 * Shared outbound HTTP helper for browser and Node downstream hosts.
 * WHATWG fetch only — no Node-specific APIs.
 *
 * Both hosts (browser harness page + Node downstream process) import this
 * module so oracle specs exercise one implementation surface.
 *
 * @param {string} url
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string,
 *   redirect?: RequestRedirect,
 * }} [init]
 */
export async function triggerHttp(url, init = {}) {
  const method = init.method ?? "GET";
  const headers = init.headers ?? {};
  const body = init.body;
  const redirect = init.redirect ?? "follow";
  let response;
  try {
    response = await fetch(url, { method, headers, body, redirect });
  } catch (error) {
    // Prefer nested cause text when present (Node fetch often wraps as "fetch failed").
    const message =
      error && typeof error === "object"
        ? [error.message, error.cause && error.cause.message]
            .filter(Boolean)
            .join(": ") || String(error)
        : String(error);
    return {
      ok: false,
      error: message,
    };
  }

  // opaque / manual-redirect responses may not expose a body.
  if (response.type === "opaqueredirect") {
    return {
      ok: false,
      status: 0,
      statusText: "",
      headers: {},
      raw: "",
      bodyBase64: "",
      data: null,
      error: "opaqueredirect",
    };
  }

  const responseHeaders = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name] = value;
  });

  const bytes = new Uint8Array(await response.arrayBuffer());
  const bodyBase64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : bytesToBase64(bytes);
  const raw =
    typeof TextDecoder !== "undefined"
      ? new TextDecoder("utf-8").decode(bytes)
      : Array.from(bytes, (b) => String.fromCharCode(b)).join("");

  const contentType = response.headers.get("content-type") || "";
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
    bodyBase64,
    data,
  };
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
