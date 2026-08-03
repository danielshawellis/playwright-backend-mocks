export function normalizeHeaders(
  headers: Headers | Iterable<[string, string]> | Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      appendHeader(result, key, value);
    });
    return result;
  }

  if (Symbol.iterator in Object(headers) && !isPlainRecord(headers)) {
    for (const [key, value] of headers as Iterable<[string, string]>) {
      appendHeader(result, key, value);
    }
    return result;
  }

  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    appendHeader(result, key, value);
  }

  return result;
}

function isPlainRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(Symbol.iterator in value)
  );
}

function appendHeader(target: Record<string, string>, key: string, value: string): void {
  const normalizedKey = key.toLowerCase();
  const existing = target[normalizedKey];
  target[normalizedKey] = existing === undefined ? value : `${existing}, ${value}`;
}
