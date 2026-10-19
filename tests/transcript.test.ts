import { describe, it, expect } from "vitest";
import { parseTranscript, renderTranscript, speakers } from "../src/transcript.js";

describe("parseTranscript", () => {
  it("splits speaker-labelled lines into blocks", () => {
    const blocks = parseTranscript("Speaker A: hello\nSpeaker B: hi there");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ speaker: "Speaker A", text: "hello" });
    expect(blocks[1]).toMatchObject({ speaker: "Speaker B", text: "hi there" });
  });

  it("tracks audio source from standalone marker lines", () => {
    const blocks = parseTranscript(
      "Microphone\nSpeaker A: local\nSystem audio\nSpeaker B: remote",
    );
    expect(blocks[0]).toMatchObject({ source: "microphone", speaker: "Speaker A" });
    expect(blocks[1]).toMatchObject({ source: "system", speaker: "Speaker B" });
  });

  it("parses and converts leading timestamps", () => {
    const [block] = parseTranscript("[01:05] Speaker A: delayed");
    expect(block).toMatchObject({ speaker: "Speaker A", offsetSeconds: 65 });
  });

  it("appends wrapped continuation lines to the previous block", () => {
    const blocks = parseTranscript("Speaker A: first part\nand the rest");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe("first part and the rest");
  });

  it("ignores blank lines", () => {
    expect(parseTranscript("\n\nSpeaker A: x\n\n")).toHaveLength(1);
  });
});

describe("renderTranscript", () => {
  it("round-trips speaker and source into a compact form", () => {
    const blocks = parseTranscript("System audio\nSpeaker B: hi");
    expect(renderTranscript(blocks)).toBe("Speaker B (system): hi");
  });
});

describe("speakers", () => {
  it("returns distinct speakers in first-seen order", () => {
    const blocks = parseTranscript("Speaker A: a\nSpeaker B: b\nSpeaker A: c");
    expect(speakers(blocks)).toEqual(["Speaker A", "Speaker B"]);
  });
});
