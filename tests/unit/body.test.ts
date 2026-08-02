import { describe, expect, it } from "vitest";
import {
  decodeBody,
  decodeBodyText,
  encodeBody,
} from "@playwright-backend-mocks/protocol";

describe("body encoding", () => {
  it("round-trips utf8 text", () => {
    const encoded = encodeBody('{"ok":true}');
    expect(decodeBodyText(encoded)).toBe('{"ok":true}');
  });

  it("round-trips binary", () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const encoded = encodeBody(bytes);
    expect(decodeBody(encoded)?.equals(bytes)).toBe(true);
  });

  it("treats empty bodies as null", () => {
    expect(encodeBody("")).toBeNull();
    expect(encodeBody(Buffer.alloc(0))).toBeNull();
    expect(decodeBody(null)).toBeNull();
  });
});
