import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { MockSummarizer } from "../src/providers.js";

/** Integration test: real HTTP server on an ephemeral port, driven via fetch. */
describe("HTTP server", () => {
  const server = createServer({ provider: new MockSummarizer() });
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

  it("POST /enhance creates and returns a summary", async () => {
    const res = await fetch(`${base}/enhance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Briefing",
        notes: "alergia amendoim mesa 9",
        transcript: "Microphone\nSpeaker A: tem alergia a amendoim na mesa 9",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.summary).toContain("###");
    expect(body.transcript).toHaveLength(1);
    expect(body.id).toBeTruthy();
  });

  it("persists meetings and serves them via GET /meetings and /meetings/:id", async () => {
    const create = await fetch(`${base}/enhance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Reunião persistida",
        notes: "ponto importante",
        transcript: "Speaker A: discutimos o ponto importante em detalhe",
      }),
    });
    const created = await create.json();

    const listRes = await fetch(`${base}/meetings?limit=5`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.meetings.some((m: { id: string }) => m.id === created.id)).toBe(true);
    const item = list.meetings.find((m: { id: string }) => m.id === created.id);
    expect(item.summaryExcerpt).toBeTruthy();
    expect(item.transcript).toBeUndefined(); // list is lightweight

    const getRes = await fetch(`${base}/meetings/${created.id}`);
    expect(getRes.status).toBe(200);
    const full = await getRes.json();
    expect(full.id).toBe(created.id);
    expect(full.transcript).toHaveLength(1);
  });

  it("GET /meetings/:id is 404 for unknown id", async () => {
    const res = await fetch(`${base}/meetings/does-not-exist`);
    expect(res.status).toBe(404);
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
