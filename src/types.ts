/**
 * Domain model for UaiMeeting.
 *
 * The shape here mirrors what the official Granola connector exposes for each
 * meeting (see docs/HOW-GRANOLA-WORKS.md for the captured evidence): a meeting
 * carries sparse human-written notes, a verbatim transcript split by audio
 * source and speaker, a set of known participants, and an AI-generated summary.
 * The defining capability we reproduce is turning the first two into the last.
 */

/** Where a given slice of audio came from on the recording device. */
export type AudioSource = "microphone" | "system" | "unknown";

/** A single utterance in the verbatim transcript. */
export interface TranscriptBlock {
  /**
   * Audio channel the utterance was captured on. Granola separates the
   * recording microphone from the call ("system") audio; our parser keeps the
   * same distinction so attribution logic can reason about who was local.
   */
  source: AudioSource;
  /**
   * Speaker label. A diarization label such as "Speaker A", or a resolved
   * person name once we can map a voice to a participant. `null` when unknown.
   */
  speaker: string | null;
  /** The spoken text. */
  text: string;
  /** Seconds from the start of the recording, when the capture provides it. */
  offsetSeconds?: number;
}

/** Someone known to have been involved in the meeting. */
export interface Participant {
  name: string;
  email?: string;
  /** True for the person whose device captured the note (the "note creator"). */
  isNoteCreator?: boolean;
}

/** A folder the meeting is filed under, with its visibility. */
export interface Folder {
  id: string;
  title: string;
  visibility: "private" | "workspace";
}

/** A meeting record before enhancement. */
export interface Meeting {
  id: string;
  title: string;
  /** ISO timestamp of when the meeting happened. */
  meetingAt: string;
  participants: Participant[];
  folders?: Folder[];
  /**
   * The user's own notes taken during the meeting. Typically terse and
   * fragmentary ("agave straws only tables 30-32") - the raw material the
   * enhancer expands against the transcript.
   */
  notes: string;
  /** The verbatim transcript, in chronological order. */
  transcript: TranscriptBlock[];
}

/** The result of enhancing a meeting. */
export interface EnhancedMeeting extends Meeting {
  /**
   * The AI-generated summary, as Markdown with `###` section headings - the
   * same format Granola returns. Structured, grounded in the transcript, and
   * organized around the user's own notes.
   */
  summary: string;
  /** Metadata about how the summary was produced. */
  summaryMeta: {
    provider: string;
    model?: string;
    generatedAt: string;
  };
}

/** Everything the enhancer needs to produce a summary. */
export interface EnhanceInput {
  title: string;
  meetingAt: string;
  participants: Participant[];
  notes: string;
  transcript: TranscriptBlock[];
  /**
   * The email of the user we are summarizing for. Used so the model does not
   * attribute every first-person note or action item to everyone - it maps
   * actions to their explicit owner, exactly as the Granola connector warns.
   */
  connectedUserEmail?: string;
}

/** A pluggable summarization backend. */
export interface SummarizerProvider {
  /** Human-readable id for logging / provenance (e.g. "anthropic", "mock"). */
  readonly name: string;
  /** The model id in use, when the provider has one. */
  readonly model?: string;
  /** Produce a Markdown summary from the meeting material. */
  summarize(input: EnhanceInput): Promise<string>;
}
