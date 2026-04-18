import type { VercelRequest, VercelResponse } from '@vercel/node';
import { latestForLocation } from '../submissionsQuery.js';
import { rowToApi } from '../submissionsRepo.js';

function q1(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).setHeader('Allow', 'GET').json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    res.status(500).json({ error: 'Server missing DATABASE_URL' });
    return;
  }

  const location = q1(req.query.location)?.trim();
  if (!location) {
    res.status(400).json({ error: 'location query parameter is required' });
    return;
  }

  try {
    const row = await latestForLocation(location);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ submission: row ? rowToApi(row) : null });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Query failed';
    res.status(500).json({ error: message });
  }
}
