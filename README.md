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
# UAIMEETING_LLM=mock|anthropic|mistral força o backend.
# Padrão: anthropic se ANTHROPIC_API_KEY estiver setada; senão mistral se
# MISTRAL_API_KEY estiver setada; senão mock.
```

### Motores de resumo (providers)

O `SummarizerProvider` é plugável; escolha com `UAIMEETING_LLM`:

| Provider | `UAIMEETING_LLM` | Credencial | Modelo (env) |
|---|---|---|---|
| Claude | `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| Mistral (free tier) | `mistral` | `MISTRAL_API_KEY` | `MISTRAL_MODEL` (padrão `mistral-small-latest`) |
| Mock (offline) | `mock` | — | — |

Mistral usa o endpoint de chat-completions via `fetch` (sem SDK). Gere a chave
no [console.mistral.ai](https://console.mistral.ai/) → API Keys.

| Rota | Descrição |
|---|---|
| `GET /health` | `{ status, provider, model? }` |
| `POST /enhance` | recebe a reunião, gera o resumo, **persiste** e devolve (`201`) |
| `GET /meetings` | lista paginada das reuniões salvas (`?limit=&offset=`), mais recentes primeiro |
| `GET /meetings/:id` | uma reunião salva por completo, ou `404` |
| `POST /import/granola` | importa reunião(ões) no formato do conector do Granola |

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

## Importar do Granola

`POST /import/granola` recebe um objeto no formato do conector oficial do
Granola (ou um array / `{ "meetings": [...] }`), mapeia para o modelo do
UaiMeeting, gera o resumo e persiste. Os campos seguem o conector: `id`,
`title`, `meeting_at`/`created_at`, `notes`, `known_participants`
(com `is_note_creator`), `folders`, e `transcript` — **string** no formato
`Speaker X: …` (com marcadores `Microphone`/`System audio`) **ou** array de
blocos. Veja `docs/HOW-GRANOLA-WORKS.md`.

```bash
# fluxo típico: um script lê do conector do Granola e faz POST aqui
curl -s -X POST localhost:3000/import/granola -H 'content-type: application/json' -d '{
  "id": "0b86e4d8-...",
  "title": "Briefing 25/09",
  "meeting_at": "2026-09-25T15:00:33-03:00",
  "known_participants": [{"name":"Rafael","email":"...","is_note_creator":true}],
  "notes": "reservas sem solicitação; canudos agave mesas 30-32",
  "transcript": "Microphone\nSpeaker A: ...\nSystem audio\nSpeaker B: ..."
}'
```

Por padrão o UaiMeeting **gera o próprio resumo**. Com `?enhance=false` ele
importa preservando o `summary` original do Granola (sem chamar o LLM).

### Script de exemplo

`examples/import-from-granola.mjs` é a cola pronta: lê JSON no formato do
conector (arquivos, pastas ou stdin) e faz o `POST` para o servidor. Ele **não**
fala com o Granola direto — o conector é MCP (vive numa sessão Claude), não uma
API pública, e o UaiMeeting não faz engenharia reversa do app. Você obtém o JSON
pelos meios oficiais (exportando, ou pedindo a uma sessão Claude com o conector
que salve as reuniões) e aponta o script para ele.

```bash
npm start                 # terminal 1
npm run import:example    # terminal 2 — importa os samples sintéticos

# ou manualmente:
node examples/import-from-granola.mjs examples/sample-granola
node examples/import-from-granola.mjs --url=http://host:3000 --no-enhance arquivo.json
cat reuniao.json | node examples/import-from-granola.mjs
```

Os samples em `examples/sample-granola/` são fictícios (um arquivo único e um
`{ "meetings": [...] }`) só para o script rodar out-of-the-box.

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
| `src/providers.ts` | `AnthropicSummarizer` (Claude), `MistralSummarizer` (free tier) e `MockSummarizer` (offline). |
| `src/enhancer.ts` | Orquestra nota + transcript → resumo + metadados de proveniência. |
| `src/api.ts` | Validação do request e handler puro (`toMeeting`, `handleEnhance`). |
| `src/store.ts` | Persistência SQLite (`MeetingStore`: `save`, `get`, `list`). |
| `src/adapters/granola.ts` | Importa o formato do conector do Granola para o modelo do UaiMeeting. |
| `src/server.ts` | Servidor HTTP (`node:http`) com `/health`, `/enhance` e `/meetings`. |
| `src/sample.ts` | Reunião sintética de exemplo para a demo e os testes. |
| `src/demo.ts` | Runner de linha de comando. |

O `SummarizerProvider` é uma interface, então dá para plugar qualquer backend
(outro modelo, um serviço interno, um stub de teste) sem mexer na orquestração.

## Status

Fatia vertical funcional do recurso central. Fora de escopo por enquanto:
captura de áudio do sistema, a transcrição em si, persistência e contas — o
UaiMeeting assume que o transcript já existe e foca na geração do resumo.
