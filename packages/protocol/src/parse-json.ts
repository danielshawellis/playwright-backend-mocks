import {
  parseClientToProxyMessage,
  parseProxyToClientMessage,
  type ClientToProxyMessage,
  type ProxyToClientMessage,
} from "./schemas.js";

export function parseJsonClientMessage(raw: string): ClientToProxyMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON from client: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseClientToProxyMessage(data);
}

export function parseJsonProxyMessage(raw: string): ProxyToClientMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON from proxy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseProxyToClientMessage(data);
}

export function stringifyMessage(
  message: ClientToProxyMessage | ProxyToClientMessage,
): string {
  return JSON.stringify(message);
}
