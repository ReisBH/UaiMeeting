import type { Folder, Meeting, Participant, TranscriptBlock } from "../types.js";
import { parseTranscript } from "../transcript.js";
import { ValidationError } from "../api.js";

/**
 * Import adapter: Granola connector shape -> UaiMeeting `Meeting`.
 *
 * Field names follow what the official Granola connector exposes (see
 * docs/HOW-GRANOLA-WORKS.md): the transcript endpoint returns `id`, `title`,
 * `meeting_at`/`created_at` and a `transcript` string in the `Speaker X: ...`
 * format with `Microphone`/`System audio` markers; the meeting-detail endpoint
 * adds `notes`, `summary`, `known_participants` and `folders`.
 *
 * The adapter is deliberately tolerant - imported data is external and may be
 * partial - but requires a transcript, since that is the material to summarize.
 */

export interface GranolaParticipant {
  name?: unknown;
  email?: unknown;
  /** Granola marks the capturing account as the note creator. */
  is_note_creator?: unknown;
  isNoteCreator?: unknown;
}

export interface GranolaFolder {
  id?: unknown;
  title?: unknown;
  visibility?: unknown; // "private" | "workspace"
}

export interface GranolaTranscriptBlock {
  source?: unknown; // "Microphone" | "System audio" | "microphone" | "system"
  speaker?: unknown;
  text?: unknown;
  offset_seconds?: unknown;
  offsetSeconds?: unknown;
}

export interface GranolaMeetingInput {
  id?: unknown;
  title?: unknown;
  meeting_at?: unknown;
  created_at?: unknown;
  notes?: unknown;
  /** Granola's own AI summary, preserved as the original when present. */
  summary?: unknown;
  known_participants?: unknown;
  participants?: unknown;
  folders?: unknown;
  /** Raw transcript string, or an array of blocks. */
  transcript?: unknown;
}

export interface GranolaImportResult {
  meeting: Meeting;
  /** Granola's original summary, if the payload carried one. */
  originalSummary?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mapSource(value: unknown): TranscriptBlock["source"] {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  if (v === "microphone" || v === "mic") return "microphone";
  if (v === "system audio" || v === "system") return "system";
  return "unknown";
}

function mapParticipants(value: unknown): Participant[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`"participants" must be an array`);
  const out: Participant[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as GranolaParticipant;
    const name = str(p.name);
    if (!name) continue;
    const participant: Participant = { name };
    const email = str(p.email);
    if (email) participant.email = email;
    if (p.is_note_creator === true || p.isNoteCreator === true) {
      participant.isNoteCreator = true;
    }
    out.push(participant);
  }
  return out;
}

function mapFolders(value: unknown): Folder[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Folder[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const f = raw as GranolaFolder;
    const id = str(f.id);
    const title = str(f.title);
    if (!id || !title) continue;
    out.push({
      id,
      title,
      visibility: f.visibility === "workspace" ? "workspace" : "private",
    });
  }
  return out.length ? out : undefined;
}

function mapTranscript(value: unknown): TranscriptBlock[] {
  if (typeof value === "string") return parseTranscript(value);
  if (Array.isArray(value)) {
    const out: TranscriptBlock[] = [];
    for (const raw of value) {
      if (typeof raw !== "object" || raw === null) continue;
      const b = raw as GranolaTranscriptBlock;
      const text = str(b.text);
      if (!text) continue;
      const block: TranscriptBlock = {
        source: mapSource(b.source),
        speaker: str(b.speaker) ?? null,
        text,
      };
      const offset = b.offsetSeconds ?? b.offset_seconds;
      if (typeof offset === "number") block.offsetSeconds = offset;
      out.push(block);
    }
    return out;
  }
  throw new ValidationError(`"transcript" must be a string or an array of blocks`);
}

/** Map a single Granola meeting payload into a UaiMeeting `Meeting`. */
export function fromGranolaMeeting(input: GranolaMeetingInput): GranolaImportResult {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("meeting must be an object");
  }
  if (input.transcript === undefined || input.transcript === null) {
    throw new ValidationError(`"transcript" is required to import a meeting`);
  }

  const transcript = mapTranscript(input.transcript);
  if (transcript.length === 0) {
    throw new ValidationError("transcript produced no usable utterances");
  }

  const meeting: Meeting = {
    id: str(input.id) ?? crypto.randomUUID(),
    title: str(input.title) ?? "Reunião importada",
    meetingAt: str(input.meeting_at) ?? str(input.created_at) ?? new Date().toISOString(),
    participants: mapParticipants(input.known_participants ?? input.participants),
    notes: str(input.notes) ?? "",
    transcript,
  };

  const folders = mapFolders(input.folders);
  if (folders) meeting.folders = folders;

  const originalSummary = str(input.summary);
  return originalSummary ? { meeting, originalSummary } : { meeting };
}

/** Map a batch. Accepts a bare array or `{ meetings: [...] }`. */
export function fromGranolaBatch(
  input: unknown,
): GranolaImportResult[] {
  const list = Array.isArray(input)
    ? input
    : typeof input === "object" && input !== null && Array.isArray((input as { meetings?: unknown }).meetings)
      ? (input as { meetings: unknown[] }).meetings
      : null;
  if (!list) throw new ValidationError(`expected an array of meetings or { meetings: [...] }`);
  return list.map((m) => fromGranolaMeeting(m as GranolaMeetingInput));
}
