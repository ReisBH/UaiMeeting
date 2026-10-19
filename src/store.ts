import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { EnhancedMeeting } from "./types.js";

// Load the `node:sqlite` builtin at runtime via createRequire. A static
// `import` of it is rewritten by bundlers/test runners (Vite/Vitest) that don't
// yet recognize this recent builtin; a runtime require sidesteps that while
// still using the real Node module. (`DatabaseSync` is the only symbol we need.)
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * A lightweight row returned by list(): enough to render a list view without
 * shipping the full transcript, mirroring Granola's list-vs-get split.
 */
export interface MeetingListItem {
  id: string;
  title: string;
  meetingAt: string;
  createdAt: string;
  provider: string;
  model?: string;
  summaryExcerpt: string;
}

export interface ListResult {
  meetings: MeetingListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface MeetingRow {
  id: string;
  title: string;
  meeting_at: string;
  participants: string;
  folders: string | null;
  notes: string;
  transcript: string;
  summary: string;
  summary_meta: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meetings (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  meeting_at   TEXT NOT NULL,
  participants TEXT NOT NULL,
  folders      TEXT,
  notes        TEXT NOT NULL,
  transcript   TEXT NOT NULL,
  summary      TEXT NOT NULL,
  summary_meta TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_meeting_at ON meetings(meeting_at DESC);
`;

function excerpt(summary: string, max = 240): string {
  const flat = summary.replace(/[#*`>-]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/**
 * SQLite-backed persistence for enhanced meetings.
 *
 * Uses Node's built-in `node:sqlite` (no native build step). Pass `":memory:"`
 * for an ephemeral store (tests), or a file path to persist on disk.
 */
export class MeetingStore {
  private db: DatabaseSyncType;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  /** Insert or replace a meeting. Returns the stored meeting unchanged. */
  save(meeting: EnhancedMeeting): EnhancedMeeting {
    const createdAt = meeting.summaryMeta.generatedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO meetings
           (id, title, meeting_at, participants, folders, notes, transcript,
            summary, summary_meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meeting.id,
        meeting.title,
        meeting.meetingAt,
        JSON.stringify(meeting.participants),
        meeting.folders ? JSON.stringify(meeting.folders) : null,
        meeting.notes,
        JSON.stringify(meeting.transcript),
        meeting.summary,
        JSON.stringify(meeting.summaryMeta),
        createdAt,
      );
    return meeting;
  }

  /** Full meeting by id, or undefined when absent. */
  get(id: string): EnhancedMeeting | undefined {
    const row = this.db
      .prepare(`SELECT * FROM meetings WHERE id = ?`)
      .get(id) as MeetingRow | undefined;
    return row ? rowToMeeting(row) : undefined;
  }

  /** Most-recent-first page of meetings, as lightweight list items. */
  list(opts: { limit?: number; offset?: number } = {}): ListResult {
    const limit = clampInt(opts.limit, 20, 1, 100);
    const offset = clampInt(opts.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM meetings`).get() as { n: number }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT id, title, meeting_at, summary, summary_meta, created_at
           FROM meetings
          ORDER BY meeting_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<
      Pick<MeetingRow, "id" | "title" | "meeting_at" | "summary" | "summary_meta" | "created_at">
    >;

    const meetings: MeetingListItem[] = rows.map((r) => {
      const meta = JSON.parse(r.summary_meta) as EnhancedMeeting["summaryMeta"];
      return {
        id: r.id,
        title: r.title,
        meetingAt: r.meeting_at,
        createdAt: r.created_at,
        provider: meta.provider,
        model: meta.model,
        summaryExcerpt: excerpt(r.summary),
      };
    });

    return { meetings, total, limit, offset };
  }

  close(): void {
    this.db.close();
  }
}

function rowToMeeting(row: MeetingRow): EnhancedMeeting {
  return {
    id: row.id,
    title: row.title,
    meetingAt: row.meeting_at,
    participants: JSON.parse(row.participants),
    folders: row.folders ? JSON.parse(row.folders) : undefined,
    notes: row.notes,
    transcript: JSON.parse(row.transcript),
    summary: row.summary,
    summaryMeta: JSON.parse(row.summary_meta),
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
