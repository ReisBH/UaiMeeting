import { describe, it, expect } from "vitest";
import { MistralSummarizer, createProvider } from "../src/providers.js";
import type { EnhanceInput } from "../src/types.js";

const input: EnhanceInput = {
  title: "Briefing",
  meetingAt: "2026-10-01T10:00:00Z",
  participants: [{ name: "Ana", email: "ana@x.com", isNoteCreator: true }],
  notes: "café do bar: manutenção",
  transcript: [{ source: "microphone", speaker: "Speaker A", text: "a máquina de café precisa de limpeza" }],
};

/** A fake fetch that records the request and returns a canned Mistral response. */
function fakeFetch(captured: { url?: string; init?: RequestInit }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "### Resumo\n- café: pedir manutenção" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("MistralSummarizer", () => {
  it("posts to the chat-completions endpoint with auth and returns the content", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const provider = new MistralSummarizer({
      apiKey: "test-key",
      baseUrl: "https://api.mistral.ai/v1",
      fetchImpl: fakeFetch(captured),
    });

    const summary = await provider.summarize(input);
    expect(summary).toContain("### Resumo");

    expect(captured.url).toBe("https://api.mistral.ai/v1/chat/completions");
    const headers = captured.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(captured.init!.body as string);
    expect(body.model).toBe("mistral-small-latest");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("café do bar");
  });

  it("honors a custom model", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const provider = new MistralSummarizer({
      apiKey: "k",
      model: "mistral-large-latest",
      fetchImpl: fakeFetch(captured),
    });
    await provider.summarize(input);
    expect(JSON.parse(captured.init!.body as string).model).toBe("mistral-large-latest");
  });

  it("throws a clear error without an API key", async () => {
    const provider = new MistralSummarizer({ apiKey: "", fetchImpl: fakeFetch({}) });
    await expect(provider.summarize(input)).rejects.toThrow(/MISTRAL_API_KEY/);
  });

  it("surfaces API errors", async () => {
    const errFetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const provider = new MistralSummarizer({ apiKey: "k", fetchImpl: errFetch });
    await expect(provider.summarize(input)).rejects.toThrow(/Mistral API error 429/);
  });
});

describe("createProvider", () => {
  it("selects the Mistral backend when asked", () => {
    expect(createProvider("mistral").name).toBe("mistral");
  });

  it("falls back to mock with no credentials and no kind", () => {
    const saved = { a: process.env.ANTHROPIC_API_KEY, m: process.env.MISTRAL_API_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      expect(createProvider().name).toBe("mock");
    } finally {
      if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a;
      if (saved.m !== undefined) process.env.MISTRAL_API_KEY = saved.m;
    }
  });
});
