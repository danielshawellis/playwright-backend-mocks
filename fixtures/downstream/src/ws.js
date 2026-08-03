/**
 * Shared outbound WebSocket helper for browser and Node downstream hosts.
 * Uses globalThis.WebSocket only (WHATWG).
 *
 * Both hosts (browser harness page + Node downstream process) import this
 * module so oracle specs exercise one implementation surface.
 *
 * @param {string} url
 * @param {{ protocols?: string | string[], binaryType?: BinaryType }} [options]
 * @returns {WebSocket}
 */
export function connectWebSocket(url, options = {}) {
  const ws = options.protocols
    ? new WebSocket(url, options.protocols)
    : new WebSocket(url);
  if (options.binaryType) {
    ws.binaryType = options.binaryType;
  }
  return ws;
}
