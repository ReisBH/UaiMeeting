import { describe, it, expect } from "vitest";
import { fromGranolaMeeting, fromGranolaBatch } from "../src/adapters/granola.js";
import { ValidationError } from "../src/api.js";

// Shape mirrors the Granola connector's transcript JSON + meeting-detail fields.
const granolaPayload = {
  id: "0b86e4d8-1d2a-427d-9276-d6115a9c13d1",
  title: "Briefing do turno",
  meeting_at: "2026-10-03T10:31:38.035-03:00",
  created_at: "2026-10-03T10:31:38.035-03:00",
  notes: "alergia amendoim mesa 9",
  summary: "### Resumo original\n- ponto do Granola",
  known_participants: [
    { name: "Rafael Reis", email: "rafaelreiss@gmail.com", is_note_creator: true },
    { name: "Bruno", email: "bruno@example.com" },
  ],
  folders: [
    { id: "f1", title: "Kabuki Briefing", visibility: "private" },
  ],
  transcript: "Microphone\nSpeaker A: alergia a amendoim na mesa 9\nSystem audio\nSpeaker B: confirmado com a cozinha",
};

describe("fromGranolaMeeting", () => {
  it("maps core fields and parses the transcript string", () => {
    const { meeting, originalSummary } = fromGranolaMeeting(granolaPayload);
    expect(meeting.id).toBe(granolaPayload.id);
    expect(meeting.title).toBe("Briefing do turno");
    expect(meeting.meetingAt).toBe(granolaPayload.meeting_at);
    expect(meeting.notes).toBe("alergia amendoim mesa 9");
    expect(meeting.transcript).toHaveLength(2);
    expect(meeting.transcript[0]).toMatchObject({ source: "microphone", speaker: "Speaker A" });
    expect(meeting.transcript[1]).toMatchObject({ source: "system", speaker: "Speaker B" });
    expect(originalSummary).toContain("Resumo original");
  });

  it("maps participants, marking the note creator", () => {
    const { meeting } = fromGranolaMeeting(granolaPayload);
    const creator = meeting.participants.find((p) => p.isNoteCreator);
    expect(creator?.email).toBe("rafaelreiss@gmail.com");
    expect(meeting.participants).toHaveLength(2);
    expect(meeting.participants[1]!.isNoteCreator).toBeUndefined();
  });

  it("maps folders and normalizes visibility", () => {
    const { meeting } = fromGranolaMeeting({
      ...granolaPayload,
      folders: [
        { id: "a", title: "Priv" },
        { id: "b", title: "Team", visibility: "workspace" },
      ],
    });
    expect(meeting.folders).toEqual([
      { id: "a", title: "Priv", visibility: "private" },
      { id: "b", title: "Team", visibility: "workspace" },
    ]);
  });

  it("accepts a pre-parsed transcript block array", () => {
    const { meeting } = fromGranolaMeeting({
      title: "x",
      transcript: [
        { source: "System audio", speaker: "A", text: "oi", offset_seconds: 5 },
        { source: "Microphone", text: "sem locutor" },
      ],
    });
    expect(meeting.transcript[0]).toMatchObject({ source: "system", speaker: "A", offsetSeconds: 5 });
    expect(meeting.transcript[1]).toMatchObject({ source: "microphone", speaker: null });
  });

  it("generates an id and title when absent", () => {
    const { meeting } = fromGranolaMeeting({ transcript: "Speaker A: x" });
    expect(meeting.id).toMatch(/[0-9a-f-]{36}/);
    expect(meeting.title).toBe("Reunião importada");
  });

  it("requires a transcript", () => {
    expect(() => fromGranolaMeeting({ title: "x" })).toThrow(ValidationError);
  });

  it("rejects a transcript that yields no utterances", () => {
    expect(() => fromGranolaMeeting({ title: "x", transcript: "   " })).toThrow(ValidationError);
  });
});

describe("fromGranolaBatch", () => {
  it("maps a bare array", () => {
    const results = fromGranolaBatch([granolaPayload, { transcript: "Speaker A: y" }]);
    expect(results).toHaveLength(2);
  });

  it("maps a { meetings: [...] } envelope", () => {
    const results = fromGranolaBatch({ meetings: [granolaPayload] });
    expect(results).toHaveLength(1);
    expect(results[0]!.meeting.title).toBe("Briefing do turno");
  });

  it("rejects a non-array payload", () => {
    expect(() => fromGranolaBatch({ nope: true })).toThrow(ValidationError);
  });
});
