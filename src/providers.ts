import Anthropic from "@anthropic-ai/sdk";
import type { EnhanceInput, SummarizerProvider } from "./types.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

export type ProviderKind = "anthropic" | "mistral" | "mock";

/**
 * Pick a summarizer backend.
 *
 * Explicit `kind` wins; otherwise use whichever credential is present
 * (`ANTHROPIC_API_KEY`, then `MISTRAL_API_KEY`) and fall back to the offline
 * mock so the service always starts, even without configuration.
 */
export function createProvider(kind?: ProviderKind): SummarizerProvider {
  const resolved: ProviderKind =
    kind ??
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.MISTRAL_API_KEY
        ? "mistral"
        : "mock");
  switch (resolved) {
    case "anthropic":
      return new AnthropicSummarizer();
    case "mistral":
      return new MistralSummarizer();
    default:
      return new MockSummarizer();
  }
}

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

/** Minimal shape of a Mistral chat-completions response. */
interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Free-tier-friendly backend: summarize with the Mistral API.
 *
 * Talks to the OpenAI-compatible chat-completions endpoint over `fetch` (no
 * SDK dependency). The API key comes from `MISTRAL_API_KEY`; the model from
 * `MISTRAL_MODEL` (default `mistral-small-latest`, which the free tier covers).
 * `baseUrl` and `fetchImpl` are injectable for testing.
 */
export class MistralSummarizer implements SummarizerProvider {
  readonly name = "mistral";
  readonly model: string;
  private apiKey: string | undefined;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(
    opts: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.apiKey = opts.apiKey ?? process.env.MISTRAL_API_KEY;
    this.model = opts.model ?? process.env.MISTRAL_MODEL ?? "mistral-small-latest";
    this.baseUrl = (opts.baseUrl ?? "https://api.mistral.ai/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async summarize(input: EnhanceInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error("MISTRAL_API_KEY is not set");
    }

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        max_tokens: 4000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(input) },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Mistral API error ${res.status}: ${detail.slice(0, 500)}`);
    }

    const data = (await res.json()) as MistralChatResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Mistral returned no summary text");
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
