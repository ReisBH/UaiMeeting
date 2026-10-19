import { describe, it, expect } from "vitest";
import { toMeeting, handleEnhance, ValidationError } from "../src/api.js";
import { MockSummarizer } from "../src/providers.js";

const mock = new MockSummarizer();

describe("toMeeting", () => {
  it("parses a raw transcript string into blocks", () => {
    const { meeting } = toMeeting({
      title: "T",
      notes: "n",
      transcript: "Microphone\nSpeaker A: oi",
    });
    expect(meeting.transcript).toHaveLength(1);
    expect(meeting.transcript[0]).toMatchObject({ source: "microphone", speaker: "Speaker A" });
  });

  it("accepts pre-parsed transcriptBlocks", () => {
    const { meeting } = toMeeting({
      title: "T",
      notes: "n",
      transcriptBlocks: [{ source: "system", speaker: "B", text: "hi" }],
    });
    expect(meeting.transcript[0]).toMatchObject({ source: "system", speaker: "B", text: "hi" });
  });

  it("defaults meetingAt and allows empty notes", () => {
    const { meeting } = toMeeting({ title: "T", transcript: "Speaker A: x" });
    expect(meeting.notes).toBe("");
    expect(meeting.meetingAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a missing title", () => {
    expect(() => toMeeting({ transcript: "Speaker A: x" })).toThrow(ValidationError);
  });

  it("rejects a body with neither transcript nor transcriptBlocks", () => {
    expect(() => toMeeting({ title: "T", notes: "n" })).toThrow(ValidationError);
  });

  it("rejects a non-string title", () => {
    expect(() => toMeeting({ title: 42, transcript: "Speaker A: x" })).toThrow(ValidationError);
  });
});

describe("handleEnhance", () => {
  it("returns an enhanced meeting with a summary", async () => {
    const result = await handleEnhance(
      { title: "Briefing", notes: "café pedir manutenção", transcript: "Speaker A: a máquina de café precisa de limpeza" },
      mock,
    );
    expect(result.summary).toContain("###");
    expect(result.summaryMeta.provider).toBe("mock");
  });
});
