import type {
  EnhanceInput,
  EnhancedMeeting,
  Meeting,
  SummarizerProvider,
} from "./types.js";

/**
 * The note-enhancement engine.
 *
 * Given a meeting (sparse human notes + verbatim transcript), produce an
 * enhanced meeting with a structured, transcript-grounded summary. The actual
 * summarization is delegated to a pluggable provider so the orchestration is
 * the same whether we call Claude or run fully offline.
 */
export class MeetingEnhancer {
  constructor(private provider: SummarizerProvider) {}

  async enhance(
    meeting: Meeting,
    opts: { connectedUserEmail?: string } = {},
  ): Promise<EnhancedMeeting> {
    const input: EnhanceInput = {
      title: meeting.title,
      meetingAt: meeting.meetingAt,
      participants: meeting.participants,
      notes: meeting.notes,
      transcript: meeting.transcript,
      connectedUserEmail: opts.connectedUserEmail,
    };

    const summary = await this.provider.summarize(input);

    return {
      ...meeting,
      summary,
      summaryMeta: {
        provider: this.provider.name,
        model: this.provider.model,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
