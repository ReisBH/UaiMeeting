import http from "node:http";
import type { SummarizerProvider } from "./types.js";
import { createProvider, type ProviderKind } from "./providers.js";
import { ValidationError, handleEnhance, type EnhanceRequest } from "./api.js";
import { MeetingStore } from "./store.js";
import { MeetingEnhancer } from "./enhancer.js";
import { fromGranolaBatch, fromGranolaMeeting } from "./adapters/granola.js";
import type { EnhancedMeeting, Meeting } from "./types.js";

function noteCreatorEmail(meeting: Meeting): string | undefined {
  return meeting.participants.find((p) => p.isNoteCreator)?.email;
}

async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("invalid JSON body");
  }
}

const MAX_BODY_BYTES = 2_000_000; // 2 MB - transcripts can be large but bounded.

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface ServerOptions {
  provider?: SummarizerProvider;
  store?: MeetingStore;
}

/**
 * Create the UaiMeeting HTTP server.
 *
 *   GET  /health         -> { status, provider, model? }
 *   POST /enhance        -> enhance a meeting, persist it, return it
 *   GET  /meetings       -> paged list of stored meetings (?limit=&offset=)
 *   GET  /meetings/:id   -> one stored meeting, or 404
 *   POST /import/granola -> import Granola meeting(s), enhance, persist
 *                           (?enhance=false keeps the original Granola summary)
 */
export function createServer(opts: ServerOptions = {}): http.Server {
  const provider = opts.provider ?? createProvider();
  const store = opts.store ?? new MeetingStore();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/health") {
        sendJson(res, 200, { status: "ok", provider: provider.name, model: provider.model });
        return;
      }

      if (path === "/enhance") {
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const raw = await readBody(req);
        let body: EnhanceRequest;
        try {
          body = raw ? (JSON.parse(raw) as EnhanceRequest) : {};
        } catch {
          return sendJson(res, 400, { error: "invalid JSON body" });
        }
        const enhanced = await handleEnhance(body, provider);
        store.save(enhanced);
        return sendJson(res, 201, enhanced);
      }

      if (path === "/meetings") {
        if (method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
        const limit = url.searchParams.get("limit");
        const offset = url.searchParams.get("offset");
        return sendJson(res, 200, store.list({
          limit: limit === null ? undefined : Number(limit),
          offset: offset === null ? undefined : Number(offset),
        }));
      }

      if (path === "/import/granola") {
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const body = await parseJsonBody(req);
        const results =
          Array.isArray(body) ||
          (typeof body === "object" && body !== null && "meetings" in body)
            ? fromGranolaBatch(body)
            : [fromGranolaMeeting(body as Parameters<typeof fromGranolaMeeting>[0])];

        const enhance = url.searchParams.get("enhance") !== "false";
        const enhancer = new MeetingEnhancer(provider);
        const created: Array<{ id: string; title: string; provider: string }> = [];

        for (const { meeting, originalSummary } of results) {
          let enhanced: EnhancedMeeting;
          if (enhance) {
            enhanced = await enhancer.enhance(meeting, {
              connectedUserEmail: noteCreatorEmail(meeting),
            });
          } else {
            if (!originalSummary) {
              throw new ValidationError(
                "enhance=false requires an original `summary` in the payload",
              );
            }
            enhanced = {
              ...meeting,
              summary: originalSummary,
              summaryMeta: { provider: "granola-import", generatedAt: new Date().toISOString() },
            };
          }
          store.save(enhanced);
          created.push({
            id: enhanced.id,
            title: enhanced.title,
            provider: enhanced.summaryMeta.provider,
          });
        }

        return sendJson(res, 201, { imported: created.length, meetings: created });
      }

      const match = /^\/meetings\/([^/]+)$/.exec(path);
      if (match) {
        if (method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
        const meeting = store.get(decodeURIComponent(match[1]!));
        if (!meeting) return sendJson(res, 404, { error: "meeting not found" });
        return sendJson(res, 200, meeting);
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof ValidationError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      sendJson(res, 500, { error: err instanceof Error ? err.message : "internal error" });
    }
  });
}

/** Entry point: `npm start`. */
function main(): void {
  const port = Number(process.env.PORT ?? 3000);
  const kind = process.env.UAIMEETING_LLM as ProviderKind | undefined;
  const provider = createProvider(kind);
  const store = new MeetingStore(process.env.UAIMEETING_DB ?? "uaimeeting.db");
  const server = createServer({ provider, store });
  server.listen(port, () => {
    console.log(
      `UaiMeeting API em http://localhost:${port} ` +
        `(provider: ${provider.name}${provider.model ? `, model: ${provider.model}` : ""}, ` +
        `db: ${process.env.UAIMEETING_DB ?? "uaimeeting.db"})`,
    );
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
