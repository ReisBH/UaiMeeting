import { MeetingEnhancer } from "./enhancer.js";
import { AnthropicSummarizer, MockSummarizer } from "./providers.js";
import type { SummarizerProvider } from "./types.js";
import { sampleMeeting } from "./sample.js";

/**
 * Demo runner.
 *
 *   npm run demo              -> offline, deterministic (MockSummarizer)
 *   npm run demo -- --live    -> real summary via Claude (needs credentials)
 *
 * With --live it uses AnthropicSummarizer, which resolves credentials from the
 * environment (ANTHROPIC_API_KEY or an `ant auth login` profile).
 */
async function main() {
  const live = process.argv.includes("--live");
  const provider: SummarizerProvider = live
    ? new AnthropicSummarizer()
    : new MockSummarizer();

  const enhancer = new MeetingEnhancer(provider);

  const noteCreator = sampleMeeting.participants.find((p) => p.isNoteCreator);

  console.log(`\n# ${sampleMeeting.title}`);
  console.log(`(${sampleMeeting.transcript.length} utterances · provider: ${provider.name}` +
    (provider.model ? ` · model: ${provider.model}` : "") + ")\n");

  const enhanced = await enhancer.enhance(sampleMeeting, {
    connectedUserEmail: noteCreator?.email,
  });

  console.log("====== RESUMO POTENCIALIZADO ======\n");
  console.log(enhanced.summary);
  console.log("\n===================================");
  console.log(`gerado em ${enhanced.summaryMeta.generatedAt} por ${enhanced.summaryMeta.provider}`);
}

main().catch((err) => {
  console.error("Falhou:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
