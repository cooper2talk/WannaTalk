import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, maskPhoneNumber } from "../src/security";

describe("security helpers", () => {
  it("round-trips base64 bytes", () => {
    const input = new TextEncoder().encode("Priya");
    expect(new TextDecoder().decode(base64ToBytes(bytesToBase64(input)))).toBe("Priya");
  });

  it("masks phone numbers before storage", () => {
    expect(maskPhoneNumber("+15403908080")).toBe("***-***-8080");
    expect(maskPhoneNumber(undefined)).toBeNull();
  });
});
