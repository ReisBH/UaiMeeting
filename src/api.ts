import type {
  EnhancedMeeting,
  Meeting,
  Participant,
  SummarizerProvider,
  TranscriptBlock,
} from "./types.js";
import { MeetingEnhancer } from "./enhancer.js";
import { parseTranscript } from "./transcript.js";

/** Shape accepted by POST /enhance. */
export interface EnhanceRequest {
  title?: unknown;
  meetingAt?: unknown;
  participants?: unknown;
  notes?: unknown;
  /** Raw transcript text in the `Speaker A: ...` format. */
  transcript?: unknown;
  /** Alternatively, already-parsed transcript blocks. */
  transcriptBlocks?: unknown;
  connectedUserEmail?: unknown;
}

export class ValidationError extends Error {}

function asString(value: unknown, field: string, { required = true } = {}): string {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`"${field}" is required`);
    return "";
  }
  if (typeof value !== "string") throw new ValidationError(`"${field}" must be a string`);
  return value;
}

function parseParticipants(value: unknown): Participant[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`"participants" must be an array`);
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError(`participants[${i}] must be an object`);
    }
    const p = raw as Record<string, unknown>;
    const name = asString(p.name, `participants[${i}].name`);
    const out: Participant = { name };
    if (typeof p.email === "string") out.email = p.email;
    if (typeof p.isNoteCreator === "boolean") out.isNoteCreator = p.isNoteCreator;
    return out;
  });
}

function parseBlocks(value: unknown): TranscriptBlock[] {
  if (!Array.isArray(value)) throw new ValidationError(`"transcriptBlocks" must be an array`);
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError(`transcriptBlocks[${i}] must be an object`);
    }
    const b = raw as Record<string, unknown>;
    const source =
      b.source === "microphone" || b.source === "system" ? b.source : "unknown";
    const block: TranscriptBlock = {
      source,
      speaker: typeof b.speaker === "string" ? b.speaker : null,
      text: asString(b.text, `transcriptBlocks[${i}].text`),
    };
    if (typeof b.offsetSeconds === "number") block.offsetSeconds = b.offsetSeconds;
    return block;
  });
}

/** Build a validated Meeting from a raw request body. Throws ValidationError. */
export function toMeeting(body: EnhanceRequest): {
  meeting: Meeting;
  connectedUserEmail?: string;
} {
  const title = asString(body.title, "title");
  const notes = asString(body.notes, "notes", { required: false });

  if (body.transcript === undefined && body.transcriptBlocks === undefined) {
    throw new ValidationError(`provide "transcript" (string) or "transcriptBlocks" (array)`);
  }

  const transcript =
    body.transcriptBlocks !== undefined
      ? parseBlocks(body.transcriptBlocks)
      : parseTranscript(asString(body.transcript, "transcript"));

  const meeting: Meeting = {
    id: `req-${Date.now()}`,
    title,
    meetingAt:
      typeof body.meetingAt === "string" ? body.meetingAt : new Date().toISOString(),
    participants: parseParticipants(body.participants),
    notes,
    transcript,
  };

  const connectedUserEmail =
    typeof body.connectedUserEmail === "string" ? body.connectedUserEmail : undefined;

  return { meeting, connectedUserEmail };
}

/**
 * Core request handler, independent of any transport. Returns the enhanced
 * meeting, or throws ValidationError for bad input (map to 400 at the edge).
 */
export async function handleEnhance(
  body: EnhanceRequest,
  provider: SummarizerProvider,
): Promise<EnhancedMeeting> {
  const { meeting, connectedUserEmail } = toMeeting(body);
  return new MeetingEnhancer(provider).enhance(meeting, { connectedUserEmail });
}
