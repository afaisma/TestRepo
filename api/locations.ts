import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readAllowedLocations, validateLocationsForSave, writeLocations } from './locationsStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const locations = await readAllowedLocations(token);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ locations });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error';
      res.status(500).json({ error: message });
    }
    return;
  }

  if (req.method === 'POST') {
    let body: unknown;
    if (req.body == null || req.body === '') {
      body = {};
    } else if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
      }
    } else if (typeof req.body === 'object') {
      body = req.body;
    } else {
      body = {};
    }
    const validated = validateLocationsForSave(body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    try {
      await writeLocations(token, validated.locations);
      res.status(200).json({ ok: true, locations: validated.locations });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error';
      res.status(500).json({ error: message });
    }
    return;
  }

  res.status(405).setHeader('Allow', 'GET, POST').json({ error: 'Method not allowed' });
}
