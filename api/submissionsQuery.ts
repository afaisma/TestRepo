import { getSql } from './db.js';
import type { SubmissionRow } from './submissionsRepo.js';

export function utcDayBounds(isoDate: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const start = `${isoDate}T00:00:00.000Z`;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end: end.toISOString() };
}

export function parseLimit(raw: string | string[] | undefined, fallback: number): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(200, Math.max(1, n));
}

export async function listSubmissions(params: {
  location: string | undefined;
  date: string | undefined;
  limit: number;
}): Promise<SubmissionRow[]> {
  const sql = getSql();
  const { location, date, limit } = params;
  const bounds = date ? utcDayBounds(date) : null;
  if (date && !bounds) {
    throw new Error('Invalid date (use YYYY-MM-DD, UTC day)');
  }

  if (location && bounds) {
    const rows = await sql`
      SELECT id, captured_at, created_at, location, notes, image_path
      FROM submissions
      WHERE location = ${location}
        AND captured_at >= ${bounds.start}::timestamptz
        AND captured_at < ${bounds.end}::timestamptz
      ORDER BY captured_at DESC
      LIMIT ${limit}
    `;
    return rows as unknown as SubmissionRow[];
  }
  if (location) {
    const rows = await sql`
      SELECT id, captured_at, created_at, location, notes, image_path
      FROM submissions
      WHERE location = ${location}
      ORDER BY captured_at DESC
      LIMIT ${limit}
    `;
    return rows as unknown as SubmissionRow[];
  }
  if (bounds) {
    const rows = await sql`
      SELECT id, captured_at, created_at, location, notes, image_path
      FROM submissions
      WHERE captured_at >= ${bounds.start}::timestamptz
        AND captured_at < ${bounds.end}::timestamptz
      ORDER BY captured_at DESC
      LIMIT ${limit}
    `;
    return rows as unknown as SubmissionRow[];
  }
  throw new Error('Provide location and/or date');
}

export async function latestForLocation(location: string): Promise<SubmissionRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, captured_at, created_at, location, notes, image_path
    FROM submissions
    WHERE location = ${location}
    ORDER BY captured_at DESC
    LIMIT 1
  `;
  const list = rows as unknown as SubmissionRow[];
  const r = list[0];
  return r ?? null;
}

export async function imagePathForSubmissionId(id: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT image_path FROM submissions WHERE id = ${id}::uuid LIMIT 1
  `;
  const list = rows as unknown as { image_path: string }[];
  const row = list[0];
  return row?.image_path ?? null;
}
