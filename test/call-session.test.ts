import { describe, expect, it } from "vitest";
import { textFromModel } from "../src/call-session";

describe("Workers AI output parsing", () => {
  it("uses the OpenAI-compatible chat completion content returned by Qwen", () => {
    expect(textFromModel({
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "Namaste!" } }],
    })).toBe("Namaste!");
  });

  it("still accepts simple text model responses", () => {
    expect(textFromModel("Namaste!")).toBe("Namaste!");
  });
});
