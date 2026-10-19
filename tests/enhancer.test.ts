import { describe, it, expect } from "vitest";
import { MeetingEnhancer } from "../src/enhancer.js";
import { MockSummarizer } from "../src/providers.js";
import { buildUserMessage } from "../src/prompt.js";
import type { EnhanceInput, Meeting, SummarizerProvider } from "../src/types.js";
import { sampleMeeting } from "../src/sample.js";

describe("MeetingEnhancer", () => {
  it("attaches a summary and provenance metadata", async () => {
    const enhancer = new MeetingEnhancer(new MockSummarizer());
    const result = await enhancer.enhance(sampleMeeting);

    expect(result.summary).toContain("###");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summaryMeta.provider).toBe("mock");
    expect(result.summaryMeta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Original fields are preserved.
    expect(result.id).toBe(sampleMeeting.id);
    expect(result.transcript).toBe(sampleMeeting.transcript);
  });

  it("passes the connected user email through to the provider", async () => {
    let captured: EnhanceInput | undefined;
    const spy: SummarizerProvider = {
      name: "spy",
      async summarize(input) {
        captured = input;
        return "### ok";
      },
    };
    const meeting: Meeting = { ...sampleMeeting };
    await new MeetingEnhancer(spy).enhance(meeting, {
      connectedUserEmail: "ana@example.com",
    });
    expect(captured?.connectedUserEmail).toBe("ana@example.com");
  });
});

describe("MockSummarizer", () => {
  it("surfaces note points and action items as Markdown sections", async () => {
    const summary = await new MockSummarizer().summarize({
      title: sampleMeeting.title,
      meetingAt: sampleMeeting.meetingAt,
      participants: sampleMeeting.participants,
      notes: sampleMeeting.notes,
      transcript: sampleMeeting.transcript,
    });
    expect(summary).toContain("### Pontos das anotações");
    expect(summary).toContain("### Itens de ação");
    expect(summary).toContain("mesa 9");
  });

  it("degrades gracefully with no material", async () => {
    const summary = await new MockSummarizer().summarize({
      title: "empty",
      meetingAt: "2026-01-01T00:00:00Z",
      participants: [],
      notes: "",
      transcript: [],
    });
    expect(summary).toContain("### Resumo");
  });
});

describe("buildUserMessage", () => {
  it("includes notes, transcript, and participant context", () => {
    const msg = buildUserMessage({
      title: sampleMeeting.title,
      meetingAt: sampleMeeting.meetingAt,
      participants: sampleMeeting.participants,
      notes: sampleMeeting.notes,
      transcript: sampleMeeting.transcript,
      connectedUserEmail: "ana@example.com",
    });
    expect(msg).toContain("## User's notes");
    expect(msg).toContain("## Verbatim transcript");
    expect(msg).toContain("note creator");
    expect(msg).toContain("ana@example.com");
  });
});
