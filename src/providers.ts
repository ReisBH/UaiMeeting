import Anthropic from "@anthropic-ai/sdk";
import type { EnhanceInput, SummarizerProvider } from "./types.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

/**
 * Production backend: summarize with Claude.
 *
 * Uses adaptive thinking and streams the response (transcripts can be long, and
 * streaming avoids HTTP timeouts). Defaults to claude-opus-5-5.
 */
export class AnthropicSummarizer implements SummarizerProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(opts: { client?: Anthropic; model?: string } = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? "claude-opus-5-5";
  }

  async summarize(input: EnhanceInput): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }],
    });

    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      const detail = response.stop_details?.explanation ?? "no explanation";
      throw new Error(`Summary request was refused: ${detail}`);
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) throw new Error("Model returned no summary text");
    return text;
  }
}

/**
 * Offline backend: a deterministic, dependency-free summarizer.
 *
 * It does not call any model - it reorganizes the material with simple
 * heuristics so the pipeline is fully runnable and testable without an API key.
 * The output is intentionally structured like the real thing (Markdown with
 * `###` sections) so downstream code sees the same shape either way.
 */
export class MockSummarizer implements SummarizerProvider {
  readonly name = "mock";

  async summarize(input: EnhanceInput): Promise<string> {
    const sections: string[] = [];

    const noteLines = input.notes
      .split("\n")
      .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);

    if (noteLines.length) {
      sections.push("### Pontos das anotações");
      sections.push(noteLines.map((l) => `- ${l}`).join("\n"));
    }

    const actions = findActionItems(input);
    if (actions.length) {
      sections.push("### Itens de ação");
      sections.push(actions.map((a) => `- ${a}`).join("\n"));
    }

    const highlights = transcriptHighlights(input);
    if (highlights.length) {
      sections.push("### Trechos relevantes do transcript");
      sections.push(highlights.map((h) => `- ${h}`).join("\n"));
    }

    if (!sections.length) {
      sections.push("### Resumo");
      sections.push("- Sem anotações ou transcript suficientes para resumir.");
    }

    return sections.join("\n\n");
  }
}

const ACTION_HINTS =
  /\b(precisa|precisam|tem que|temos que|vamos|fazer|pedir|enviar|confirmar|limpar|trazer|anotar|retirar|need to|must|should|todo|action)\b/i;

function findActionItems(input: EnhanceInput): string[] {
  const out: string[] = [];
  for (const b of input.transcript) {
    if (ACTION_HINTS.test(b.text) && b.text.length <= 180) {
      const who = b.speaker ? `${b.speaker}: ` : "";
      out.push(`${who}${b.text}`);
    }
    if (out.length >= 5) break;
  }
  return out;
}

function transcriptHighlights(input: EnhanceInput): string[] {
  // Longest-utterance heuristic: the substantive turns tend to be longer.
  return [...input.transcript]
    .filter((b) => b.text.length >= 40)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 3)
    .map((b) => {
      const who = b.speaker ? `${b.speaker}: ` : "";
      const text = b.text.length > 160 ? b.text.slice(0, 157) + "..." : b.text;
      return `${who}${text}`;
    });
}
