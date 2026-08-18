import { describe, expect, it } from "vitest";
import { telnyxSpeechPayload } from "../src/telnyx-tts";

describe("Telnyx Hindi speech payload", () => {
  it("locks Priya to premium Hindi NaturalHD speech at normal speed", () => {
    const payload = telnyxSpeechPayload("Hi, aap kaun bol rahe hai?", "Telnyx.NaturalHD.astra");
    expect(payload).toMatchObject({
      payload_type: "text",
      voice: "Telnyx.NaturalHD.astra",
      language: "hi-IN",
      service_level: "premium",
      voice_settings: { voice_speed: 1.0, emotion: "friendly" },
    });
    expect(typeof payload.command_id).toBe("string");
  });
});
