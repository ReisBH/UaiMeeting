import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { MockSummarizer } from "../src/providers.js";

/** Integration test: real HTTP server on an ephemeral port, driven via fetch. */
describe("HTTP server", () => {
  const server = createServer(new MockSummarizer());
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("GET /health reports the provider", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", provider: "mock" });
  });

  it("POST /enhance returns a summary", async () => {
    const res = await fetch(`${base}/enhance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Briefing",
        notes: "alergia amendoim mesa 9",
        transcript: "Microphone\nSpeaker A: tem alergia a amendoim na mesa 9",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toContain("###");
    expect(body.transcript).toHaveLength(1);
  });

  it("POST /enhance rejects a bad body with 400", async () => {
    const res = await fetch(`${base}/enhance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "no title, no transcript" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it("POST /enhance rejects invalid JSON with 400", async () => {
    const res = await fetch(`${base}/enhance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("GET /enhance is 405", async () => {
    const res = await fetch(`${base}/enhance`);
    expect(res.status).toBe(405);
  });

  it("unknown route is 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
