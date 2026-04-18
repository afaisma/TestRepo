import type { VercelRequest, VercelResponse } from '@vercel/node';
import { listSubmissions, parseLimit } from './submissionsQuery.js';
import { rowToApi } from './submissionsRepo.js';

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

  const location = q1(req.query.location)?.trim() || undefined;
  const date = q1(req.query.date)?.trim() || undefined;
  const limit = parseLimit(req.query.limit, 50);

  if (!location && !date) {
    res
      .status(400)
      .json({ error: 'Provide at least one of: location, date (YYYY-MM-DD UTC)' });
    return;
  }

  try {
    const rows = await listSubmissions({ location, date, limit });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ submissions: rows.map(rowToApi) });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Query failed';
    const isClient = message.includes('Invalid date') || message.includes('Provide location');
    res.status(isClient ? 400 : 500).json({ error: message });
  }
}
