import type { AudioSource, TranscriptBlock } from "./types.js";

/**
 * Parse a raw transcript into structured blocks.
 *
 * Mirrors the format the Granola connector returns for desktop/mobile
 * recordings: one utterance per line as `Speaker X: text`, optionally preceded
 * by a standalone source marker line (`Microphone` / `System audio`) that
 * applies to the utterances that follow until the next marker. Lines without a
 * speaker label are appended to the previous block (wrapped transcripts).
 */

const SOURCE_MARKERS: Record<string, AudioSource> = {
  microphone: "microphone",
  mic: "microphone",
  "system audio": "system",
  system: "system",
};

/** `Speaker A: ...`, `John Doe: ...`, `[00:12] Speaker A: ...` */
const SPEAKER_LINE = /^(?:\[(?<ts>\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(?<speaker>[^:]{1,60}?):\s*(?<text>.*)$/;

function timestampToSeconds(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return parts[0]! * 60 + parts[1]!;
}

export function parseTranscript(raw: string): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let currentSource: AudioSource = "unknown";

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const marker = SOURCE_MARKERS[line.toLowerCase()];
    if (marker) {
      currentSource = marker;
      continue;
    }

    const match = SPEAKER_LINE.exec(line);
    if (match?.groups) {
      const { speaker, text, ts } = match.groups;
      const block: TranscriptBlock = {
        source: currentSource,
        speaker: speaker!.trim() || null,
        text: text!.trim(),
      };
      if (ts) block.offsetSeconds = timestampToSeconds(ts);
      blocks.push(block);
      continue;
    }

    // Continuation of the previous utterance (wrapped line).
    const prev = blocks[blocks.length - 1];
    if (prev) prev.text += " " + line;
    else blocks.push({ source: currentSource, speaker: null, text: line });
  }

  return blocks;
}

/**
 * Render transcript blocks back to a compact text form for an LLM prompt,
 * preserving the speaker and audio-source distinction.
 */
export function renderTranscript(blocks: TranscriptBlock[]): string {
  return blocks
    .map((b) => {
      const who = b.speaker ?? "Unknown";
      const src = b.source === "unknown" ? "" : ` (${b.source})`;
      return `${who}${src}: ${b.text}`;
    })
    .join("\n");
}

/** Distinct speaker labels seen in the transcript, in order of first appearance. */
export function speakers(blocks: TranscriptBlock[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    if (b.speaker && !seen.has(b.speaker)) {
      seen.add(b.speaker);
      out.push(b.speaker);
    }
  }
  return out;
}
