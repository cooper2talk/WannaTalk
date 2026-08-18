import { describe, expect, it } from "vitest";
import { PRIYA_SYSTEM_PROMPT, normalizeSpokenReply } from "../src/prompt";

describe("Priya prompt", () => {
  it("keeps the approved subject and privacy boundaries in the system prompt", () => {
    expect(PRIYA_SYSTEM_PROMPT).toContain("food, movies, travel");
    expect(PRIYA_SYSTEM_PROMPT).toContain("sensitive information");
    expect(PRIYA_SYSTEM_PROMPT).toContain("medical, legal, financial");
    expect(PRIYA_SYSTEM_PROMPT).toContain("Ask at most one");
  });

  it("normalizes model output before it is spoken", () => {
    expect(normalizeSpokenReply('  "Namaste!   Aapko kaunsi movie pasand hai?"  ')).toBe("Namaste! Aapko kaunsi movie pasand hai?");
  });
});
