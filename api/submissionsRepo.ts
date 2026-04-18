import { getSql } from './db.js';

export type NewSubmission = {
  id: string;
  capturedAt: Date;
  location: string;
  notes: string;
  imagePath: string;
  userAgent: string | null;
  /** Raw JSON string from client, or null */
  clientInfoJson: string | null;
};

export async function insertSubmission(row: NewSubmission): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO submissions (id, captured_at, location, notes, image_path, user_agent, client_info)
    VALUES (
      ${row.id}::uuid,
      ${row.capturedAt.toISOString()}::timestamptz,
      ${row.location},
      ${row.notes},
      ${row.imagePath},
      ${row.userAgent},
      ${row.clientInfoJson}
    )
  `;
}

export type SubmissionRow = {
  id: string;
  captured_at: string;
  created_at: string;
  location: string;
  notes: string;
  image_path: string;
};

export function rowToApi(r: SubmissionRow) {
  return {
    id: r.id,
    capturedAt: r.captured_at,
    createdAt: r.created_at,
    location: r.location,
    notes: r.notes,
    imageUrl: `/api/submission-image?id=${encodeURIComponent(r.id)}`,
  };
}
