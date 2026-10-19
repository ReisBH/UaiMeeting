import { describe, it, expect } from "vitest";
import { MeetingStore } from "../src/store.js";
import { MeetingEnhancer } from "../src/enhancer.js";
import { MockSummarizer } from "../src/providers.js";
import { sampleMeeting } from "../src/sample.js";
import type { EnhancedMeeting } from "../src/types.js";

async function enhanced(overrides: Partial<EnhancedMeeting> = {}): Promise<EnhancedMeeting> {
  const base = await new MeetingEnhancer(new MockSummarizer()).enhance(sampleMeeting);
  return { ...base, ...overrides };
}

describe("MeetingStore", () => {
  it("saves and reads back a full meeting", async () => {
    const store = new MeetingStore(":memory:");
    const meeting = await enhanced({ id: "m1" });
    store.save(meeting);

    const got = store.get("m1");
    expect(got?.title).toBe(meeting.title);
    expect(got?.transcript).toEqual(meeting.transcript);
    expect(got?.participants).toEqual(meeting.participants);
    expect(got?.summary).toBe(meeting.summary);
    store.close();
  });

  it("returns undefined for a missing id", () => {
    const store = new MeetingStore(":memory:");
    expect(store.get("nope")).toBeUndefined();
    store.close();
  });

  it("lists meetings newest-first with a lightweight excerpt", async () => {
    const store = new MeetingStore(":memory:");
    store.save(await enhanced({ id: "old", meetingAt: "2026-01-01T10:00:00Z" }));
    store.save(await enhanced({ id: "new", meetingAt: "2026-06-01T10:00:00Z" }));

    const result = store.list();
    expect(result.total).toBe(2);
    expect(result.meetings.map((m) => m.id)).toEqual(["new", "old"]);
    expect(result.meetings[0]!.summaryExcerpt).toBeTruthy();
    // excerpt is flattened (no Markdown markers)
    expect(result.meetings[0]!.summaryExcerpt).not.toContain("#");
    store.close();
  });

  it("paginates with limit and offset", async () => {
    const store = new MeetingStore(":memory:");
    for (let i = 0; i < 5; i++) {
      store.save(await enhanced({ id: `m${i}`, meetingAt: `2026-0${i + 1}-01T00:00:00Z` }));
    }
    const page = store.list({ limit: 2, offset: 1 });
    expect(page.meetings).toHaveLength(2);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.total).toBe(5);
    store.close();
  });

  it("clamps an out-of-range limit", async () => {
    const store = new MeetingStore(":memory:");
    store.save(await enhanced({ id: "m1" }));
    expect(store.list({ limit: 9999 }).limit).toBe(100);
    expect(store.list({ limit: 0 }).limit).toBe(1);
    store.close();
  });

  it("replaces a meeting saved with the same id", async () => {
    const store = new MeetingStore(":memory:");
    store.save(await enhanced({ id: "dup", title: "first" }));
    store.save(await enhanced({ id: "dup", title: "second" }));
    expect(store.get("dup")?.title).toBe("second");
    expect(store.list().total).toBe(1);
    store.close();
  });
});
