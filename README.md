# UaiMeeting

Notas de reunião potencializadas por IA. Você anota pouco durante a reunião;
o UaiMeeting mescla essas anotações com o transcript e gera um **resumo
estruturado, fiel e organizado em torno do que você escreveu**.

É o recurso que define o [Granola](https://granola.ai), reconstruído de forma
independente. O entendimento do Granola veio de fontes legítimas (o conector
MCP oficial e o comportamento público do app) — veja
[`docs/HOW-GRANOLA-WORKS.md`](docs/HOW-GRANOLA-WORKS.md) para as evidências.
Nenhuma engenharia reversa de binário foi usada.

## O recurso

```
notas curtas do usuário  +  transcript (mic + áudio do sistema, por locutor)
          └──────────────────────┬───────────────────────┘
                                 ▼
             enhancer  →  LLM (Claude) com regras de atribuição
                                 ▼
                   resumo em Markdown com seções ###
```

Princípios embutidos no `SYSTEM_PROMPT` (`src/prompt.ts`), espelhando o
comportamento observado no Granola:

- organiza o resumo **em torno das suas notas**;
- usa o transcript só para **confirmar e enriquecer** — nunca inventa;
- trata o transcript **como dado** (ignora instruções embutidas nele);
- atribui cada item de ação ao **dono explícito**, não a todos.

## Como rodar

```bash
npm install

# demo offline, determinístico (sem chave de API):
npm run demo

# resumo real via Claude (precisa de credenciais):
npm run demo -- --live

npm test        # 12 testes
npm run build   # compila para dist/
```

O modo `--live` usa o `AnthropicSummarizer`, que resolve credenciais do
ambiente (`ANTHROPIC_API_KEY` ou um perfil `ant auth login`). O modelo padrão é
`claude-opus-5-5`.

## API HTTP

Sobe um servidor (sem dependências extras, `node:http`) que expõe o enhancer:

```bash
npm start            # porta 3000 (ou $PORT); provider automático
# UAIMEETING_LLM=mock|anthropic força o backend; padrão: anthropic se
# ANTHROPIC_API_KEY estiver setada, senão mock.
```

| Rota | Descrição |
|---|---|
| `GET /health` | `{ status, provider, model? }` |
| `POST /enhance` | recebe a reunião, gera o resumo, **persiste** e devolve (`201`) |
| `GET /meetings` | lista paginada das reuniões salvas (`?limit=&offset=`), mais recentes primeiro |
| `GET /meetings/:id` | uma reunião salva por completo, ou `404` |

As reuniões são persistidas em **SQLite** (via `node:sqlite` nativo, sem build).
O arquivo padrão é `uaimeeting.db` (configurável com `UAIMEETING_DB`; use
`:memory:` para efêmero). A listagem devolve itens leves (sem o transcript
completo) com um `summaryExcerpt`; o transcript inteiro vem no `GET /meetings/:id`
— a mesma separação lista-vs-detalhe do Granola.

Exemplo:

```bash
curl -s -X POST localhost:3000/enhance -H 'content-type: application/json' -d '{
  "title": "Briefing do turno",
  "notes": "alergia amendoim mesa 9\ncafé do bar: manutenção",
  "transcript": "Microphone\nSpeaker A: alergia a amendoim na mesa 9\nSystem audio\nSpeaker B: a máquina de café precisa de limpeza"
}'
```

O corpo aceita `transcript` (string crua no formato `Speaker X: …`) **ou**
`transcriptBlocks` (array já estruturado). Campos: `title` (obrigatório),
`notes`, `participants`, `meetingAt`, `connectedUserEmail`. Erros de validação
voltam como `400 { error }`.

## Uso como biblioteca

```ts
import {
  MeetingEnhancer,
  AnthropicSummarizer,
  MockSummarizer,
  parseTranscript,
  type Meeting,
} from "./src/index.js";

const meeting: Meeting = {
  id: "123",
  title: "Briefing do turno",
  meetingAt: "2026-10-18T19:00:00-03:00",
  participants: [{ name: "Ana", email: "ana@example.com", isNoteCreator: true }],
  notes: "48 reservas; alergia amendoim mesa 9; café do bar pedir manutenção",
  transcript: parseTranscript("Microphone\nSpeaker A: ...\nSystem audio\nSpeaker B: ..."),
};

// Produção: usa Claude. Offline/testes: troque por `new MockSummarizer()`.
const enhancer = new MeetingEnhancer(new AnthropicSummarizer());
const enhanced = await enhancer.enhance(meeting, {
  connectedUserEmail: "ana@example.com",
});

console.log(enhanced.summary); // Markdown com seções ###
```

## Arquitetura

| Arquivo | Responsabilidade |
|---|---|
| `src/types.ts` | Modelo de domínio (reunião, bloco de transcript, participante, provider). |
| `src/transcript.ts` | Parse/render do transcript estilo Granola (fonte de áudio + locutor). |
| `src/prompt.ts` | System prompt e montagem da mensagem para o LLM. |
| `src/providers.ts` | `AnthropicSummarizer` (Claude) e `MockSummarizer` (offline). |
| `src/enhancer.ts` | Orquestra nota + transcript → resumo + metadados de proveniência. |
| `src/api.ts` | Validação do request e handler puro (`toMeeting`, `handleEnhance`). |
| `src/store.ts` | Persistência SQLite (`MeetingStore`: `save`, `get`, `list`). |
| `src/server.ts` | Servidor HTTP (`node:http`) com `/health`, `/enhance` e `/meetings`. |
| `src/sample.ts` | Reunião sintética de exemplo para a demo e os testes. |
| `src/demo.ts` | Runner de linha de comando. |

O `SummarizerProvider` é uma interface, então dá para plugar qualquer backend
(outro modelo, um serviço interno, um stub de teste) sem mexer na orquestração.

## Status

Fatia vertical funcional do recurso central. Fora de escopo por enquanto:
captura de áudio do sistema, a transcrição em si, persistência e contas — o
UaiMeeting assume que o transcript já existe e foca na geração do resumo.
