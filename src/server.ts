import http from "node:http";
import type { SummarizerProvider } from "./types.js";
import { createProvider, type ProviderKind } from "./providers.js";
import { ValidationError, handleEnhance, type EnhanceRequest } from "./api.js";

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

/**
 * Create the UaiMeeting HTTP server.
 *
 *   GET  /health   -> { status, provider, model? }
 *   POST /enhance  -> enhanced meeting (see src/api.ts for the request shape)
 */
export function createServer(provider: SummarizerProvider = createProvider()): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, {
          status: "ok",
          provider: provider.name,
          model: provider.model,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/enhance") {
        const raw = await readBody(req);
        let body: EnhanceRequest;
        try {
          body = raw ? (JSON.parse(raw) as EnhanceRequest) : {};
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        const result = await handleEnhance(body, provider);
        sendJson(res, 200, result);
        return;
      }

      if (req.url === "/enhance" || req.url === "/health") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof ValidationError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      // Provider / unexpected failures.
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : "internal error",
      });
    }
  });
}

/** Entry point: `npm start`. */
function main(): void {
  const port = Number(process.env.PORT ?? 3000);
  const kind = process.env.UAIMEETING_LLM as ProviderKind | undefined;
  const provider = createProvider(kind);
  const server = createServer(provider);
  server.listen(port, () => {
    console.log(
      `UaiMeeting API em http://localhost:${port} ` +
        `(provider: ${provider.name}${provider.model ? `, model: ${provider.model}` : ""})`,
    );
  });
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
